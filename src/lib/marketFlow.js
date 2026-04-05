import { formatBucketLabel, formatTooltipTimestamp, pad2 } from "./formatters";

export const ASSET_OPTIONS = [
  { value: "HYPE", label: "HYPE" },
  { value: "LIT", label: "LIT" },
  { value: "XYZ100", label: "XYZ100" },
  { value: "US500", label: "US500" },
  { value: "USTECH", label: "USTECH" },
];

export const HYPE_MARKET_OPTIONS = [
  { value: "HYPE-PERP", label: "HYPE Perp" },
  { value: "HYPE-SPOT", label: "HYPE Spot" },
];

export const CHART_WINDOWS = ["24h", "7d", "30d"];
export const PARTICIPANT_WINDOWS = ["1h", "4h", "24h", "7d", "30d"];
export const TOP_LIMITS = [10, 25, 50, 100];

export const DEFAULT_MARKET_FLOW_STATE = {
  asset: "HYPE",
  hypeMarketId: "HYPE-PERP",
  chartWindow: "7d",
  chartMode: "interval",
  participantWindow: "7d",
  topLimit: 25,
  participantsView: "net",
};

const SEARCH_KEYS = {
  asset: "asset",
  hypeMarket: "hypeMarket",
  chart: "chart",
  chartMode: "chartMode",
  window: "window",
  top: "top",
  view: "view",
};

function pickString(value, allowedValues, fallback) {
  const normalized = value?.trim();
  return normalized && allowedValues.includes(normalized) ? normalized : fallback;
}

function pickNumber(value, allowedValues, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return allowedValues.includes(parsed) ? parsed : fallback;
}

export function parseMarketFlowState(searchParams) {
  return {
    asset: pickString(
      searchParams.get(SEARCH_KEYS.asset)?.toUpperCase(),
      ASSET_OPTIONS.map((option) => option.value),
      DEFAULT_MARKET_FLOW_STATE.asset,
    ),
    hypeMarketId: pickString(
      searchParams.get(SEARCH_KEYS.hypeMarket)?.toUpperCase(),
      HYPE_MARKET_OPTIONS.map((option) => option.value),
      DEFAULT_MARKET_FLOW_STATE.hypeMarketId,
    ),
    chartWindow: pickString(
      searchParams.get(SEARCH_KEYS.chart),
      CHART_WINDOWS,
      DEFAULT_MARKET_FLOW_STATE.chartWindow,
    ),
    chartMode: pickString(
      searchParams.get(SEARCH_KEYS.chartMode),
      ["interval", "cumulative"],
      DEFAULT_MARKET_FLOW_STATE.chartMode,
    ),
    participantWindow: pickString(
      searchParams.get(SEARCH_KEYS.window),
      PARTICIPANT_WINDOWS,
      DEFAULT_MARKET_FLOW_STATE.participantWindow,
    ),
    topLimit: pickNumber(
      searchParams.get(SEARCH_KEYS.top),
      TOP_LIMITS,
      DEFAULT_MARKET_FLOW_STATE.topLimit,
    ),
    participantsView: pickString(
      searchParams.get(SEARCH_KEYS.view),
      ["net", "total"],
      DEFAULT_MARKET_FLOW_STATE.participantsView,
    ),
  };
}

export function buildMarketFlowSearchParams(state) {
  const params = new URLSearchParams();

  if (state.asset !== DEFAULT_MARKET_FLOW_STATE.asset) {
    params.set(SEARCH_KEYS.asset, state.asset);
  }

  if (state.hypeMarketId !== DEFAULT_MARKET_FLOW_STATE.hypeMarketId) {
    params.set(SEARCH_KEYS.hypeMarket, state.hypeMarketId);
  }

  if (state.chartWindow !== DEFAULT_MARKET_FLOW_STATE.chartWindow) {
    params.set(SEARCH_KEYS.chart, state.chartWindow);
  }

  if (state.chartMode !== DEFAULT_MARKET_FLOW_STATE.chartMode) {
    params.set(SEARCH_KEYS.chartMode, state.chartMode);
  }

  if (state.participantWindow !== DEFAULT_MARKET_FLOW_STATE.participantWindow) {
    params.set(SEARCH_KEYS.window, state.participantWindow);
  }

  if (state.topLimit !== DEFAULT_MARKET_FLOW_STATE.topLimit) {
    params.set(SEARCH_KEYS.top, `${state.topLimit}`);
  }

  if (state.participantsView !== DEFAULT_MARKET_FLOW_STATE.participantsView) {
    params.set(SEARCH_KEYS.view, state.participantsView);
  }

  return params;
}

export function getSelectedMarket(state) {
  switch (state.asset) {
    case "LIT":
      return { marketId: "LIT-PERP", candleCoin: "LIT", assetLabel: "LIT" };
    case "XYZ100":
      return { marketId: "XYZ100-PERP", candleCoin: "xyz:XYZ100", assetLabel: "XYZ100" };
    case "US500":
      return { marketId: "US500-PERP", candleCoin: "km:US500", assetLabel: "US500" };
    case "USTECH":
      return { marketId: "USTECH-PERP", candleCoin: "km:USTECH", assetLabel: "USTECH" };
    default:
      return {
        marketId: state.hypeMarketId,
        candleCoin: "HYPE",
        assetLabel: state.hypeMarketId === "HYPE-SPOT" ? "HYPE Spot" : "HYPE",
      };
  }
}

export function getChartLookbackHours(chartWindow) {
  switch (chartWindow) {
    case "24h":
      return 24;
    case "30d":
      return 24 * 30;
    default:
      return 24 * 7;
  }
}

