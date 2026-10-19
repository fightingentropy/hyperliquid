import { describe, expect, it } from "vitest";
import {
  ASSET_OPTIONS,
  buildIntervalSeries,
  buildMarketFlowSearchParams,
  buildSpotPerpComparisonSeries,
  getSelectedMarket,
  parseMarketFlowState,
} from "./marketFlow";

describe("market-flow market selection", () => {
  it("offers every qwantify market-flow asset", () => {
    expect(ASSET_OPTIONS.map((option) => option.value)).toEqual([
      "HYPE",
      "LIT",
      "XYZ100",
      "BTC",
      "ETH",
      "SOL",
      "SP500",
      "MU",
      "SPCX",
      "SNDK",
      "SKHX",
    ]);
  });

  it("maps S&P500 to the SP500-PERP market id", () => {
    const state = parseMarketFlowState(new URLSearchParams("asset=SP500"));

    expect(getSelectedMarket(state)).toMatchObject({
      marketId: "SP500-PERP",
      candleCoin: "xyz:SP500",
      assetLabel: "S&P500",
      pairedMarketIds: null,
    });
  });

  it("keeps legacy S&P500 and HYPE spot links working", () => {
    expect(getSelectedMarket(parseMarketFlowState(new URLSearchParams("asset=XYZ:SP500")))).toMatchObject({
      marketId: "SP500-PERP",
    });
    expect(getSelectedMarket(parseMarketFlowState(new URLSearchParams("hypeMarket=HYPE-SPOT")))).toMatchObject({
      marketId: "HYPE-SPOT",
      assetLabel: "HYPE Spot",
    });
  });

  it("selects spot markets for assets that have one and falls back to perp otherwise", () => {
    const btcSpot = parseMarketFlowState(new URLSearchParams("asset=BTC&type=spot"));
    const ethSpot = parseMarketFlowState(new URLSearchParams("asset=ETH&type=spot"));

    expect(getSelectedMarket(btcSpot)).toMatchObject({
      marketId: "BTC-SPOT",
      candleCoin: "BTC",
      assetLabel: "BTC Spot",
      pairedMarketIds: { perp: "BTC-PERP", spot: "BTC-SPOT" },
    });
    expect(getSelectedMarket(ethSpot)).toMatchObject({ marketId: "ETH-PERP", marketType: "perp" });
    expect(buildMarketFlowSearchParams(btcSpot).toString()).toBe("asset=BTC&type=spot");
  });
});

describe("spot/perp comparison series", () => {
  it("accumulates the paired perp and spot summaries", () => {
    const summaries = {
      "BTC-PERP": {
        hourly: [
          { hourStart: "2026-05-01T00:00:00.000Z", netUsd: 5, buyUsd: 6, sellUsd: 1 },
          { hourStart: "2026-05-01T01:00:00.000Z", netUsd: -2, buyUsd: 1, sellUsd: 3 },
        ],
      },
      "BTC-SPOT": {
        hourly: [{ hourStart: "2026-05-01T01:00:00.000Z", netUsd: 4, buyUsd: 4, sellUsd: 0 }],
      },
    };

    const series = buildSpotPerpComparisonSeries(
      summaries,
      { perp: "BTC-PERP", spot: "BTC-SPOT" },
      "24h",
      [],
    );

    expect(series).toHaveLength(2);
    expect(series[1]).toMatchObject({ netPerpUsd: -2, netSpotUsd: 4, cumPerpUsd: 3, cumSpotUsd: 4 });
    expect(buildSpotPerpComparisonSeries(summaries, null, "24h", [])).toEqual([]);
  });
});

describe("market-flow series builders", () => {
  it("rolls 30d hourly flow into four-hour buckets", () => {
    const summary = {
      hourly: [
        {
          hourStart: "2026-05-01T00:00:00.000Z",
          netUsd: 1,
          buyUsd: 2,
          sellUsd: 1,
        },
        {
          hourStart: "2026-05-01T03:00:00.000Z",
          netUsd: 3,
          buyUsd: 4,
          sellUsd: 1,
        },
        {
          hourStart: "2026-05-01T04:00:00.000Z",
          netUsd: -2,
          buyUsd: 1,
          sellUsd: 3,
        },
      ],
    };
    const candles = [
      {
        timestamp: Date.parse("2026-05-01T03:00:00.000Z"),
        closePrice: 10,
      },
      {
        timestamp: Date.parse("2026-05-01T04:00:00.000Z"),
        closePrice: 12,
      },
    ];

    const series = buildIntervalSeries(summary, "30d", candles);

    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({
      bucketStart: "2026-05-01T00:00:00.000Z",
      netUsd: 4,
      buyUsd: 6,
      sellUsd: 2,
      closePrice: 10,
    });
    expect(series[1]).toMatchObject({
      bucketStart: "2026-05-01T04:00:00.000Z",
      netUsd: -2,
      closePrice: 12,
    });
  });
});
