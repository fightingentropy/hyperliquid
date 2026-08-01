import {
  FACTOR_MODEL_HASH,
  FACTOR_MODEL_VERSION,
  NEUTRAL_DEADBAND,
} from "./equityResearch";

export const WALK_FORWARD_SCHEMA_VERSION = 1;
export const CANONICAL_FACTOR_WEIGHTS = Object.freeze({
  relative_momentum_20d: 0.4,
  relative_momentum_5d: 0.2,
  absolute_momentum_20d: 0.2,
  drawdown_risk: 0.1,
  volume_confirmation: 0.1,
});

/**
 * Evaluate already-materialized, point-in-time factor observations. The caller
 * must source an historical universe that includes terminal returns for
 * delisted securities; this function deliberately refuses to silently drop
 * incomplete terminal observations.
 */
export function evaluateWalkForward({
  observations,
  folds,
  transactionCostBps = 10,
  bootstrapSamples = 1_000,
  bootstrapSeed = 7_331,
}) {
  const normalizedFolds = normalizeFolds(folds);
  const rows = normalizeObservations(observations, normalizedFolds);
  const costRate = finiteNonNegative(transactionCostBps, "transactionCostBps") / 10_000;
  const canonical = calculatePortfolio(rows, CANONICAL_FACTOR_WEIGHTS, costRate);
  const netReturns = canonical.periods.map((period) => period.net_excess_return);
  const confidenceInterval = bootstrapMeanConfidenceInterval(
    netReturns,
    bootstrapSamples,
    bootstrapSeed,
  );
  const delisted = rows.filter((row) => row.event === "delisted");
  const renamedSecurityIds = [...groupBy(rows, (row) => row.security_id).entries()]
    .filter(([, securityRows]) => new Set(securityRows.map((row) => row.ticker)).size > 1)
    .map(([securityId]) => securityId)
    .sort();

  return {
    schema_version: WALK_FORWARD_SCHEMA_VERSION,
    status: "research_only_not_investment_advice",
    model: {
      version: FACTOR_MODEL_VERSION,
      sha256: FACTOR_MODEL_HASH,
      frozen_before_test: true,
    },
    methodology: {
      target: "next 20-session stock return minus benchmark return",
      portfolio: "gross-exposure-normalized signed factor score",
      transaction_cost_bps: transactionCostBps,
      turnover_definition: "sum of absolute security-weight changes, including initial entry",
      confidence_interval: "seeded non-parametric bootstrap of rebalance-period mean net excess return",
    },
    coverage: {
      observation_count: rows.length,
      security_count: new Set(rows.map((row) => row.security_id)).size,
      rebalance_period_count: canonical.periods.length,
      delisted_observation_count: delisted.length,
      delisted_terminal_returns_complete: delisted.every(
        (row) => row.terminal_return_included === true,
      ),
      renamed_security_ids: renamedSecurityIds,
      point_in_time_universe: true,
    },
    folds: normalizedFolds.map((fold) => {
      const periods = canonical.periods.filter((period) => period.fold_id === fold.id);
      return {
        ...fold,
        observation_count: rows.filter((row) => row.fold_id === fold.id).length,
        rebalance_period_count: periods.length,
        mean_net_excess_return: mean(periods.map((period) => period.net_excess_return)),
      };
    }),
    performance: summarizePeriods(canonical.periods),
    information_coefficient: {
      mean_spearman: mean(canonical.periods.map((period) => period.information_coefficient)),
      by_period: canonical.periods.map((period) => ({
        signal_date: period.signal_date,
        value: period.information_coefficient,
      })),
    },
    rank_stability: calculateRankStability(canonical.scoredByDate),
    calibration: calculateCalibration(canonical.scoredRows),
    regimes: calculateRegimes(canonical.periods),
    bootstrap_95_percent_ci: confidenceInterval,
    factor_weight_sensitivity: calculateWeightSensitivity(rows, costRate),
    periods: canonical.periods,
  };
}

