import { describe, expect, it } from "vitest";
import { createSqliteD1 } from "../../../src/test-support/sqliteD1.js";
import {
  advanceCursor,
  mapPositions,
  normalizeCursor,
  runSweep,
  selectBatch,
} from "./sweep.ts";

const TRACKED = ["BTC", "ETH", "kPEPE"];
const TRACKED_SET = new Set(TRACKED);
const NOW = 1_800_000_000_000;

function position(coin, szi, liquidationPx, positionValue = "1000") {
  return { type: "oneWay", position: { coin, szi, liquidationPx, positionValue } };
}

function state(time, ...positions) {
  return { time, assetPositions: positions };
}

describe("mapPositions", () => {
  it("parses strings, keeps the sign of szi and uses state.time as the snapshot time", () => {
    const rows = mapPositions(
      state(
        1_700_000_000_123,
        position("BTC", "12.5", "61234.5", "765431.25"),
        position("ETH", "-40.25", "2900.1", "91000.5"),
      ),
      TRACKED_SET,
      NOW,
    );

    expect(rows).toEqual([
      { coin: "BTC", liquidationPx: 61234.5, size: 12.5, positionUsd: 765431.25, snapshotTime: 1_700_000_000_123 },
      { coin: "ETH", liquidationPx: 2900.1, size: -40.25, positionUsd: 91000.5, snapshotTime: 1_700_000_000_123 },
    ]);
  });

  it("skips null, missing, zero, negative and non-numeric liquidation prices", () => {
    const rows = mapPositions(
      state(
        NOW,
        position("BTC", "1", null),
        position("ETH", "1", undefined),
        position("kPEPE", "1", "0"),
        position("BTC", "1", "-5"),
        position("ETH", "1", "abc"),
        position("ETH", "1", ""),
      ),
      TRACKED_SET,
      NOW,
    );

    expect(rows).toEqual([]);
  });

  it("skips untracked coins and zero or invalid sizes", () => {
    const rows = mapPositions(
      state(
        NOW,
        position("DOGE", "5", "0.01"),
        position("BTC", "0", "100"),
        position("ETH", "oops", "100"),
        position("kPEPE", "-3", "0.0123"),
      ),
      TRACKED_SET,
      NOW,
    );

    expect(rows.map((row) => row.coin)).toEqual(["kPEPE"]);
    expect(rows[0].size).toBe(-3);
  });

  it("keeps the absolute notional and de-duplicates a repeated coin", () => {
    const rows = mapPositions(
      state(NOW, position("BTC", "-1", "90000", "-5000"), position("BTC", "-2", "91000", "7000")),
      TRACKED_SET,
      NOW,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ liquidationPx: 91000, size: -2, positionUsd: 7000 });
  });

  it("falls back to the supplied time and tolerates malformed responses", () => {
    expect(mapPositions(state(undefined, position("BTC", "1", "10")), TRACKED_SET, NOW)[0].snapshotTime).toBe(NOW);
    expect(mapPositions(null, TRACKED_SET, NOW)).toEqual([]);
    expect(mapPositions({}, TRACKED_SET, NOW)).toEqual([]);
    expect(mapPositions({ assetPositions: [null, {}, { position: null }] }, TRACKED_SET, NOW)).toEqual([]);
  });
});

describe("cursor handling", () => {
  const wallets = ["a", "b", "c", "d", "e"];

  it("selects a batch from the cursor", () => {
    expect(selectBatch(wallets, 1, 2)).toEqual({ start: 1, addresses: ["b", "c"] });
  });

  it("wraps around the end of the list within one batch", () => {
    expect(selectBatch(wallets, 4, 3)).toEqual({ start: 4, addresses: ["e", "a", "b"] });
  });

  it("never repeats a wallet when the batch is larger than the list", () => {
    expect(selectBatch(wallets, 2, 50).addresses).toEqual(["c", "d", "e", "a", "b"]);
  });

  it("treats a missing, negative, non-numeric or out-of-range cursor as a valid index", () => {
    expect(normalizeCursor(undefined, 5)).toBe(0);
    expect(normalizeCursor("-3", 5)).toBe(0);
    expect(normalizeCursor("abc", 5)).toBe(0);
    expect(normalizeCursor("12", 5)).toBe(2);
    expect(selectBatch([], 3, 10)).toEqual({ start: 0, addresses: [] });
  });

  it("reports a wrap when the cursor passes the end of the list", () => {
    expect(advanceCursor(0, 3, 5)).toEqual({ cursor: 3, wrapped: false });
    expect(advanceCursor(3, 2, 5)).toEqual({ cursor: 0, wrapped: true });
    expect(advanceCursor(4, 3, 5)).toEqual({ cursor: 2, wrapped: true });
    expect(advanceCursor(4, 0, 5)).toEqual({ cursor: 4, wrapped: false });
  });
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Fake Hyperliquid: `states` maps address -> clearinghouseState body, a Response, or a function.
function createFakeHyperliquid({ states = {}, mids = { BTC: "70000", ETH: "3000", kPEPE: "0.005", DOGE: "0.2" }, midsResponse } = {}) {
  const calls = [];
  const inFlight = { current: 0, max: 0 };

  async function fetchImpl(url, init) {
    expect(url).toBe("https://api.hyperliquid.xyz/info");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body);
    calls.push(body);

    inFlight.current += 1;
    inFlight.max = Math.max(inFlight.max, inFlight.current);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));

      if (body.type === "allMids") {
        return midsResponse ? midsResponse() : jsonResponse(mids);
      }

      const entry = states[body.user];
      if (typeof entry === "function") {
        return entry(calls.filter((call) => call.user === body.user).length);
      }
      return entry instanceof Response ? entry.clone() : jsonResponse(entry ?? state(NOW));
    } finally {
      inFlight.current -= 1;
    }
  }

  return {
    fetchImpl,
    calls,
    inFlight,
    userCalls: (address) => calls.filter((call) => call.user === address),
  };
}

