export const FACTOR_MODEL_VERSION = "market-factor-v2";
export const FORECAST_HORIZON_SESSIONS = 20;
export const FORECAST_TARGET =
  "next 20-session adjusted-price return minus SPY adjusted-price return";
export const DEFAULT_BENCHMARK = "SPY";
export const NEUTRAL_DEADBAND = 0.15;
export const MIN_PRICE_BARS = 21;
export const FACTOR_MODEL_DEFINITION = JSON.stringify({
  benchmark: DEFAULT_BENCHMARK,
  deadband: NEUTRAL_DEADBAND,
  forecast_horizon_sessions: FORECAST_HORIZON_SESSIONS,
  forecast_target: FORECAST_TARGET,
  factors: [
    ["relative_momentum_20d", 0.4, "clip(excess_return / 0.15, -1, 1)"],
    ["relative_momentum_5d", 0.2, "clip(excess_return / 0.08, -1, 1)"],
    ["absolute_momentum_20d", 0.2, "clip(return / 0.15, -1, 1)"],
    ["drawdown_risk", 0.1, "clip(min(0, (drawdown + 0.10) / 0.20), -1, 1)"],
    ["volume_confirmation", 0.1, "sign(momentum) * clip(max(0, volume_ratio - 1), 0, 1)"],
  ],
  version: FACTOR_MODEL_VERSION,
});
export const FACTOR_MODEL_HASH = "2b382a766e24eae72a253208247fe00687df2b124d0873721660699986fefd19";
export const FACTOR_MODEL_REGISTRY_ENTRY = Object.freeze({
  id: FACTOR_MODEL_VERSION,
  sha256: FACTOR_MODEL_HASH,
  hypothesis_status: "unvalidated_hypothesis",
  definition: FACTOR_MODEL_DEFINITION,
});

const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const FACTOR_LABELS = {
  relative_momentum_20d: "20-session excess momentum",
  relative_momentum_5d: "5-session excess momentum",
  absolute_momentum_20d: "20-session absolute momentum",
  drawdown_risk: "60-session drawdown risk",
  volume_confirmation: "volume confirmation",
};

export class EquityResearchError extends Error {
  constructor(message, { code = "research_error", status = 500 } = {}) {
    super(message);
    this.name = "EquityResearchError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeTicker(value) {
  const ticker = String(value ?? "").trim().toUpperCase();

  if (!TICKER_PATTERN.test(ticker)) {
    throw new EquityResearchError(
      "Use a valid ticker containing letters, numbers, dots, underscores, or hyphens.",
      { code: "invalid_ticker", status: 400 },
    );
  }

  return ticker;
}

export function normalizeIsoDate(value, { allowFuture = false } = {}) {
  const date = String(value ?? "").slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new EquityResearchError("Use a valid as-of date.", {
      code: "invalid_date",
      status: 400,
    });
  }

  if (!allowFuture && date > todayIso()) {
    throw new EquityResearchError("The as-of date cannot be in the future.", {
      code: "future_date",
      status: 400,
    });
  }

  return date;
}

export function toEodhdSymbol(ticker) {
  const normalized = normalizeTicker(ticker);
  return normalized.includes(".") ? normalized : `${normalized}.US`;
}

