import { describe, expect, it } from "vitest";
import { buildTradeRows, buildTradeTimeline, buildTwapRows, summarizeTradeData } from "./wallet";

function rawFill(overrides) {
  return {
    coin: "HYPE",
    px: "10",
    sz: "1",
    side: "A",
    dir: "Close Short",
    time: 1000,
    closedPnl: "0",
    fee: "0",
    hash: "0xhash",
    tid: 1,
    twapId: null,
    ...overrides,
  };
}

describe("buildTradeTimeline aggregation", () => {
  it("collapses consecutive same coin+direction fills into a Fill ×N row", () => {
    const fills = buildTradeRows([
      rawFill({ time: 300, px: "10", sz: "2", fee: "0.1", closedPnl: "5", tid: 1 }),
      rawFill({ time: 200, px: "20", sz: "1", fee: "0.2", closedPnl: "3", tid: 2 }),
      rawFill({ coin: "BTC", dir: "Open Long", side: "B", time: 100, px: "100", sz: "0.5", fee: "0.05", tid: 3 }),
    ]);

    const timeline = buildTradeTimeline(fills, [], { aggregate: true });

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      type: "fill",
      count: 2,
      coin: "HYPE",
      direction: "CLOSE SHORT",
      size: 3,
      notionalUsd: 40,
      feeUsd: expect.closeTo(0.3, 6),
      closedPnlUsd: 8,
      startTime: 200,
      endTime: 300,
      parsedTime: 300,
    });
    // Size-weighted average price: (10*2 + 20*1) / 3
    expect(timeline[0].price).toBeCloseTo(40 / 3, 6);
    expect(timeline[1]).toMatchObject({ type: "fill", count: 1, coin: "BTC" });
  });

  it("does not merge same coin+direction fills separated by another coin", () => {
    const fills = buildTradeRows([
      rawFill({ time: 300, tid: 1 }),
      rawFill({ coin: "BTC", dir: "Open Long", side: "B", time: 250, tid: 2 }),
      rawFill({ time: 200, tid: 3 }),
    ]);

    const timeline = buildTradeTimeline(fills, [], { aggregate: true });
    expect(timeline.map((row) => row.coin)).toEqual(["HYPE", "BTC", "HYPE"]);
    expect(timeline.every((row) => row.count === 1)).toBe(true);
  });

  it("emits one row per fill when aggregation is off", () => {
    const fills = buildTradeRows([
      rawFill({ time: 300, tid: 1 }),
      rawFill({ time: 200, tid: 2 }),
    ]);

    const timeline = buildTradeTimeline(fills, [], { aggregate: false });
    expect(timeline).toHaveLength(2);
    expect(timeline.every((row) => row.type === "fill" && row.count === 1)).toBe(true);
  });
});

describe("buildTwapRows", () => {
  it("normalizes executed/total size, direction, average price, and status", () => {
    const [row] = buildTwapRows([
      {
        time: 1500,
        twapId: 42,
        state: {
          coin: "HYPE",
          side: "A",
          sz: "100",
          executedSz: "40",
          executedNtl: "800",
          timestamp: 1_500_000,
        },
        status: { status: "terminated" },
      },
    ]);

    expect(row).toMatchObject({
      type: "twap",
      coin: "HYPE",
      direction: "SELL",
      size: 40,
      totalSize: 100,
      notionalUsd: 800,
      statusLabel: "Terminated",
      parsedTime: 1_500_000,
    });
    expect(row.price).toBeCloseTo(20, 6);
  });

  it("collapses multiple lifecycle events of one TWAP into a single terminal row", () => {
    const rows = buildTwapRows([
      {
        time: 100,
        twapId: 7,
        state: { coin: "HYPE", side: "B", sz: "10", executedSz: "0", executedNtl: "0", timestamp: 100000 },
        status: { status: "activated" },
      },
      {
        time: 200,
        twapId: 7,
        state: { coin: "HYPE", side: "B", sz: "10", executedSz: "10", executedNtl: "100", timestamp: 100000 },
        status: { status: "finished" },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ twapId: 7, statusLabel: "Finished", size: 10, notionalUsd: 100 });
  });
});

describe("buildTradeTimeline TWAP merge", () => {
  it("folds covered twap sub-fills into the TWAP row and merges by time", () => {
    const twaps = [
      {
        time: 250,
        twapId: 42,
        state: { coin: "HYPE", side: "B", sz: "10", executedSz: "10", executedNtl: "100", timestamp: 250 },
        status: { status: "finished" },
      },
    ];
    const fills = buildTradeRows([
      rawFill({ coin: "NEAR", dir: "Open Long", side: "B", time: 300, tid: 1 }),
      // Sub-fill of the covered TWAP — must not appear as its own fill row.
      rawFill({ coin: "HYPE", dir: "Open Long", side: "B", time: 250, tid: 2, twapId: 42 }),
      rawFill({ coin: "BTC", dir: "Open Long", side: "B", time: 100, tid: 3 }),
    ]);

    const timeline = buildTradeTimeline(fills, twaps, { aggregate: true });

    expect(timeline.map((row) => [row.type, row.coin])).toEqual([
      ["fill", "NEAR"],
      ["twap", "HYPE"],
      ["fill", "BTC"],
    ]);
    // The HYPE entry is the TWAP, never a duplicate fill row.
    expect(timeline.filter((row) => row.coin === "HYPE")).toHaveLength(1);
  });

  it("synthesizes a TWAP row for sub-fills missing from twapHistory", () => {
    const fills = buildTradeRows([
      rawFill({ coin: "HYPE", dir: "Open Long", side: "B", time: 200, tid: 1, twapId: 99, px: "10", sz: "3" }),
      rawFill({ coin: "HYPE", dir: "Open Long", side: "B", time: 150, tid: 2, twapId: 99, px: "10", sz: "2" }),
    ]);

    const timeline = buildTradeTimeline(fills, [], { aggregate: true });
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ type: "twap", coin: "HYPE", size: 5, totalSize: 5, statusLabel: "—" });
  });
});

describe("summarizeTradeData", () => {
  it("reports raw fill count, distinct TWAP orders, and the overall time span", () => {
    const fills = buildTradeRows([rawFill({ time: 300 }), rawFill({ time: 100 })]);
    // Two lifecycle events for one order (id 5) plus a second order (id 6).
    const twaps = [
      { time: 40, twapId: 5, state: { coin: "HYPE", side: "B", sz: "1", executedSz: "0", executedNtl: "0", timestamp: 400 }, status: { status: "activated" } },
      { time: 50, twapId: 5, state: { coin: "HYPE", side: "B", sz: "1", executedSz: "1", executedNtl: "1", timestamp: 400 }, status: { status: "finished" } },
      { time: 60, twapId: 6, state: { coin: "BTC", side: "A", sz: "2", executedSz: "2", executedNtl: "8", timestamp: 500 }, status: { status: "finished" } },
    ];

    const summary = summarizeTradeData(fills, twaps);
    expect(summary.fillCount).toBe(2);
    expect(summary.twapCount).toBe(2);
    expect(summary.startTime).toBe(100);
    expect(summary.endTime).toBe(500);
  });
});