function normalizeFolds(folds) {
  if (!Array.isArray(folds) || folds.length === 0) {
    throw new Error("At least one temporal fold is required.");
  }

  const normalized = folds.map((fold, index) => {
    const result = {
      id: String(fold?.id ?? `fold-${index + 1}`),
      training_start: isoDate(fold?.training_start, "training_start"),
      training_end: isoDate(fold?.training_end, "training_end"),
      test_start: isoDate(fold?.test_start, "test_start"),
      test_end: isoDate(fold?.test_end, "test_end"),
    };

    if (
      result.training_start > result.training_end ||
      result.training_end >= result.test_start ||
      result.test_start > result.test_end
    ) {
      throw new Error(`Fold ${result.id} is not strictly chronological.`);
    }
    return result;
  });

  const ids = new Set(normalized.map((fold) => fold.id));
  if (ids.size !== normalized.length) {
    throw new Error("Fold IDs must be unique.");
  }

  return normalized;
}

function normalizeObservations(observations, folds) {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error("Point-in-time observations are required.");
  }

  return observations.map((observation, index) => {
    const signalDate = isoDate(observation?.signal_date, "signal_date");
    const outcomeDate = isoDate(observation?.outcome_date, "outcome_date");
    if (outcomeDate <= signalDate) {
      throw new Error(`Observation ${index} uses an outcome that is not after its signal.`);
    }
    if (observation?.active_at_signal === false) {
      throw new Error(`Observation ${index} was not in the point-in-time universe.`);
    }

    const matchingFolds = folds.filter(
      (fold) => signalDate >= fold.test_start && signalDate <= fold.test_end,
    );
    if (matchingFolds.length !== 1) {
      throw new Error(`Observation ${index} must belong to exactly one test fold.`);
    }

    const event = observation?.event ?? "active";
    if (!new Set(["active", "renamed", "delisted"]).has(event)) {
      throw new Error(`Observation ${index} has an unsupported universe event.`);
    }
    if (event === "delisted" && observation?.terminal_return_included !== true) {
      throw new Error(`Observation ${index} omits a delisted security's terminal return.`);
    }

    const factorScores = Object.fromEntries(
      Object.keys(CANONICAL_FACTOR_WEIGHTS).map((factor) => {
        const value = finite(observation?.factor_scores?.[factor], `${factor} score`);
        if (value < -1 || value > 1) {
          throw new Error(`Observation ${index} has a factor score outside [-1, 1].`);
        }
        return [factor, value];
      }),
    );

    return {
      security_id: nonEmpty(observation?.security_id, "security_id"),
      ticker: nonEmpty(observation?.ticker, "ticker").toUpperCase(),
      signal_date: signalDate,
      outcome_date: outcomeDate,
      forward_return: finite(observation?.forward_return, "forward_return"),
      benchmark_return: finite(observation?.benchmark_return, "benchmark_return"),
      factor_scores: factorScores,
      regime: nonEmpty(observation?.regime ?? "unclassified", "regime"),
      event,
      terminal_return_included: observation?.terminal_return_included === true,
      fold_id: matchingFolds[0].id,
    };
  });
}