export function parsePriceRows(rows, asOf) {
  if (!Array.isArray(rows)) {
    throw new EquityResearchError("The market-data provider returned an invalid price payload.", {
      code: "invalid_provider_payload",
      status: 502,
    });
  }

  const byDate = new Map();

  rows.forEach((row) => {
    const date = typeof row?.date === "string" ? row.date.slice(0, 10) : "";
    const open = finiteNumber(row?.open);
    const high = finiteNumber(row?.high);
    const low = finiteNumber(row?.low);
    const close = finiteNumber(row?.close);
    const adjustedClose = finiteNumber(row?.adjusted_close) ?? close;
    const volume = finiteNumber(row?.volume);

    if (
      !date ||
      date > asOf ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      adjustedClose === null ||
      volume === null ||
      close <= 0 ||
      adjustedClose <= 0 ||
      volume < 0
    ) {
      return;
    }

    byDate.set(date, {
      date,
      open,
      high,
      low,
      close,
      adjustedClose,
      volume,
    });
  });

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function sanitizeHeadlines(rows, { ticker, asOf, startDate, limit = 10 }) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const normalizedTicker = normalizeTicker(ticker);
  const seen = new Set();

  return rows
    .filter((row) => {
      const date = typeof row?.date === "string" ? row.date.slice(0, 10) : "";
      return date && date >= startDate && date <= asOf;
    })
    .sort((left, right) => String(right?.date ?? "").localeCompare(String(left?.date ?? "")))
    .flatMap((row) => {
      const title = cleanText(row?.title, 240);
      const key = title.toLocaleLowerCase();

      if (!title || seen.has(key)) {
        return [];
      }

      seen.add(key);
      const reportedTicker = cleanText(row?.s ?? row?.ticker ?? row?.code, 32).toUpperCase() || null;

      return [{
        date: cleanText(row?.date, 40) || null,
        title,
        source: safeHostname(row?.link) || cleanText(row?.source, 80) || "EODHD",
        url: safeUrl(row?.link),
        reported_ticker: reportedTicker,
        ticker_relevant: reportedTicker
          ? baseTicker(reportedTicker) === baseTicker(normalizedTicker)
          : null,
      }];
    })
    .slice(0, Math.max(0, Math.min(limit, 25)));
}

export function buildMarketSnapshot({
  ticker,
  asOf,
  prices,
  benchmarkPrices,
  headlines = [],
  benchmark = DEFAULT_BENCHMARK,
}) {
  const normalizedTicker = normalizeTicker(ticker);
  const normalizedBenchmark = normalizeTicker(benchmark);
  const normalizedAsOf = normalizeIsoDate(asOf);
  const knownPrices = prices.filter((price) => price.date <= normalizedAsOf);

  if (knownPrices.length < MIN_PRICE_BARS) {
    throw new EquityResearchError(
      `${normalizedTicker} has only ${knownPrices.length} daily price bars through ${normalizedAsOf}; at least ${MIN_PRICE_BARS} are required.`,
      { code: "insufficient_price_history", status: 422 },
    );
  }

  const latestPriceDate = knownPrices.at(-1).date;
  const knownBenchmarkPrices = (
    normalizedTicker === normalizedBenchmark ? knownPrices : benchmarkPrices
  ).filter((price) => price.date <= latestPriceDate);

  if (knownBenchmarkPrices.length < MIN_PRICE_BARS) {
    throw new EquityResearchError(
      `${normalizedBenchmark} has insufficient benchmark history through ${latestPriceDate}.`,
      { code: "insufficient_benchmark_history", status: 422 },
    );
  }

  const closes = knownPrices.map((price) => price.adjustedClose);
  const benchmarkCloses = knownBenchmarkPrices.map((price) => price.adjustedClose);
  const recentLogReturns = closes
    .slice(-21)
    .map((close, index, values) => (index === 0 ? null : Math.log(close / values[index - 1])))
    .filter((value) => value !== null);
  const volatility =
    recentLogReturns.length >= 2 ? sampleStandardDeviation(recentLogReturns) * Math.sqrt(252) : null;
  const drawdownLookbackSessions = Math.min(60, closes.length);
  const lookbackHigh = Math.max(...closes.slice(-drawdownLookbackSessions));
  const priorVolumes = knownPrices
    .slice(-21, -1)
    .map((price) => price.volume)
    .filter((volume) => volume > 0);
  const averageVolume = priorVolumes.length
    ? priorVolumes.reduce((sum, value) => sum + value, 0) / priorVolumes.length
    : null;
  const adjustmentFactors = knownPrices
    .slice(-21)
    .filter((price) => price.close > 0)
    .map((price) => price.adjustedClose / price.close);
  const splitInVolumeWindow =
    adjustmentFactors.length >= 2 &&
    Math.max(...adjustmentFactors) / Math.min(...adjustmentFactors) > 1.1;
  const return5d = change(closes.at(-1), closes.at(-6));
  const return20d = change(closes.at(-1), closes.at(-21));
  const benchmarkReturn5d = benchmarkChange(
    knownBenchmarkPrices,
    benchmarkCloses,
    knownPrices.at(-6).date,
    latestPriceDate,
  );
  const benchmarkReturn20d = benchmarkChange(
    knownBenchmarkPrices,
    benchmarkCloses,
    knownPrices.at(-21).date,
    latestPriceDate,
  );

  return {
    ticker: normalizedTicker,
    as_of: normalizedAsOf,
    first_price_date: knownPrices[0].date,
    latest_price_date: latestPriceDate,
    bars: knownPrices.length,
    latest_close: round6(knownPrices.at(-1).close),
    return_5d: return5d,
    return_20d: return20d,
    benchmark_ticker: normalizedBenchmark,
    benchmark_first_price_date: knownBenchmarkPrices[0].date,
    benchmark_latest_price_date: knownBenchmarkPrices.at(-1).date,
    benchmark_return_5d: benchmarkReturn5d,
    benchmark_return_20d: benchmarkReturn20d,
    relative_return_5d: round6(return5d - benchmarkReturn5d),
    relative_return_20d: round6(return20d - benchmarkReturn20d),
    annualized_volatility_20d: round6(volatility),
    drawdown_lookback_sessions: drawdownLookbackSessions,
    drawdown_from_60d_high: round6(closes.at(-1) / lookbackHigh - 1),
    latest_volume_vs_20d_avg:
      averageVolume && !splitInVolumeWindow
        ? round6(knownPrices.at(-1).volume / averageVolume)
        : null,
    headlines,
  };
}

