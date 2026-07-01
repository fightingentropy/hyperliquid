import { describe, expect, it } from "vitest";
import {
  buildActiveTwapRows,
  buildTwapMarketDirectory,
  computeFeeStats,
  createTwapTrackerState,
  projectTwapPressure,
  reconcileActiveTwaps,
  selectTwapMarketSources,
  summarizeTwapPressure,
  twapMarketSegment,
  twapRemainingFraction,
} from "./hypurrscan";

const HOUR = 3600;
const DAY = 24 * HOUR;

describe("computeFeeStats", () => {
  it("derives the 24h fee total, prior day, and percent change", () => {
    const fees = [
      { time: 0, total_fees: 0 },
      { time: DAY, total_fees: 100_000_000 }, // $100 by end of the prior day
      { time: 2 * DAY, total_fees: 250_000_000 }, // +$150 over the latest day
    ];

    const stats = computeFeeStats(fees);

    expect(stats.daily).toBe(150);
    expect(stats.previous).toBe(100);
    expect(stats.changePct).toBeCloseTo(50, 6);
  });

  it("buckets the latest 24 hours, using each bucket's first/last snapshot", () => {
    const fees = [
      { time: HOUR, total_fees: 0 },
      { time: HOUR + 400, total_fees: 5_000_000 }, // +$5 inside the first bucket
      { time: DAY, total_fees: 9_000_000 },
    ];

    const stats = computeFeeStats(fees);

    expect(stats.hourly).toHaveLength(24);
    expect(stats.hourly[0].startSec).toBe(HOUR);
    expect(stats.hourly[0].value).toBe(5);
    // A bucket with fewer than two snapshots contributes zero.
    expect(stats.hourly[10].value).toBe(0);
  });

  it("returns empty stats when there is not enough data", () => {
    expect(computeFeeStats([])).toEqual({
      daily: null,
      previous: null,
      changePct: null,
      hourly: [],
    });
    expect(computeFeeStats([{ time: 0, total_fees: 1 }]).daily).toBeNull();
  });

  it("suppresses the percent change when the prior day is zero", () => {
    const fees = [
      { time: 0, total_fees: 0 },
      { time: DAY, total_fees: 0 },
      { time: 2 * DAY, total_fees: 5_000_000 },
    ];

    expect(computeFeeStats(fees).changePct).toBeNull();
  });
});

describe("twapMarketSegment", () => {
  it("splits asset ids into perp, spot, and hip3 ranges like hypurrscan", () => {
    expect(twapMarketSegment(0)).toBe("perp");
    expect(twapMarketSegment(9_999)).toBe("perp");
    expect(twapMarketSegment(10_000)).toBe("spot");
    expect(twapMarketSegment(99_999)).toBe("spot");
    expect(twapMarketSegment(100_000)).toBe("hip3");
    expect(twapMarketSegment(110_065)).toBe("hip3");
    expect(twapMarketSegment(-1)).toBeNull();
    expect(twapMarketSegment(Number.NaN)).toBeNull();
  });
});

describe("selectTwapMarketSources", () => {
  it("reports which universes a set of asset ids requires", () => {
    expect(selectTwapMarketSources([5, 10_107, 110_065, 130_001, 110_003])).toEqual({
      needsPerp: true,
      needsSpot: true,
      hip3DexIndexes: [1, 3],
    });
  });

  it("handles empty or malformed input", () => {
    expect(selectTwapMarketSources(null)).toEqual({
      needsPerp: false,
      needsSpot: false,
      hip3DexIndexes: [],
    });
  });
});

