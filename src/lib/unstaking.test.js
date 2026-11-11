import { describe, expect, it } from "vitest";
import {
  bucketUnstakingByHour,
  buildWalletNames,
  formatUnstakingDuration,
  normalizeAliases,
  normalizeUnstakingQueue,
  normalizeValidatorNames,
  selectUnstakingRows,
  summarizeUnstakingQueue,
} from "./unstaking";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

function entry(offsetMs, amount, user = "0xa") {
  return { time: NOW + offsetMs, user, amount };
}

describe("normalizeUnstakingQueue", () => {
  it("converts wei to HYPE, lowercases wallets and sorts by unlock time", () => {
    const entries = normalizeUnstakingQueue([
      { time: 2000, user: "0xABC", wei: 250_000_000 },
      { time: 1000, user: "0xdef", wei: 14_405_067 },
    ]);

    expect(entries).toEqual([
      { time: 1000, user: "0xdef", amount: 0.14405067 },
      { time: 2000, user: "0xabc", amount: 2.5 },
    ]);
  });

  it("drops malformed entries", () => {
    const entries = normalizeUnstakingQueue([
      { time: "x", user: "0xa", wei: 1 },
      { time: 1, user: "", wei: 1 },
      { time: 1, user: "0xa", wei: 0 },
      null,
      { time: 1, user: "0xa", wei: 100_000_000 },
    ]);

    expect(entries).toEqual([{ time: 1, user: "0xa", amount: 1 }]);
  });

  it("treats a non-list response as an error, not an empty queue", () => {
    expect(() => normalizeUnstakingQueue({ error: "down" })).toThrow();
  });
});

describe("summarizeUnstakingQueue", () => {
  const entries = [
    entry(-8 * DAY, 1000),
    entry(-2 * DAY, 100),
    entry(-2 * HOUR, 10),
    entry(-30 * MINUTE, 1, "0xb"),
    entry(0, 5, "0xc"),
    entry(30 * MINUTE, 2),
    entry(HOUR, 20, "0xb"),
    entry(3 * HOUR, 200),
    entry(3 * DAY, 2000),
  ];

  it("totals HYPE unlocking within each window ahead and behind", () => {
    const summary = summarizeUnstakingQueue(entries, NOW);

    expect(summary.upcoming).toEqual({ "1h": 22, "24h": 222, "7d": 2222 });
    // An entry exactly at `now` has unlocked; the 8-day-old one is outside 7d.
    expect(summary.past).toEqual({ "1h": 6, "24h": 16, "7d": 116 });
  });

  it("counts pending releases and the wallets they belong to", () => {
    const summary = summarizeUnstakingQueue(entries, NOW);

    expect(summary.pendingCount).toBe(4);
    expect(summary.pendingAmount).toBe(2222);
    expect(summary.pendingWalletCount).toBe(2);
  });

  it("handles a missing queue", () => {
    expect(summarizeUnstakingQueue(null, NOW)).toMatchObject({
      upcoming: { "1h": 0, "24h": 0, "7d": 0 },
      pendingCount: 0,
    });
  });
});

describe("selectUnstakingRows", () => {
  const entries = [entry(-2 * HOUR, 50), entry(-HOUR, 5), entry(HOUR, 1), entry(2 * HOUR, 30)];

  it("lists pending releases soonest first", () => {
    expect(selectUnstakingRows(entries, NOW).map((row) => row.amount)).toEqual([1, 30]);
  });

  it("lists past releases most recent first", () => {
    const rows = selectUnstakingRows(entries, NOW, { view: "past" });
    expect(rows.map((row) => row.amount)).toEqual([5, 50]);
  });

  it("sorts either list largest first", () => {
    expect(
      selectUnstakingRows(entries, NOW, { sort: "amount" }).map((row) => row.amount),
    ).toEqual([30, 1]);
    expect(
      selectUnstakingRows(entries, NOW, { view: "past", sort: "amount" }).map((row) => row.amount),
    ).toEqual([50, 5]);
  });

  it("does not reorder the source list", () => {
    const source = [...entries];
    selectUnstakingRows(source, NOW, { sort: "amount" });
    expect(source).toEqual(entries);
  });
});