export function scoreMarketSnapshot(snapshot) {
  const factors = [];
  const addFactor = ({
    name,
    description,
    rawValue,
    normalization,
    normalizedScore,
    weight,
  }) => {
    const available = rawValue !== null && rawValue !== undefined;
    const normalized = available ? clip(normalizedScore) : 0;
    factors.push({
      name,
      description,
      raw_value: available ? round6(rawValue) : null,
      normalization,
      normalized_score: round6(normalized),
      weight,
      contribution: round6(normalized * weight),
      available,
    });
  };

  addFactor({
    name: "relative_momentum_20d",
    description: "20-session stock return minus benchmark return",
    rawValue: snapshot.relative_return_20d,
    normalization: "clip(excess_return / 0.15, -1, 1)",
    normalizedScore: (snapshot.relative_return_20d ?? 0) / 0.15,
    weight: 0.4,
  });
  addFactor({
    name: "relative_momentum_5d",
    description: "5-session stock return minus benchmark return",
    rawValue: snapshot.relative_return_5d,
    normalization: "clip(excess_return / 0.08, -1, 1)",
    normalizedScore: (snapshot.relative_return_5d ?? 0) / 0.08,
    weight: 0.2,
  });
  addFactor({
    name: "absolute_momentum_20d",
    description: "20-session adjusted-price return",
    rawValue: snapshot.return_20d,
    normalization: "clip(return / 0.15, -1, 1)",
    normalizedScore: (snapshot.return_20d ?? 0) / 0.15,
    weight: 0.2,
  });

  const drawdown = snapshot.drawdown_from_60d_high;
  addFactor({
    name: "drawdown_risk",
    description: `penalty for a drawdown deeper than 10% from the ${snapshot.drawdown_lookback_sessions ?? 60}-session high`,
    rawValue: drawdown,
    normalization: "clip(min(0, (drawdown + 0.10) / 0.20), -1, 1)",
    normalizedScore: drawdown === null ? 0 : clip(Math.min(0, (drawdown + 0.1) / 0.2)),
    weight: 0.1,
  });

  let directionBasis =
    0.65 * ((snapshot.relative_return_20d ?? 0) / 0.15) +
    0.35 * ((snapshot.relative_return_5d ?? 0) / 0.08);
  if (Math.abs(directionBasis) < 1e-12) {
    directionBasis = (snapshot.return_20d ?? 0) / 0.15;
  }
  const volumeRatio = snapshot.latest_volume_vs_20d_avg;
  const volumeStrength =
    volumeRatio === null ? 0 : clip(Math.max(0, volumeRatio - 1));
  const volumeScore =
    directionBasis > 0 ? volumeStrength : directionBasis < 0 ? -volumeStrength : 0;

  addFactor({
    name: "volume_confirmation",
    description: "above-average volume confirming the prevailing momentum direction",
    rawValue: volumeRatio,
    normalization: "sign(momentum) * clip(max(0, volume_ratio - 1), 0, 1)",
    normalizedScore: volumeScore,
    weight: 0.1,
  });

  const rawScore = round6(clip(factors.reduce((sum, factor) => sum + factor.contribution, 0)));
  const direction =
    rawScore >= NEUTRAL_DEADBAND
      ? "bullish"
      : rawScore <= -NEUTRAL_DEADBAND
        ? "bearish"
        : "neutral";
  const signalValue = direction === "neutral" ? 0 : rawScore;

  return {
    factor_model_version: FACTOR_MODEL_VERSION,
    factor_model_sha256: FACTOR_MODEL_HASH,
    forecast_horizon_sessions: FORECAST_HORIZON_SESSIONS,
    forecast_target: FORECAST_TARGET,
    benchmark: snapshot.benchmark_ticker,
    raw_score: rawScore,
    signal_value: signalValue,
    direction,
    strength: Math.round(Math.abs(rawScore) * 100),
    strength_kind: "deterministic_score_magnitude_not_probability",
    neutral_deadband: NEUTRAL_DEADBAND,
    evidence_coverage: round6(
      factors
        .filter((factor) => factor.available)
        .reduce(
          (sum, factor) =>
            sum +
            (factor.name === "drawdown_risk"
              ? factor.weight *
                Math.min(1, (snapshot.drawdown_lookback_sessions ?? 60) / 60)
              : factor.weight),
          0,
        ),
    ),
    factors,
  };
}