function getBucketHours(chartWindow) {
  return chartWindow === "30d" ? 4 : 1;
}

function getBucketStartIso(isoString, bucketHours) {
  const date = new Date(isoString);
  const hour = Math.floor(date.getUTCHours() / bucketHours) * bucketHours;

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      hour,
      0,
      0,
      0,
    ),
  ).toISOString();
}

export function buildPriceMap(candles) {
  const priceMap = new Map();

  for (const candle of candles ?? []) {
    if (!Number.isFinite(candle.timestamp) || !Number.isFinite(candle.closePrice)) {
      continue;
    }

    priceMap.set(candle.timestamp, candle.closePrice);
  }

  return priceMap;
}

export function buildIntervalSeries(summary, chartWindow, candles) {
  if (!summary?.hourly?.length) {
    return [];
  }

  const priceMap = buildPriceMap(candles);
  const bucketHours = getBucketHours(chartWindow);

  if (bucketHours === 1) {
    return summary.hourly.map((point) => {
      const timestamp = new Date(point.hourStart).getTime();
      return {
        bucketStart: point.hourStart,
        xLabel: formatBucketLabel(point.hourStart, chartWindow),
        tooltipLabel: formatTooltipTimestamp(point.hourStart),
        netUsd: point.netUsd,
        buyUsd: point.buyUsd,
        sellUsd: point.sellUsd,
        closePrice: priceMap.get(timestamp),
      };
    });
  }

  const buckets = new Map();

  for (const point of summary.hourly) {
    const bucketStart = getBucketStartIso(point.hourStart, bucketHours);
    const key = bucketStart;
    const timestamp = new Date(point.hourStart).getTime();
    const closePrice = priceMap.get(timestamp);

    if (!buckets.has(key)) {
      buckets.set(key, {
        bucketStart,
        xLabel: formatBucketLabel(bucketStart, chartWindow),
        tooltipLabel: formatTooltipTimestamp(bucketStart),
        netUsd: 0,
        buyUsd: 0,
        sellUsd: 0,
        closePrice: undefined,
      });
    }

    const bucket = buckets.get(key);
    bucket.netUsd += point.netUsd;
    bucket.buyUsd += point.buyUsd;
    bucket.sellUsd += point.sellUsd;

    if (Number.isFinite(closePrice)) {
      bucket.closePrice = closePrice;
    }
  }

  return Array.from(buckets.values()).sort((left, right) => {
    return new Date(left.bucketStart).getTime() - new Date(right.bucketStart).getTime();
  });
}

export function buildCumulativeSeries(intervalSeries) {
  let runningTotal = 0;

  return intervalSeries.map((point) => {
    runningTotal += point.netUsd;

    return {
      ...point,
      cumNetUsd: runningTotal,
    };
  });
}

export function buildHypeComparisonSeries(summaries, chartWindow, candles) {
  const perpSeries = buildIntervalSeries(summaries?.["HYPE-PERP"], chartWindow, candles);
  const spotSeries = buildIntervalSeries(summaries?.["HYPE-SPOT"], chartWindow, candles);

  if (!perpSeries.length && !spotSeries.length) {
    return [];
  }

  const orderedKeys = new Set();
  const perpMap = new Map();
  const spotMap = new Map();

  for (const point of perpSeries) {
    orderedKeys.add(point.bucketStart);
    perpMap.set(point.bucketStart, point);
  }

  for (const point of spotSeries) {
    orderedKeys.add(point.bucketStart);
    spotMap.set(point.bucketStart, point);
  }

  let cumulativePerp = 0;
  let cumulativeSpot = 0;

  return Array.from(orderedKeys)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())
    .map((bucketStart) => {
      const perpPoint = perpMap.get(bucketStart);
      const spotPoint = spotMap.get(bucketStart);
      const netPerpUsd = perpPoint?.netUsd ?? 0;
      const netSpotUsd = spotPoint?.netUsd ?? 0;

      cumulativePerp += netPerpUsd;
      cumulativeSpot += netSpotUsd;

      return {
        bucketStart,
        xLabel: formatBucketLabel(bucketStart, chartWindow),
        tooltipLabel: formatTooltipTimestamp(bucketStart),
        netPerpUsd,
        netSpotUsd,
        cumPerpUsd: cumulativePerp,
        cumSpotUsd: cumulativeSpot,
        closePrice: perpPoint?.closePrice ?? spotPoint?.closePrice,
      };
    });
}

export function splitVolume(row) {
  const netUsd = row?.netUsd ?? 0;
  const totalUsd = Math.max(row?.totalUsd ?? 0, Math.abs(netUsd));

  return {
    buyUsd: Math.max(0, (totalUsd + netUsd) / 2),
    sellUsd: Math.max(0, (totalUsd - netUsd) / 2),
  };
}

export function getAverageTradeSize(row) {
  if (!row?.tradeCount || !row?.totalUsd) {
    return null;
  }

  return row.totalUsd / row.tradeCount;
}

export function getAverageEntry(row) {
  if (!row?.netUsd || !row?.netSize) {
    return null;
  }

  const absSize = Math.abs(row.netSize);

  if (absSize === 0) {
    return null;
  }

  return Math.abs(row.netUsd) / absSize;
}

export function formatParticipantWindowLabel(windowValue) {
  return windowValue.toUpperCase();
}

export function getShareOfWindow(totalUsd, delta) {
  const denominator = (delta?.buyUsd ?? 0) + (delta?.sellUsd ?? 0);

  if (!Number.isFinite(totalUsd) || denominator <= 0) {
    return null;
  }

  return (totalUsd / denominator) * 100;
}

export function formatFourHourKey(isoString) {
  const date = new Date(isoString);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}`;
}
