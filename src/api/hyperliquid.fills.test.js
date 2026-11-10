import { describe, expect, it } from "vitest";
import { fetchAllUserFills } from "./hyperliquid";

function makePage(startTid, count, startTime) {
  return Array.from({ length: count }, (_, i) => ({
    tid: startTid + i,
    time: startTime + i,
    coin: "HYPE",
  }));
}

describe("fetchAllUserFills pagination", () => {
  it("pages forward by time until a partial page and dedupes by tid", async () => {
    const pages = [
      makePage(1, 2000, 1_000), // times 1000..2999
      makePage(2001, 2000, 3_000), // times 3000..4999
      makePage(4001, 500, 5_000), // partial -> stop
    ];
    // Each page after the first restarts at the previous max time, so it also
    // returns the boundary fill again (deduped by tid).
    const calls = [];
    const fetchPage = async ({ startTime }) => {
      calls.push(startTime);
      return pages.shift() ?? [];
    };

    const all = await fetchAllUserFills({ user: "0xabc", fetchPage });

    expect(all).toHaveLength(4500);
    // First call starts at 0; each subsequent call advances past the previous max time.
    expect(calls[0]).toBe(0);
    expect(calls[1]).toBe(2999); // restarts at the last ms seen
    expect(calls[2]).toBe(4999);
    expect(calls).toHaveLength(3);
  });

  it("stops at maxPages even if full pages keep coming", async () => {
    let tid = 1;
    let t = 1_000;
    const fetchPage = async () => {
      const page = makePage(tid, 2000, t);
      tid += 2000;
      t += 2000;
      return page;
    };

    const all = await fetchAllUserFills({ user: "0xabc", maxPages: 3, fetchPage });
    expect(all).toHaveLength(6000);
  });

  it("breaks when a page repeats the same fills (no forward progress)", async () => {
    const fetchPage = async () => makePage(1, 2000, 1_000); // identical every time
    const all = await fetchAllUserFills({ user: "0xabc", maxPages: 5, fetchPage });
    // Second page adds nothing new -> loop stops; deduped to one page.
    expect(all).toHaveLength(2000);
  });

  it("keeps fills that share the boundary millisecond across a page cut", async () => {
    // 2500 fills, the last 3 of the first page share ms 5000 with 2 more that
    // did not fit in the page.
    const all = [
      ...Array.from({ length: 1997 }, (_, i) => ({ tid: i + 1, time: 1_000 + i })),
      ...Array.from({ length: 5 }, (_, i) => ({ tid: 2000 + i, time: 5_000 })),
      ...Array.from({ length: 10 }, (_, i) => ({ tid: 3000 + i, time: 6_000 + i })),
    ];
    const fetchPage = async ({ startTime }) =>
      all.filter((fill) => fill.time >= startTime).slice(0, 2000);

    const result = await fetchAllUserFills({ user: "0xabc", fetchPage });
    expect(result).toHaveLength(all.length);
  });
});