export function normalizeMarketSeries(prices, { baseDate = null } = {}) {
  const usable = prices
    .filter((price) => Number.isFinite(price.adjustedClose) && price.adjustedClose > 0)
    .filter((price) => !baseDate || price.date >= baseDate);
  const basePoint = baseDate
    ? usable.find((price) => price.date === baseDate)
    : usable[0];
  const base = basePoint?.adjustedClose;

  if (!base) {
    return [];
  }

  return usable.map((price) => ({
    date: price.date,
    open: price.open,
    high: price.high,
    low: price.low,
    close: price.close,
    adjusted_close: price.adjustedClose,
    volume: price.volume,
    normalized_adjusted_close: round6((price.adjustedClose / base) * 100),
  }));
}

export function buildDeterministicReasoning(score, snapshot) {
  const ranked = score.factors
    .filter((factor) => factor.available && Math.abs(factor.contribution) > 0.0005)
    .sort(
      (left, right) =>
        Math.abs(right.contribution) - Math.abs(left.contribution),
    )
    .slice(0, 2);
  const factorSummary = ranked.length
    ? ranked
        .map(
          (factor) =>
            `${
              factor.name === "drawdown_risk"
                ? `${snapshot.drawdown_lookback_sessions ?? 60}-session drawdown risk`
                : FACTOR_LABELS[factor.name] ?? factor.name
            } (${formatSigned(factor.contribution)})`,
        )
        .join(" and ")
    : "no factor with a material signed contribution";

  return `The fixed ${FACTOR_MODEL_VERSION} model reads ${score.direction} with a raw score of ${formatSigned(score.raw_score)}. The largest contributions are ${factorSummary}. Price evidence is filtered through ${snapshot.latest_price_date}, and headline metadata is bounded to the requested as-of date ${snapshot.as_of}; the score is mechanical research output, not a probability or trade instruction.`;
}