function calculatePortfolio(rows, weights, costRate) {
  const scoredRows = rows.map((row) => {
    const score = clip(Object.entries(weights).reduce(
      (sum, [factor, weight]) => sum + row.factor_scores[factor] * weight,
      0,
    ));
    return {
      ...row,
      score,
      future_excess_return: row.forward_return - row.benchmark_return,
    };
  });
  const scoredByDate = groupBy(scoredRows, (row) => row.signal_date);
  let previousWeights = new Map();
  const periods = [...scoredByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([signalDate, dateRows]) => {
      const signedScores = dateRows.map((row) =>
        Math.abs(row.score) >= NEUTRAL_DEADBAND ? row.score : 0,
      );
      const gross = signedScores.reduce((sum, value) => sum + Math.abs(value), 0);
      const currentWeights = new Map(dateRows.map((row, index) => [
        row.security_id,
        gross > 0 ? signedScores[index] / gross : 0,
      ]));
      const securityIds = new Set([...previousWeights.keys(), ...currentWeights.keys()]);
      const tradedNotional = [...securityIds].reduce(
        (sum, securityId) =>
          sum + Math.abs((currentWeights.get(securityId) ?? 0) - (previousWeights.get(securityId) ?? 0)),
        0,
      );
      const grossExcessReturn = dateRows.reduce(
        (sum, row) => sum + (currentWeights.get(row.security_id) ?? 0) * row.future_excess_return,
        0,
      );
      const transactionCost = tradedNotional * costRate;
      previousWeights = currentWeights;

      return {
        fold_id: dateRows[0].fold_id,
        signal_date: signalDate,
        outcome_date: dateRows.map((row) => row.outcome_date).sort().at(-1),
        regime: mode(dateRows.map((row) => row.regime)),
        security_count: dateRows.length,
        gross_exposure: sum([...currentWeights.values()].map(Math.abs)),
        turnover: tradedNotional,
        gross_excess_return: round6(grossExcessReturn),
        transaction_cost: round6(transactionCost),
        net_excess_return: round6(grossExcessReturn - transactionCost),
        information_coefficient: spearman(
          dateRows.map((row) => row.score),
          dateRows.map((row) => row.future_excess_return),
        ),
      };
    });

  return { periods, scoredRows, scoredByDate };
}

function summarizePeriods(periods) {
  const gross = periods.map((period) => period.gross_excess_return);
  const net = periods.map((period) => period.net_excess_return);
  return {
    mean_gross_excess_return: mean(gross),
    mean_net_excess_return: mean(net),
    cumulative_gross_excess_return: compound(gross),
    cumulative_net_excess_return: compound(net),
    positive_net_period_rate: mean(net.map((value) => (value > 0 ? 1 : 0))),
    average_turnover: mean(periods.map((period) => period.turnover)),
    total_transaction_cost: sum(periods.map((period) => period.transaction_cost)),
  };
}

function calculateRankStability(scoredByDate) {
  const dates = [...scoredByDate.keys()].sort();
  const pairs = dates.slice(1).flatMap((date, index) => {
    const priorById = new Map(scoredByDate.get(dates[index]).map((row) => [row.security_id, row.score]));
    const shared = scoredByDate.get(date).filter((row) => priorById.has(row.security_id));
    if (shared.length < 2) return [];
    return [{
      from: dates[index],
      to: date,
      shared_security_count: shared.length,
      spearman: spearman(
        shared.map((row) => priorById.get(row.security_id)),
        shared.map((row) => row.score),
      ),
    }];
  });
  return { mean_spearman: mean(pairs.map((pair) => pair.spearman)), pairs };
}

function calculateCalibration(rows) {
  const buckets = [
    ["strong_bearish", -Infinity, -0.5],
    ["bearish", -0.5, -NEUTRAL_DEADBAND],
    ["neutral", -NEUTRAL_DEADBAND, NEUTRAL_DEADBAND],
    ["bullish", NEUTRAL_DEADBAND, 0.5],
    ["strong_bullish", 0.5, Infinity],
  ];
  return buckets.map(([label, minimum, maximum], index) => {
    const members = rows.filter((row) =>
      row.score >= minimum && (index === buckets.length - 1 ? row.score <= maximum : row.score < maximum),
    );
    return {
      bucket: label,
      count: members.length,
      mean_score: mean(members.map((row) => row.score)),
      mean_future_excess_return: mean(members.map((row) => row.future_excess_return)),
      directional_hit_rate: mean(members.map((row) =>
        row.score === 0 ? 0 : Math.sign(row.score) === Math.sign(row.future_excess_return) ? 1 : 0,
      )),
    };
  });
}