function readMeta(db) {
  return Object.fromEntries(
    db.sqlite.prepare("SELECT key, value FROM liq_meta").all().map((row) => [row.key, row.value]),
  );
}

function readPositions(db, address) {
  return db.sqlite
    .prepare("SELECT coin, liquidation_px, size, position_usd, snapshot_time FROM liq_positions WHERE address = ? ORDER BY coin")
    .all(address)
    .map((row) => ({ ...row }));
}

const WALLETS = ["0xaa", "0xbb", "0xcc", "0xdd", "0xee"];

function sweepOptions(db, hyperliquid, overrides = {}) {
  return {
    db,
    wallets: WALLETS,
    tracked: TRACKED,
    batchSize: 5,
    fetchImpl: hyperliquid.fetchImpl,
    now: () => NOW,
    ...overrides,
  };
}

describe("runSweep", () => {
  it("stores mapped positions, tracked prices and sweeper state", async () => {
    const db = createSqliteD1();
    const hyperliquid = createFakeHyperliquid({
      states: {
        "0xaa": state(
          NOW - 500,
          position("BTC", "2", "60000.5", "140000"),
          position("ETH", "-10", "3500", "30000"),
          position("kPEPE", "5", null),
          position("DOGE", "100", "0.1"),
        ),
        "0xbb": state(NOW - 400),
      },
    });

    const result = await runSweep(sweepOptions(db, hyperliquid));

    expect(result).toMatchObject({
      attempted: 5,
      ok: 5,
      failed: 0,
      rateLimited: false,
      cursorBefore: 0,
      cursorAfter: 0,
      wrapped: true,
      rowsWritten: 2,
      pricesWritten: 3,
      error: null,
    });
    expect(readPositions(db, "0xaa")).toEqual([
      { coin: "BTC", liquidation_px: 60000.5, size: 2, position_usd: 140000, snapshot_time: NOW - 500 },
      { coin: "ETH", liquidation_px: 3500, size: -10, position_usd: 30000, snapshot_time: NOW - 500 },
    ]);
    expect(
      db.sqlite.prepare("SELECT coin, mid, updated_at FROM liq_prices ORDER BY coin").all().map((row) => ({ ...row })),
    ).toEqual([
      { coin: "BTC", mid: 70000, updated_at: NOW },
      { coin: "ETH", mid: 3000, updated_at: NOW },
      { coin: "kPEPE", mid: 0.005, updated_at: NOW },
    ]);
    expect(readMeta(db)).toMatchObject({
      cursor: "0",
      last_run_at: String(NOW),
      last_full_cycle_at: String(NOW),
      wallets_total: "5",
      last_error: "",
    });
    expect(hyperliquid.calls.filter((call) => call.type === "allMids")).toHaveLength(1);
    expect(hyperliquid.calls.filter((call) => call.type === "clearinghouseState")).toHaveLength(5);
  });

  it("replaces a wallet's previous rows, including closing every position", async () => {
    const db = createSqliteD1();
    let current = {
      "0xaa": state(NOW, position("BTC", "1", "50000"), position("ETH", "1", "2000")),
    };
    const hyperliquid = createFakeHyperliquid({
      states: { "0xaa": () => jsonResponse(current["0xaa"]) },
    });
    const options = sweepOptions(db, hyperliquid, { wallets: ["0xaa"], batchSize: 1 });

    await runSweep(options);
    expect(readPositions(db, "0xaa").map((row) => row.coin)).toEqual(["BTC", "ETH"]);

    current = { "0xaa": state(NOW, position("ETH", "1", "2100")) };
    await runSweep(options);
    expect(readPositions(db, "0xaa")).toMatchObject([{ coin: "ETH", liquidation_px: 2100 }]);

    current = { "0xaa": state(NOW) };
    await runSweep(options);
    expect(readPositions(db, "0xaa")).toEqual([]);
  });

  it("walks the wallet list across runs and records the full cycle when the cursor wraps", async () => {
    const db = createSqliteD1();
    const hyperliquid = createFakeHyperliquid();
    let clock = NOW;
    const options = sweepOptions(db, hyperliquid, { batchSize: 3, now: () => clock });

    await runSweep(options);
    expect(hyperliquid.calls.filter((call) => call.user).map((call) => call.user).sort()).toEqual(["0xaa", "0xbb", "0xcc"]);
    expect(readMeta(db)).toMatchObject({ cursor: "3" });
    expect(readMeta(db).last_full_cycle_at).toBeUndefined();

    hyperliquid.calls.length = 0;
    clock = NOW + 60_000;
    const second = await runSweep(options);
    expect(hyperliquid.calls.filter((call) => call.user).map((call) => call.user).sort()).toEqual(["0xaa", "0xdd", "0xee"]);
    expect(second).toMatchObject({ cursorBefore: 3, cursorAfter: 1, wrapped: true });
    expect(readMeta(db)).toMatchObject({ cursor: "1", last_full_cycle_at: String(NOW + 60_000) });
  });

  it("calls at most four wallets at once", async () => {
    const db = createSqliteD1();
    const hyperliquid = createFakeHyperliquid();
    const wallets = Array.from({ length: 20 }, (_, index) => `0x${index}`);

    await runSweep(sweepOptions(db, hyperliquid, { wallets, batchSize: 20 }));

    expect(hyperliquid.inFlight.max).toBe(4);
  });

  it("retries a failed wallet request once", async () => {
    const db = createSqliteD1();
    const hyperliquid = createFakeHyperliquid({
      states: {
        "0xaa": (attempt) =>
          attempt === 1
            ? new Response("upstream error", { status: 502 })
            : jsonResponse(state(NOW, position("BTC", "1", "50000"))),
      },
    });

    const result = await runSweep(sweepOptions(db, hyperliquid, { wallets: ["0xaa"], batchSize: 1 }));

    expect(hyperliquid.userCalls("0xaa")).toHaveLength(2);
    expect(result).toMatchObject({ ok: 1, failed: 0, error: null });
    expect(readPositions(db, "0xaa")).toHaveLength(1);
  });

  it("does not retry a client error", async () => {
    const db = createSqliteD1();
    const hyperliquid = createFakeHyperliquid({
      states: { "0xaa": new Response("bad user", { status: 422 }) },
    });

    const result = await runSweep(sweepOptions(db, hyperliquid, { wallets: ["0xaa"], batchSize: 1 }));

    expect(hyperliquid.userCalls("0xaa")).toHaveLength(1);
    expect(result.failed).toBe(1);
    expect(result.error).toContain("HTTP 422");
  });

  it("keeps a failing wallet's previous rows and still advances past it", async () => {
    const db = createSqliteD1();
    const healthy = createFakeHyperliquid({
      states: {
        "0xaa": state(NOW, position("BTC", "1", "50000")),
        "0xbb": state(NOW, position("ETH", "1", "2000")),
      },
    });
    await runSweep(sweepOptions(db, healthy, { wallets: ["0xaa", "0xbb"], batchSize: 2 }));

    const failing = createFakeHyperliquid({
      states: {
        "0xaa": () => new Response("down", { status: 503 }),
        "0xbb": state(NOW + 1, position("ETH", "1", "2200")),
      },
    });
    const result = await runSweep(sweepOptions(db, failing, { wallets: ["0xaa", "0xbb"], batchSize: 2 }));

    expect(failing.userCalls("0xaa")).toHaveLength(2);
    expect(result).toMatchObject({ ok: 1, failed: 1, cursorAfter: 0 });
    expect(result.error).toContain("1 wallet requests failed");
    expect(readPositions(db, "0xaa")).toMatchObject([{ coin: "BTC", liquidation_px: 50000 }]);
    expect(readPositions(db, "0xbb")).toMatchObject([{ coin: "ETH", liquidation_px: 2200 }]);
    expect(readMeta(db).last_error).toContain("503");
  });

  it("stops on HTTP 429, records it, and resumes from the rate-limited wallet", async () => {
    const db = createSqliteD1();
    const hyperliquid = createFakeHyperliquid({
      states: {
        "0xaa": state(NOW, position("BTC", "1", "50000")),
        "0xbb": new Response("slow down", { status: 429 }),
      },
    });

    const result = await runSweep(sweepOptions(db, hyperliquid, { concurrency: 1 }));

    expect(result).toMatchObject({ attempted: 1, ok: 1, rateLimited: true, cursorAfter: 1, wrapped: false });
    expect(result.error).toContain("429");
    expect(hyperliquid.userCalls("0xbb")).toHaveLength(1);
    expect(hyperliquid.userCalls("0xcc")).toHaveLength(0);
    expect(readMeta(db)).toMatchObject({ cursor: "1" });
    expect(readMeta(db).last_error).toContain("rate limited (HTTP 429)");
    expect(JSON.parse(readMeta(db).last_run_stats)).toMatchObject({ rateLimited: true, ok: 1 });
    expect(readPositions(db, "0xaa")).toHaveLength(1);
    // Prices from the allMids call that succeeded are still stored.
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM liq_prices").get().n).toBe(3);
  });

  it("makes no wallet requests when allMids is rate limited", async () => {
    const db = createSqliteD1();
    const hyperliquid = createFakeHyperliquid({
      midsResponse: () => new Response("slow down", { status: 429 }),
    });

    const result = await runSweep(sweepOptions(db, hyperliquid));

    expect(hyperliquid.calls).toEqual([{ type: "allMids" }]);
    expect(result).toMatchObject({ attempted: 0, rateLimited: true, cursorAfter: 0 });
    expect(readMeta(db).last_error).toContain("allMids");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM liq_prices").get().n).toBe(0);
  });

  it("still sweeps wallets when allMids fails for another reason", async () => {
    const db = createSqliteD1();
    const hyperliquid = createFakeHyperliquid({
      states: { "0xaa": state(NOW, position("BTC", "1", "50000")) },
      midsResponse: () => new Response("oops", { status: 400 }),
    });

    const result = await runSweep(sweepOptions(db, hyperliquid, { wallets: ["0xaa"], batchSize: 1 }));

    expect(result).toMatchObject({ ok: 1, pricesWritten: 0 });
    expect(result.error).toContain("allMids");
    expect(readPositions(db, "0xaa")).toHaveLength(1);
  });

  it("stops starting wallets once the time budget is spent", async () => {
    const db = createSqliteD1();
    const clock = { now: NOW };
    const hyperliquid = createFakeHyperliquid();
    const slowFetch = async (url, init) => {
      clock.now += 20_000;
      return hyperliquid.fetchImpl(url, init);
    };

    const result = await runSweep(
      sweepOptions(db, hyperliquid, {
        fetchImpl: slowFetch,
        now: () => clock.now,
        concurrency: 1,
        budgetMs: 45_000,
      }),
    );

    expect(result.attempted).toBe(2);
    expect(result.cursorAfter).toBe(2);
    expect(result.error).toContain("time budget");
  });

  it("deletes rows nobody has refreshed for hours when a cycle completes", async () => {
    const db = createSqliteD1();
    const insert = db.sqlite.prepare(
      "INSERT INTO liq_positions (address, coin, liquidation_px, size, position_usd, snapshot_time) VALUES (?, 'BTC', 1, 1, 1, ?)",
    );
    insert.run("0xremoved", NOW - 3 * 60 * 60 * 1000);
    insert.run("0xrecent", NOW - 60 * 1000);

    const hyperliquid = createFakeHyperliquid();
    await runSweep(sweepOptions(db, hyperliquid, { batchSize: 2 }));
    expect(readPositions(db, "0xremoved")).toHaveLength(1);

    await runSweep(sweepOptions(db, hyperliquid, { batchSize: 3 }));
    await runSweep(sweepOptions(db, hyperliquid, { batchSize: 3 }));
    expect(readMeta(db).last_full_cycle_at).toBeDefined();
    expect(readPositions(db, "0xremoved")).toEqual([]);
    expect(readPositions(db, "0xrecent")).toHaveLength(1);
  });

  it("records an empty wallet list instead of failing", async () => {
    const db = createSqliteD1();
    const hyperliquid = createFakeHyperliquid();

    const result = await runSweep(sweepOptions(db, hyperliquid, { wallets: [] }));

    expect(result).toMatchObject({ attempted: 0, wrapped: false, error: "wallet list is empty" });
    expect(readMeta(db)).toMatchObject({ wallets_total: "0", last_error: "wallet list is empty" });
  });
});