export function buildResearchPayload({
  ticker,
  asOf,
  prices,
  benchmarkPrices,
  headlines,
  benchmark = DEFAULT_BENCHMARK,
  generatedAt = new Date().toISOString(),
  runId = crypto.randomUUID(),
  provider = "eodhd",
}) {
  const snapshot = buildMarketSnapshot({
    ticker,
    asOf,
    prices,
    benchmarkPrices,
    headlines,
    benchmark,
  });
  const factorModel = scoreMarketSnapshot(snapshot);
  const knownTickerSeries = prices.filter(
    (price) => price.date <= snapshot.latest_price_date,
  );
  const knownBenchmarkSeries = benchmarkPrices.filter(
    (price) => price.date <= snapshot.latest_price_date,
  );
  const benchmarkDates = new Set(knownBenchmarkSeries.map((price) => price.date));
  const comparisonBaseDate =
    knownTickerSeries.find((price) => benchmarkDates.has(price.date))?.date ?? null;
  const tickerSeries = comparisonBaseDate
    ? normalizeMarketSeries(knownTickerSeries, { baseDate: comparisonBaseDate })
    : [];
  const benchmarkSeries = comparisonBaseDate
    ? normalizeMarketSeries(knownBenchmarkSeries, { baseDate: comparisonBaseDate })
    : [];

  return {
    schema_version: 1,
    run: {
      run_id: runId,
      generated_at: generatedAt,
      agent: "market",
      data_provider: provider,
      factor_model_version: FACTOR_MODEL_VERSION,
      factor_model_sha256: FACTOR_MODEL_HASH,
    },
    analysis: {
      model_name: "market",
      ticker: snapshot.ticker,
      date: snapshot.as_of,
      value: factorModel.signal_value,
      status: "ok",
      reasoning: buildDeterministicReasoning(factorModel, snapshot),
      components: Object.fromEntries(
        factorModel.factors.map((factor) => [factor.name, factor.contribution]),
      ),
    },
    forecast: {
      horizon_sessions: FORECAST_HORIZON_SESSIONS,
      target: FORECAST_TARGET,
      benchmark: snapshot.benchmark_ticker,
    },
    factor_model: factorModel,
    model_registry: FACTOR_MODEL_REGISTRY_ENTRY,
    data_dates: {
      as_of: snapshot.as_of,
      stock_first_price: snapshot.first_price_date,
      stock_latest_price: snapshot.latest_price_date,
      benchmark_first_price: snapshot.benchmark_first_price_date,
      benchmark_latest_price: snapshot.benchmark_latest_price_date,
      headline_dates: snapshot.headlines.map((headline) => headline.date).filter(Boolean),
    },
    evidence: snapshot,
    series: {
      base_date: comparisonBaseDate,
      ticker: tickerSeries,
      benchmark: benchmarkSeries,
    },
  };
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function subtractCalendarDays(date, days) {
  const parsed = new Date(`${normalizeIsoDate(date, { allowFuture: true })}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function benchmarkChange(prices, closes, startDate, endDate) {
  const pairs = prices.map((price, index) => [price.date, closes[index]]);
  const startValues = pairs.filter(([date]) => date <= startDate);
  const endValues = pairs.filter(([date]) => date <= endDate);

  if (!startValues.length || !endValues.length) {
    throw new EquityResearchError("The benchmark has no price for the stock return window.", {
      code: "insufficient_benchmark_history",
      status: 422,
    });
  }

  return change(endValues.at(-1)[1], startValues.at(-1)[1]);
}

function sampleStandardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function change(latest, earlier) {
  return round6(latest / earlier - 1);
}

function clip(value) {
  return Math.max(-1, Math.min(1, Number(value)));
}

function round6(value) {
  return value === null || value === undefined ? null : Math.round(value * 1_000_000) / 1_000_000;
}

function finiteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, maxLength) {
  if (value === null || value === undefined) {
    return "";
  }

  const clean = String(value)
    // Provider prose may contain C0/C1 control bytes that are unsafe in UI text.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

function safeUrl(value) {
  const clean = cleanText(value, 500);
  if (!clean) {
    return null;
  }

  try {
    const parsed = new URL(clean);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeHostname(value) {
  const url = safeUrl(value);
  if (!url) {
    return null;
  }

  return new URL(url).hostname.replace(/^www\./, "") || null;
}

function baseTicker(value) {
  return String(value ?? "").toUpperCase().split(".", 1)[0].trim();
}

function formatSigned(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0005) {
    return "0.00";
  }
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}