function calculateRegimes(periods) {
  return [...groupBy(periods, (period) => period.regime).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([regime, regimePeriods]) => ({
      regime,
      period_count: regimePeriods.length,
      mean_net_excess_return: mean(regimePeriods.map((period) => period.net_excess_return)),
      positive_period_rate: mean(regimePeriods.map((period) => period.net_excess_return > 0 ? 1 : 0)),
    }));
}

function calculateWeightSensitivity(rows, costRate) {
  const scenarios = Object.keys(CANONICAL_FACTOR_WEIGHTS).flatMap((factor) =>
    [0.8, 1.2].map((multiplier) => {
      const changed = {
        ...CANONICAL_FACTOR_WEIGHTS,
        [factor]: CANONICAL_FACTOR_WEIGHTS[factor] * multiplier,
      };
      const total = sum(Object.values(changed));
      const normalized = Object.fromEntries(
        Object.entries(changed).map(([name, value]) => [name, value / total]),
      );
      const performance = summarizePeriods(calculatePortfolio(rows, normalized, costRate).periods);
      return {
        factor,
        multiplier,
        mean_net_excess_return: performance.mean_net_excess_return,
      };
    }),
  );
  const values = scenarios.map((scenario) => scenario.mean_net_excess_return);
  return {
    perturbation: "each factor weight +/-20%, then renormalize to 100%",
    minimum_mean_net_excess_return: values.length ? Math.min(...values) : null,
    maximum_mean_net_excess_return: values.length ? Math.max(...values) : null,
    scenarios,
  };
}

function bootstrapMeanConfidenceInterval(values, samples, seed) {
  const count = Math.max(100, Math.floor(finiteNonNegative(samples, "bootstrapSamples")));
  if (values.length === 0) return { lower: null, upper: null, samples: count, seed };
  const random = seededRandom(Math.floor(finiteNonNegative(seed, "bootstrapSeed")));
  const means = Array.from({ length: count }, () => mean(
    Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]),
  )).sort((left, right) => left - right);
  return {
    lower: round6(means[Math.floor((means.length - 1) * 0.025)]),
    upper: round6(means[Math.ceil((means.length - 1) * 0.975)]),
    samples: count,
    seed,
  };
}

function spearman(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftRanks = ranks(left);
  const rightRanks = ranks(right);
  const leftMean = mean(leftRanks);
  const rightMean = mean(rightRanks);
  const numerator = sum(leftRanks.map((value, index) =>
    (value - leftMean) * (rightRanks[index] - rightMean),
  ));
  const denominator = Math.sqrt(
    sum(leftRanks.map((value) => (value - leftMean) ** 2)) *
    sum(rightRanks.map((value) => (value - rightMean) ** 2)),
  );
  return denominator === 0 ? null : round6(numerator / denominator);
}

function ranks(values) {
  const sorted = values.map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const result = Array(values.length);
  for (let index = 0; index < sorted.length;) {
    let end = index + 1;
    while (end < sorted.length && sorted[end].value === sorted[index].value) end += 1;
    const averageRank = (index + 1 + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) result[sorted[cursor].index] = averageRank;
    index = end;
  }
  return result;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function groupBy(values, key) {
  const grouped = new Map();
  values.forEach((value) => {
    const groupKey = key(value);
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), value]);
  });
  return grouped;
}

function mode(values) {
  return [...groupBy(values, (value) => value).entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))[0][0];
}

function compound(values) {
  return round6(values.reduce((value, periodReturn) => value * (1 + periodReturn), 1) - 1);
}

function mean(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? round6(sum(usable) / usable.length) : null;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function clip(value) {
  return Math.max(-1, Math.min(1, value));
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isoDate(value, label) {
  const date = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} must be a valid ISO date.`);
  }
  return date;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite.`);
  return number;
}

function finiteNonNegative(value, label) {
  const number = finite(value, label);
  if (number < 0) throw new Error(`${label} must be non-negative.`);
  return number;
}

function nonEmpty(value, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
}