describe("buildTwapMarketDirectory", () => {
  const perpsByDexIndex = {
    0: [
      { universe: [{ name: "BTC" }, { name: "ETH" }] },
      [{ midPx: "50000" }, { markPx: "3000" }],
    ],
    1: [
      { universe: [{ name: "xyz:XYZ100" }] },
      [{ midPx: "20000" }],
    ],
  };
  const spotMetaAndAssetCtxs = [
    {
      tokens: [
        { name: "USDC", index: 0 },
        { name: "HYPE", index: 150 },
      ],
      universe: [{ name: "@107", index: 107, tokens: [150, 0] }],
    },
    [{ coin: "@107", midPx: "68" }],
  ];

  it("maps every universe onto hypurrscan's asset-id layout with display names", () => {
    const directory = buildTwapMarketDirectory({ perpsByDexIndex, spotMetaAndAssetCtxs });

    expect(directory.get(0)).toMatchObject({
      displayName: "BTC-USD",
      iconCoin: "BTC",
      segment: "perp",
      price: 50_000,
    });
    // Falls back to markPx when midPx is missing.
    expect(directory.get(1)).toMatchObject({ displayName: "ETH-USD", price: 3_000 });
    // HIP-3 dex index 1 starts at 110000 and keeps the dex-prefixed name.
    expect(directory.get(110_000)).toMatchObject({
      displayName: "xyz:XYZ100",
      segment: "hip3",
      price: 20_000,
    });
    // Spot pairs live at 10000 + pair index and display the base token.
    expect(directory.get(10_107)).toMatchObject({
      displayName: "HYPE",
      segment: "spot",
      price: 68,
      isHypeSpot: true,
    });
  });

  it("tolerates missing sources", () => {
    expect(buildTwapMarketDirectory({}).size).toBe(0);
    expect(buildTwapMarketDirectory({ spotMetaAndAssetCtxs: null }).size).toBe(0);
  });
});

describe("reconcileActiveTwaps", () => {
  const now = 1_000_000_000_000;
  const entry = (over) => ({
    hash: over.hash,
    time: over.time,
    user: over.user ?? "0xabc",
    ended: over.ended,
    action: {
      twap: { a: over.a ?? 10107, b: over.b ?? true, s: over.s ?? "100", m: over.m ?? 60 },
    },
  });

  it("keeps running orders across every market and drops finished ones", () => {
    const twaps = [
      entry({ hash: "a", time: now - 10 * 60 * 1000 }), // spot, ends 50m out
      entry({ hash: "b", time: now - 120 * 60 * 1000 }), // already finished
      entry({ hash: "c", time: now, a: 5 }), // perp
      entry({ hash: "d", time: now, a: 110_065 }), // hip3
    ];

    const state = reconcileActiveTwaps(createTwapTrackerState(), twaps, now);

    expect(state.activeByHash.size).toBe(3);
    expect(state.activeByHash.get("a")).toMatchObject({
      user: "0xabc",
      marketId: 10_107,
      segment: "spot",
      isBuy: true,
      amount: 100,
      end: now + 50 * 60 * 1000,
    });
    expect(state.activeByHash.get("c").segment).toBe("perp");
    expect(state.activeByHash.get("d").segment).toBe("hip3");
    expect(state.endedHashes.has("b")).toBe(true);
  });

  it("removes an order on any truthy ended flag, including the \"error\" variant", () => {
    let state = reconcileActiveTwaps(
      createTwapTrackerState(),
      [entry({ hash: "a", time: now - 5 * 60 * 1000 })],
      now,
    );
    expect(state.activeByHash.size).toBe(1);

    // The feed reports ended as `true` for cancellations and "error" strings.
    state = reconcileActiveTwaps(
      state,
      [entry({ hash: "a", time: now - 5 * 60 * 1000, ended: "error" })],
      now,
    );
    expect(state.activeByHash.size).toBe(0);
    expect(state.endedHashes.has("a")).toBe(true);

    // A later sighting of the same hash stays dropped.
    state = reconcileActiveTwaps(
      state,
      [entry({ hash: "a", time: now - 5 * 60 * 1000 })],
      now,
    );
    expect(state.activeByHash.size).toBe(0);
  });

  it("retains an order that scrolls out of the feed window until it expires", () => {
    let state = reconcileActiveTwaps(
      createTwapTrackerState(),
      [entry({ hash: "a", time: now - 10 * 60 * 1000, m: 60 })],
      now,
    );

    // Order no longer present in the feed, but not ended and not expired.
    state = reconcileActiveTwaps(state, [], now + 60_000);
    expect(state.activeByHash.size).toBe(1);

    // Now past its natural end -> pruned.
    state = reconcileActiveTwaps(state, [], now + 51 * 60 * 1000);
    expect(state.activeByHash.size).toBe(0);
  });

  it("ignores malformed entries", () => {
    const state = reconcileActiveTwaps(
      createTwapTrackerState(),
      [
        entry({ hash: "a", time: now, s: "-5" }), // negative size
        entry({ hash: "b", time: now, m: 0 }), // no duration
        { hash: "c", time: now, action: {} }, // no twap payload
      ],
      now,
    );

    expect(state.activeByHash.size).toBe(0);
  });
});

