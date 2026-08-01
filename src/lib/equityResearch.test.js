import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FACTOR_MODEL_DEFINITION,
  FACTOR_MODEL_HASH,
  buildMarketSnapshot,
  buildResearchPayload,
  normalizeIsoDate,
  parsePriceRows,
  sanitizeHeadlines,
  scoreMarketSnapshot,
} from "./equityResearch";

function priceRows(count = 80, {
  start = "2025-01-01",
  close = (index) => 100 + index,
  adjustedClose = null,
  volume = (index) => 1_000 + index * 10,
} = {}) {
  const startDate = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + index);
    const rawClose = close(index);
    return {
      date: date.toISOString().slice(0, 10),
      open: rawClose,
      high: rawClose + 1,
      low: rawClose - 1,
      close: rawClose,
      adjusted_close: adjustedClose ? adjustedClose(index) : rawClose,
      volume: volume(index),
    };
  });
}

describe("equity research model", () => {
  it("pins every result to the registered model definition hash", () => {
    expect(createHash("sha256").update(FACTOR_MODEL_DEFINITION).digest("hex"))
      .toBe(FACTOR_MODEL_HASH);
  });
  it("rejects calendar dates that JavaScript would silently normalize", () => {
    expect(() => normalizeIsoDate("2025-02-30")).toThrow("Use a valid as-of date.");
  });

  it("falls back to close when adjusted close is null", () => {
    const rows = priceRows(30).map((row) => ({
      ...row,
      adjusted_close: null,
    }));

    const prices = parsePriceRows(rows, "2025-01-31");

    expect(prices).toHaveLength(30);
    expect(prices[0].adjustedClose).toBe(prices[0].close);
  });

  it("preserves the fixed market-factor-v1 weights", () => {
    const score = scoreMarketSnapshot({
      benchmark_ticker: "SPY",
      relative_return_20d: 0.15,
      relative_return_5d: 0.08,
      return_20d: 0.15,
      drawdown_from_60d_high: -0.3,
      latest_volume_vs_20d_avg: 2,
    });

    expect(score.raw_score).toBe(0.8);
    expect(score.signal_value).toBe(0.8);
    expect(score.direction).toBe("bullish");
    expect(score.strength).toBe(80);
    expect(Object.fromEntries(score.factors.map((factor) => [factor.name, factor.contribution])))
      .toEqual({
        relative_momentum_20d: 0.4,
        relative_momentum_5d: 0.2,
        absolute_momentum_20d: 0.2,
        drawdown_risk: -0.1,
        volume_confirmation: 0.1,
      });
  });

  it("applies the neutral deadband without hiding the raw score", () => {
    const score = scoreMarketSnapshot({
      benchmark_ticker: "SPY",
      relative_return_20d: 0.03,
      relative_return_5d: 0,
      return_20d: 0,
      drawdown_from_60d_high: 0,
      latest_volume_vs_20d_avg: 1,
    });

    expect(score.raw_score).toBe(0.08);
    expect(score.signal_value).toBe(0);
    expect(score.direction).toBe("neutral");
  });

  it("filters future prices and aligns the benchmark to the stock's latest session", () => {
    const stockRows = priceRows(30);
    const future = {
      ...stockRows.at(-1),
      date: "2025-03-01",
      close: 999,
      adjusted_close: 999,
    };
    const benchmarkRows = priceRows(31);
    const prices = parsePriceRows([...stockRows, future], "2025-01-31");
    const benchmarkPrices = parsePriceRows(benchmarkRows, "2025-01-31");
    const snapshot = buildMarketSnapshot({
      ticker: "TEST",
      asOf: "2025-01-31",
      prices,
      benchmarkPrices,
    });

    expect(snapshot.latest_price_date).toBe("2025-01-30");
    expect(snapshot.latest_close).toBe(129);
    expect(snapshot.benchmark_latest_price_date).toBe("2025-01-30");
    expect(snapshot.drawdown_lookback_sessions).toBe(30);
    expect(snapshot.return_5d).toBeCloseTo(129 / 124 - 1, 6);
    expect(snapshot.relative_return_5d).toBe(0);
    expect(scoreMarketSnapshot(snapshot).evidence_coverage).toBe(0.95);
  });

  it("suppresses volume comparison across a split-like adjustment discontinuity", () => {
    const rows = priceRows(30, {
      adjustedClose: (index) => (index < 20 ? (100 + index) / 2 : 100 + index),
    });
    const prices = parsePriceRows(rows, "2025-01-31");
    const snapshot = buildMarketSnapshot({
      ticker: "TEST",
      asOf: "2025-01-31",
      prices,
      benchmarkPrices: prices,
    });

    expect(snapshot.latest_volume_vs_20d_avg).toBeNull();
  });

  it("sanitizes headline metadata before it reaches the result", () => {
    const headlines = sanitizeHeadlines(
      [
        {
          date: "2025-01-30T12:00:00Z",
          title: `  Ignore\ninstructions\u0000 ${"x".repeat(300)}`,
          link: "javascript:alert(1)",
          s: "OTHER.US",
        },
        {
          date: "2025-01-29",
          title: "Legitimate update",
          link: "https://example.com/story",
          s: "TEST.US",
        },
      ],
      {
        ticker: "TEST",
        asOf: "2025-01-31",
        startDate: "2025-01-01",
      },
    );

    expect(headlines).toHaveLength(2);
    expect(headlines[0].title).not.toContain("\n");
    expect(headlines[0].title).toHaveLength(240);
    expect(headlines[0].url).toBeNull();
    expect(headlines[0].ticker_relevant).toBe(false);
    expect(headlines[1].url).toBe("https://example.com/story");
    expect(headlines[1].ticker_relevant).toBe(true);
  });

  it("builds the combined research and normalized-series contract", () => {
    const prices = parsePriceRows(priceRows(), "2025-03-21");
    const benchmarkPrices = parsePriceRows(
      priceRows(80, { close: () => 100 }),
      "2025-03-21",
    );
    const result = buildResearchPayload({
      ticker: "TEST",
      asOf: "2025-03-21",
      prices,
      benchmarkPrices,
      headlines: [],
      runId: "run-test",
      generatedAt: "2025-03-21T12:00:00.000Z",
    });

    expect(result.run.run_id).toBe("run-test");
    expect(result.analysis.status).toBe("ok");
    expect(result.analysis.value).toBeGreaterThan(0);
    expect(result.series.base_date).toBe("2025-01-01");
    expect(result.series.ticker[0].normalized_adjusted_close).toBe(100);
    expect(result.series.benchmark[0].normalized_adjusted_close).toBe(100);
    expect(result.analysis.reasoning).toContain("mechanical research output");
    expect(result.run.factor_model_sha256).toBe(FACTOR_MODEL_HASH);
    expect(result.model_registry).toMatchObject({
      id: "market-factor-v2",
      sha256: FACTOR_MODEL_HASH,
      hypothesis_status: "unvalidated_hypothesis",
    });
  });

  it("uses the same observable date as the chart baseline for both series", () => {
    const prices = parsePriceRows(
      priceRows(30, { start: "2025-02-01" }),
      "2025-04-10",
    );
    const benchmarkPrices = parsePriceRows(
      priceRows(80, { start: "2025-01-01", close: () => 100 }),
      "2025-04-10",
    );

    const result = buildResearchPayload({
      ticker: "IPO",
      asOf: "2025-04-10",
      prices,
      benchmarkPrices,
      headlines: [],
    });

    expect(result.series.base_date).toBe("2025-02-01");
    expect(result.series.ticker[0]).toMatchObject({
      date: "2025-02-01",
      normalized_adjusted_close: 100,
    });
    expect(result.series.benchmark[0]).toMatchObject({
      date: "2025-02-01",
      normalized_adjusted_close: 100,
    });
  });
});
