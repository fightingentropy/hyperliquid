import { describe, expect, it } from "vitest";
import {
  activeTwapsFromState,
  computeFeeStats,
  createTwapTrackerState,
  projectTwapPressure,
  reconcileHypeTwaps,
  selectHypeSpotPriceByAssetId,
  summarizeTwapPressure,
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

describe("selectHypeSpotPriceByAssetId", () => {
  it("maps HYPE-base spot pairs to asset id 10000 + index with the mid price", () => {
    const meta = {
      tokens: [
        { name: "USDC", index: 0 },
        { name: "HYPE", index: 150 },
        { name: "PURR", index: 1 },
      ],
      universe: [
        { index: 0, tokens: [1, 0] }, // PURR/USDC
        { index: 107, tokens: [150, 0] }, // HYPE/USDC
        { index: 207, tokens: [150, 268] }, // HYPE/USDT0
      ],
    };
    // assetCtxs is keyed by the pair's `index` field (not its array position),
    // and is sparse/longer than the universe on the live API.
    const ctxs = [];
    ctxs[0] = { midPx: "0.3" };
    ctxs[107] = { midPx: "68" };
    ctxs[207] = { midPx: "67.7" };

    const prices = selectHypeSpotPriceByAssetId([meta, ctxs]);

    expect(prices).toEqual({ 10107: 68, 10207: 67.7 });
  });

  it("returns an empty map when HYPE is absent or data is malformed", () => {
    expect(selectHypeSpotPriceByAssetId(null)).toEqual({});
    expect(selectHypeSpotPriceByAssetId([{ tokens: [], universe: [] }, []])).toEqual({});
  });
});

describe("reconcileHypeTwaps", () => {
  const now = 1_000_000_000_000;
  const priceByAssetId = { 10107: 68 };
  const entry = (over) => ({
    hash: over.hash,
    time: over.time,
    ended: over.ended,
    action: { twap: { a: over.a ?? 10107, b: over.b ?? true, s: over.s ?? "100", m: over.m ?? 60 } },
  });

  it("keeps running HYPE orders and drops finished or untracked markets", () => {
    const twaps = [
      entry({ hash: "a", time: now - 10 * 60 * 1000 }), // active, ends 50m out
      entry({ hash: "b", time: now - 120 * 60 * 1000 }), // already finished
      entry({ hash: "c", time: now, a: 10999 }), // untracked market
    ];

    const state = reconcileHypeTwaps({ ...createTwapTrackerState(), twaps, priceByAssetId, now });
    const active = activeTwapsFromState(state);

    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ hash: "a", isBuy: true, value: 6800 });
    expect(active[0].end).toBe(now + 50 * 60 * 1000);
  });

  it("removes a cancelled order once it is flagged ended", () => {
    let state = reconcileHypeTwaps({
      ...createTwapTrackerState(),
      twaps: [entry({ hash: "a", time: now - 5 * 60 * 1000 })],
      priceByAssetId,
      now,
    });
    expect(activeTwapsFromState(state)).toHaveLength(1);

    // Next poll reports the same order as cancelled.
    state = reconcileHypeTwaps({
      ...state,
      twaps: [entry({ hash: "a", time: now - 5 * 60 * 1000, ended: true })],
      priceByAssetId,
      now,
    });
    expect(activeTwapsFromState(state)).toHaveLength(0);
    expect(state.endedHashes.has("a")).toBe(true);
  });

  it("retains an order that scrolls out of the feed window until it expires", () => {
    let state = reconcileHypeTwaps({
      ...createTwapTrackerState(),
      twaps: [entry({ hash: "a", time: now - 10 * 60 * 1000, m: 60 })],
      priceByAssetId,
      now,
    });

    // Order no longer present in the feed, but not ended and not expired.
    state = reconcileHypeTwaps({ ...state, twaps: [], priceByAssetId, now: now + 60_000 });
    expect(activeTwapsFromState(state)).toHaveLength(1);

    // Now past its natural end -> pruned.
    state = reconcileHypeTwaps({ ...state, twaps: [], priceByAssetId, now: now + 51 * 60 * 1000 });
    expect(activeTwapsFromState(state)).toHaveLength(0);
  });

  it("freezes notional at first sighting even if the price moves", () => {
    let state = reconcileHypeTwaps({
      ...createTwapTrackerState(),
      twaps: [entry({ hash: "a", time: now, s: "100", m: 60 })],
      priceByAssetId: { 10107: 68 },
      now,
    });

    state = reconcileHypeTwaps({
      ...state,
      twaps: [entry({ hash: "a", time: now, s: "100", m: 60 })],
      priceByAssetId: { 10107: 99 }, // price moved; value must not change
      now,
    });

    expect(activeTwapsFromState(state)[0].value).toBe(6800);
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
