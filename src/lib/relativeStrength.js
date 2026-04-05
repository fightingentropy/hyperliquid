import { formatTooltipTimestamp, pad2 } from "./formatters";

export const DEFAULT_RELATIVE_STRENGTH_FOCUS = "HYPE";

export const RELATIVE_STRENGTH_WINDOW_OPTIONS = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
];

export const RELATIVE_STRENGTH_UNIVERSE_OPTIONS = [
  { value: 18, label: "18 assets" },
  { value: 24, label: "24 assets" },
  { value: 32, label: "32 assets" },
];

const SERIES_PALETTE = [
  "#4ade80",
  "#2dd4bf",
  "#38bdf8",
  "#818cf8",
  "#f59e0b",
  "#fb7185",
  "#c084fc",
  "#f97316",
  "#34d399",
  "#60a5fa",
  "#f472b6",
  "#a78bfa",
  "#fde047",
  "#22c55e",
  "#f87171",
  "#67e8f9",
];

function formatRelativeStrengthTick(timestamp, chartWindow) {
  const date = new Date(timestamp);

  if (chartWindow === "24h") {
    return `${pad2(date.getUTCHours())}:00`;
  }

  return `${pad2(date.getUTCMonth() + 1)}/${pad2(date.getUTCDate())}`;
}

function normalizeAssetSeries(asset, index) {
  const points = Array.isArray(asset.points)
    ? asset.points.filter(
        (point) => Number.isFinite(point?.timestamp) && Number.isFinite(point?.closePrice),
      )
    : [];

  if (!points.length) {
    return null;
  }

  const basePrice = points[0].closePrice;

  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return null;
  }

  const normalizedPoints = points.map((point) => ({
    ...point,
    relativeChange: ((point.closePrice - basePrice) / basePrice) * 100,
  }));

  return {
    ...asset,
    color: SERIES_PALETTE[index % SERIES_PALETTE.length],
    points: normalizedPoints,
    latestChange: normalizedPoints.at(-1)?.relativeChange ?? null,
  };
}

export function buildRelativeStrengthModel(rawAssets, chartWindow) {
  const preparedAssets = rawAssets
    .map((asset, index) => normalizeAssetSeries(asset, index))
    .filter((asset) => asset && asset.points.length >= 2 && Number.isFinite(asset.latestChange));

  const timestamps = Array.from(
    new Set(preparedAssets.flatMap((asset) => asset.points.map((point) => point.timestamp))),
  ).sort((left, right) => left - right);

  const pointMaps = new Map(
    preparedAssets.map((asset) => [
      asset.symbol,
      new Map(asset.points.map((point) => [point.timestamp, point.relativeChange])),
    ]),
  );

  const chartData = timestamps.map((timestamp) => {
    const point = {
      timestamp,
      xLabel: formatRelativeStrengthTick(timestamp, chartWindow),
      tooltipLabel: formatTooltipTimestamp(new Date(timestamp).toISOString()),
    };

    preparedAssets.forEach((asset) => {
      const value = pointMaps.get(asset.symbol)?.get(timestamp);
      point[asset.symbol] = Number.isFinite(value) ? value : null;
    });

    return point;
  });

  const assets = [...preparedAssets].sort(
    (left, right) =>
      right.latestChange - left.latestChange || right.dayNotionalVolume - left.dayNotionalVolume,
  );

  const values = chartData.flatMap((point) =>
    assets.map((asset) => point[asset.symbol]).filter((value) => Number.isFinite(value)),
  );

  const minValue = values.length ? Math.min(...values) : -1;
  const maxValue = values.length ? Math.max(...values) : 1;
  const spread = Math.max(maxValue - minValue, 3);
  const padding = Math.max(spread * 0.08, 0.6);

  return {
    assets,
    chartData,
    domain: [Math.min(0, minValue - padding), Math.max(0, maxValue + padding)],
    latestTimestamp: timestamps.at(-1) ?? null,
  };
}

export function resolveRelativeStrengthFocus(assets, currentFocus) {
  if (assets.some((asset) => asset.symbol === currentFocus)) {
    return currentFocus;
  }

  if (assets.some((asset) => asset.symbol === DEFAULT_RELATIVE_STRENGTH_FOCUS)) {
    return DEFAULT_RELATIVE_STRENGTH_FOCUS;
  }

  return assets[0]?.symbol ?? null;
}

export function buildRelativeStrengthSnapshot(assets, focusSymbol) {
  const focus = assets.find((asset) => asset.symbol === focusSymbol) ?? null;
  const leader = assets[0] ?? null;
  const laggard = assets.at(-1) ?? null;
  const positiveCount = assets.filter((asset) => asset.latestChange > 0).length;

  return {
    focus,
    leader,
    laggard,
    breadthPercent: assets.length ? (positiveCount / assets.length) * 100 : null,
    spreadPercent:
      leader && laggard
        ? leader.latestChange - laggard.latestChange
        : null,
  };
}