describe("bucketUnstakingByHour", () => {
  // Half past the hour, so the window's first and last buckets are partial.
  const now = NOW + 30 * MINUTE;

  it("buckets the next 7 days by hour, starting with the current hour", () => {
    const buckets = bucketUnstakingByHour(
      [
        entry(20 * MINUTE, 1), // already released
        entry(40 * MINUTE, 2),
        entry(50 * MINUTE, 3),
        entry(HOUR, 4),
        entry(7 * DAY + 30 * MINUTE, 5), // exactly 7 days out
        entry(7 * DAY + 31 * MINUTE, 6), // past the window
      ],
      now,
    );

    expect(buckets).toHaveLength(7 * 24 + 1);
    expect(buckets[0]).toEqual({ start: NOW, amount: 5, count: 2 });
    expect(buckets[1]).toEqual({ start: NOW + HOUR, amount: 4, count: 1 });
    expect(buckets.at(-1)).toEqual({ start: NOW + 7 * DAY, amount: 5, count: 1 });
    expect(buckets.reduce((sum, bucket) => sum + bucket.amount, 0)).toBe(14);
  });

  it("buckets the past 7 days by hour, ending with the current hour", () => {
    const buckets = bucketUnstakingByHour(
      [
        entry(-7 * DAY + 30 * MINUTE, 1), // exactly 7 days ago, outside
        entry(-7 * DAY + 31 * MINUTE, 2),
        entry(20 * MINUTE, 3),
        entry(30 * MINUTE, 4), // unlocks at `now`, so released
        entry(40 * MINUTE, 5), // still pending
      ],
      now,
      { view: "past" },
    );

    expect(buckets).toHaveLength(7 * 24 + 1);
    expect(buckets[0]).toEqual({ start: NOW - 7 * DAY, amount: 2, count: 1 });
    expect(buckets.at(-1)).toEqual({ start: NOW, amount: 7, count: 2 });
  });

  it("returns empty buckets without a queue", () => {
    const buckets = bucketUnstakingByHour(null, now);
    expect(buckets.every((bucket) => bucket.amount === 0 && bucket.count === 0)).toBe(true);
  });
});

describe("formatUnstakingDuration", () => {
  it("scales the unit to the gap", () => {
    expect(formatUnstakingDuration(42_400)).toBe("42s");
    expect(formatUnstakingDuration(12 * MINUTE + 5_000)).toBe("12m 05s");
    expect(formatUnstakingDuration(5 * HOUR + 7 * MINUTE)).toBe("5h 07m");
    expect(formatUnstakingDuration(3 * DAY + 4 * HOUR + 59 * MINUTE)).toBe("3d 4h");
  });

  it("formats past gaps by their size", () => {
    expect(formatUnstakingDuration(-90_000)).toBe("1m 30s");
  });
});

describe("wallet names", () => {
  it("keys HypurrScan aliases by lowercase address", () => {
    const aliases = normalizeAliases({ "0xABC": "Node - ValiDAO", "0xdef": "", "0x1": 3 });
    expect([...aliases]).toEqual([["0xabc", "Node - ValiDAO"]]);
  });

  it("ignores a malformed alias payload", () => {
    expect(normalizeAliases(["0xabc"]).size).toBe(0);
    expect(normalizeAliases(null).size).toBe(0);
  });

  it("names validators by their validator address", () => {
    const validators = normalizeValidatorNames([
      { validator: "0xABC", name: " ValiDAO " },
      { validator: "0xdef", name: "" },
      { name: "No address" },
    ]);
    expect([...validators]).toEqual([["0xabc", "ValiDAO"]]);
    expect(normalizeValidatorNames({ error: "down" }).size).toBe(0);
  });

  it("prefers saved labels, then validator names, then HypurrScan aliases", () => {
    const aliases = new Map([
      ["0xabc", "Alias ABC"],
      ["0xdef", "Exchange"],
      ["0x999", "Alias 999"],
    ]);
    const validators = new Map([
      ["0xabc", "Validator ABC"],
      ["0x999", "Validator 999"],
    ]);
    const names = buildWalletNames({
      aliases,
      validators,
      savedWallets: [
        { address: "0xABC", label: "My validator" },
        { address: "0x123", label: "" },
      ],
    });

    // A saved label renames a validator but it stays marked as one.
    expect(names.get("0xabc")).toEqual({ name: "My validator", isValidator: true });
    expect(names.get("0x999")).toEqual({ name: "Validator 999", isValidator: true });
    expect(names.get("0xdef")).toEqual({ name: "Exchange", isValidator: false });
    expect(names.has("0x123")).toBe(false);
    expect(aliases.get("0xabc")).toBe("Alias ABC");
  });

  it("works with nothing loaded yet", () => {
    expect(buildWalletNames().size).toBe(0);
  });
});
