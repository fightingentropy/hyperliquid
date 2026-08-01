import { describe, expect, it } from "vitest";
import {
  CANONICAL_FACTOR_WEIGHTS,
  evaluateWalkForward,
} from "./equityResearchWalkForward";

const FACTORS = Object.keys(CANONICAL_FACTOR_WEIGHTS);

function factorScores(score, drift = 0) {
  return Object.fromEntries(FACTORS.map((factor, index) => [
    factor,
    Math.max(-1, Math.min(1, score + drift * (index - 2))),
  ]));
}

function fixture() {
  const securities = [
    ["sec-a", "AAA", -0.8],
    ["sec-b", "BBB", -0.4],
    ["sec-c", "CCC", -0.1],
    ["sec-d", "DDD", 0.2],
    ["sec-e", "EEE", 0.5],
    ["sec-f", "FFF", 0.9],
  ];
  const periods = [
    ["2024-01-31", "2024-02-28", "risk_on", 0],
    ["2024-02-29", "2024-03-28", "risk_on", 0.04],
    ["2024-04-30", "2024-05-28", "risk_off", -0.03],
    ["2024-05-31", "2024-06-28", "risk_off", 0.02],
  ];
  const observations = periods.flatMap(([signalDate, outcomeDate, regime, drift], periodIndex) =>
    securities.map(([securityId, originalTicker, baseScore], securityIndex) => {
      const renamed = securityId === "sec-b" && periodIndex >= 2;
      const delisted = securityId === "sec-a" && periodIndex === periods.length - 1;
      const futureExcess = delisted
        ? -0.72
        : baseScore * 0.045 + (securityIndex % 2 === 0 ? -0.002 : 0.002);
      return {
        security_id: securityId,
        ticker: renamed ? "BBX" : originalTicker,
        signal_date: signalDate,
        outcome_date: outcomeDate,
        factor_scores: factorScores(baseScore, drift),
        benchmark_return: periodIndex % 2 === 0 ? 0.01 : -0.005,
        forward_return: (periodIndex % 2 === 0 ? 0.01 : -0.005) + futureExcess,
        regime,
        event: delisted ? "delisted" : renamed ? "renamed" : "active",
        terminal_return_included: delisted,
      };
    }),
  );
  const folds = [
    {
      id: "early-2024",
      training_start: "2023-01-01",
      training_end: "2023-12-31",
      test_start: "2024-01-01",
      test_end: "2024-03-31",
    },
    {
      id: "late-2024",
      training_start: "2023-01-01",
      training_end: "2024-03-31",
      test_start: "2024-04-01",
      test_end: "2024-06-30",
    },
  ];
  return { observations, folds };
}

describe("equity-research walk-forward evaluator", () => {
  it("reports point-in-time, cost, calibration, regime and bootstrap evidence", () => {
    const result = evaluateWalkForward({
      ...fixture(),
      transactionCostBps: 12,
      bootstrapSamples: 400,
      bootstrapSeed: 42,
    });

    expect(result.model).toMatchObject({
      version: "market-factor-v2",
      frozen_before_test: true,
    });
    expect(result.coverage).toMatchObject({
      observation_count: 24,
      security_count: 6,
      rebalance_period_count: 4,
      delisted_observation_count: 1,
      delisted_terminal_returns_complete: true,
      renamed_security_ids: ["sec-b"],
      point_in_time_universe: true,
    });
    expect(result.folds).toHaveLength(2);
    expect(result.performance.total_transaction_cost).toBeGreaterThan(0);
    expect(result.information_coefficient.mean_spearman).toBeGreaterThan(0.8);
    expect(result.rank_stability.pairs).toHaveLength(3);
    expect(result.calibration).toHaveLength(5);
    expect(result.regimes.map((regime) => regime.regime)).toEqual(["risk_off", "risk_on"]);
    expect(result.bootstrap_95_percent_ci).toMatchObject({ samples: 400, seed: 42 });
    expect(result.factor_weight_sensitivity.scenarios).toHaveLength(10);
    expect(result.periods.every((period) => period.transaction_cost > 0)).toBe(true);
  });

  it("is deterministic for a fixed bootstrap seed", () => {
    const left = evaluateWalkForward({ ...fixture(), bootstrapSamples: 200, bootstrapSeed: 99 });
    const right = evaluateWalkForward({ ...fixture(), bootstrapSamples: 200, bootstrapSeed: 99 });
    expect(left).toEqual(right);
  });

  it("rejects look-ahead outcomes", () => {
    const data = fixture();
    data.observations[0].outcome_date = data.observations[0].signal_date;
    expect(() => evaluateWalkForward(data)).toThrow("not after its signal");
  });

  it("rejects survivorship-biased delisting rows", () => {
    const data = fixture();
    const row = data.observations.find((observation) => observation.event === "delisted");
    row.terminal_return_included = false;
    expect(() => evaluateWalkForward(data)).toThrow("omits a delisted security's terminal return");
  });

  it("rejects observations outside their declared out-of-sample folds", () => {
    const data = fixture();
    data.observations[0].signal_date = "2023-06-30";
    data.observations[0].outcome_date = "2023-07-31";
    expect(() => evaluateWalkForward(data)).toThrow("exactly one test fold");
  });
});