describe("buildActiveTwapRows", () => {
  const now = 1_000_000_000_000;

  it("labels and values rows from the directory, tracking price updates", () => {
    const state = reconcileActiveTwaps(
      createTwapTrackerState(),
      [
        {
          hash: "a",
          time: now,
          user: "0xabc",
          action: { twap: { a: 10_107, b: false, s: "100", m: 60 } },
        },
      ],
      now,
    );

    const directory = new Map([
      [10_107, { displayName: "HYPE", iconCoin: "HYPE", price: 68, isHypeSpot: true }],
    ]);
    expect(buildActiveTwapRows(state, directory)[0]).toMatchObject({
      token: "HYPE",
      value: 6_800,
      isBuy: false,
      isHypeSpot: true,
    });

    // Value follows the latest price (hypurrscan recomputes per poll).
    directory.get(10_107).price = 99;
    expect(buildActiveTwapRows(state, directory)[0].value).toBe(9_900);
  });

  it("keeps unpriced markets with a null value", () => {
    const state = reconcileActiveTwaps(
      createTwapTrackerState(),
      [{ hash: "a", time: now, action: { twap: { a: 42, b: true, s: "1", m: 60 } } }],
      now,
    );

    expect(buildActiveTwapRows(state, new Map())[0]).toMatchObject({
      token: "#42",
      value: null,
      isHypeSpot: false,
    });
  });
});

describe("twapRemainingFraction", () => {
  const now = 1_000_000_000_000;

  it("reports the linear share of the order still to execute", () => {
    const record = { end: now + 30 * 60 * 1000, durationMs: 60 * 60 * 1000 };

    expect(twapRemainingFraction(record, now)).toBeCloseTo(0.5, 6);
    expect(twapRemainingFraction(record, now + 30 * 60 * 1000)).toBe(0);
    expect(twapRemainingFraction(record, now - 60 * 60 * 1000)).toBe(1); // clamped
    expect(twapRemainingFraction(null, now)).toBe(0);
  });
});

describe("projectTwapPressure", () => {
  const now = 1_000_000_000_000;
  const minute = 60 * 1000;

  it("prorates each order's remaining notional across the window", () => {
    const active = [
      // $6000 over 60m, started 10m ago -> 50m left, all inside the next hour.
      {
        start: now - 10 * minute,
        end: now + 50 * minute,
        durationMs: 60 * minute,
        isBuy: true,
        value: 6000,
      },
      // $3600 over 60m, just started -> only its first hour overlaps.
      {
        start: now,
        end: now + 60 * minute,
        durationMs: 60 * minute,
        isBuy: false,
        value: 3600,
      },
    ];

    // Buy contributes 6000 * 50/60 = 5000, sell contributes -3600.
    expect(projectTwapPressure(active, now, 60 * minute)).toBe(1400);
  });

  it("ignores orders that have already ended", () => {
    const active = [
      { start: now - 90 * minute, end: now - 30 * minute, durationMs: 60 * minute, isBuy: true, value: 1000 },
    ];

    expect(projectTwapPressure(active, now, 60 * minute)).toBe(0);
  });

  it("summarizes 1h and 24h windows and counts active orders", () => {
    const active = [
      { start: now, end: now + 12 * 60 * minute, durationMs: 12 * 60 * minute, isBuy: true, value: 2400 },
    ];

    const summary = summarizeTwapPressure(active, now);

    // 1h slice of a 12h order: 2400 * 1/12 = 200.
    expect(summary.next1h).toBeCloseTo(200, 6);
    expect(summary.next24h).toBeCloseTo(2400, 6);
    expect(summary.activeCount).toBe(1);
  });
});
