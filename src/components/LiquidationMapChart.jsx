import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const LONG_COLOR = "#ff4055";
const SHORT_COLOR = "#2bb8a8";
const LIQUIDATION_BAR_SIZE = 10;

function formatCompactNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
  }).format(value);
}

function formatPrice(value) {
  if (!Number.isFinite(value)) {
    return "$0";
  }

  return `$${Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 1_000 ? 0 : 4,
  }).format(value)}`;
}

function formatTokenAmount(value, symbol) {
  if (!Number.isFinite(value)) {
    return `0 ${symbol}`;
  }

  return `${Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 3,
  }).format(value)} ${symbol}`;
}

function buildPriceTicks(points) {
  const lastIndex = points.length - 1;

  if (lastIndex <= 0) {
    return [0];
  }

  const tickCount = Math.min(7, points.length);
  const ticks = new Set();

  for (let index = 0; index < tickCount; index += 1) {
    ticks.add(Math.round((lastIndex * index) / (tickCount - 1)));
  }

  return [...ticks].sort((left, right) => left - right);
}

function aggregateRows(rows, side) {
  const groups = new Map();

  rows.forEach((row) => {
    const isShort = row.size < 0;

    if ((side === "short" && !isShort) || (side === "long" && isShort)) {
      return;
    }

    const key = `${row.liquidationPrice}`;
    const existing = groups.get(key) ?? {
      price: row.liquidationPrice,
      size: 0,
      positionUsd: 0,
      count: 0,
      updateTime: 0,
    };

    existing.size += Math.abs(row.size);
    existing.positionUsd += Math.abs(row.positionUsd ?? 0);
    existing.count += 1;
    existing.updateTime = Math.max(existing.updateTime, row.updateTime ?? 0);
    groups.set(key, existing);
  });

  return [...groups.values()].sort((left, right) => left.price - right.price);
}

export function buildLiquidationChartModel(mapData) {
  if (!mapData?.rows?.length) {
    return {
      points: [],
      totalLong: 0,
      totalShort: 0,
      maxLongLevel: 0,
      maxShortLevel: 0,
      currentIndex: 0,
      domain: [1, 10],
    };
  }

  const longRows = aggregateRows(mapData.rows, "long");
  const shortRows = aggregateRows(mapData.rows, "short");
  let cumulativeLong = 0;
  let cumulativeShort = 0;
  let maxLongLevel = 0;
  let maxShortLevel = 0;

  const longPoints = [...longRows]
    .reverse()
    .map((row) => {
      cumulativeLong += row.size;
      maxLongLevel = Math.max(maxLongLevel, row.size);

      return {
        price: row.price,
        longBar: row.size,
        cumulativeLong,
        longCount: row.count,
        longPositionUsd: row.positionUsd,
      };
    })
    .reverse();

  const shortPoints = shortRows.map((row) => {
    cumulativeShort += row.size;
    maxShortLevel = Math.max(maxShortLevel, row.size);

    return {
      price: row.price,
      shortBar: row.size,
      cumulativeShort,
      shortCount: row.count,
      shortPositionUsd: row.positionUsd,
    };
  });

  const points = [
    ...longPoints,
    {
      price: mapData.price,
      isCurrentPrice: true,
    },
    ...shortPoints,
  ].sort((left, right) => left.price - right.price);

  const indexedPoints = points.map((point, index) => ({
    ...point,
    index,
  }));
  const currentIndex = indexedPoints.findIndex((point) => point.isCurrentPrice);

  return {
    points: indexedPoints,
    currentIndex: currentIndex >= 0 ? currentIndex : Math.max(0, longPoints.length),
    totalLong: cumulativeLong,
    totalShort: cumulativeShort,
    maxLongLevel,
    maxShortLevel,
    domain: [0, Math.max(1, indexedPoints.length - 1)],
  };
}

function LiquidationTooltip({ active, payload, symbol }) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload.find((item) => item?.payload)?.payload;

  if (!point) {
    return null;
  }

  return (
    <div className="qf-liquidation-tooltip">
      <div className="qf-liquidation-tooltip__title">{formatPrice(point.price)}</div>

      {point.isCurrentPrice ? (
        <div className="qf-liquidation-tooltip__row">
          <span>Current price</span>
          <strong>{formatPrice(point.price)}</strong>
        </div>
      ) : null}

      {Number.isFinite(point.longBar) ? (
        <>
          <div className="qf-liquidation-tooltip__row">
            <span>Long</span>
            <strong style={{ color: LONG_COLOR }}>{formatTokenAmount(point.longBar, symbol)}</strong>
          </div>
          <div className="qf-liquidation-tooltip__row">
            <span>Cumulative long</span>
            <strong>{formatTokenAmount(point.cumulativeLong, symbol)}</strong>
          </div>
          <div className="qf-liquidation-tooltip__row">
            <span>Positions</span>
            <strong>{point.longCount}</strong>
          </div>
        </>
      ) : null}

      {Number.isFinite(point.shortBar) ? (
        <>
          <div className="qf-liquidation-tooltip__row">
            <span>Short</span>
            <strong style={{ color: SHORT_COLOR }}>{formatTokenAmount(point.shortBar, symbol)}</strong>
          </div>
          <div className="qf-liquidation-tooltip__row">
            <span>Cumulative short</span>
            <strong>{formatTokenAmount(point.cumulativeShort, symbol)}</strong>
          </div>
          <div className="qf-liquidation-tooltip__row">
            <span>Positions</span>
            <strong>{point.shortCount}</strong>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function LiquidationMapChart({ model, currentPrice, symbol, height = 560 }) {
  const ticks = buildPriceTicks(model.points);

  return (
    <div className="qf-liquidation-chart" style={{ height }}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minHeight={height}
        initialDimension={{ width: -1, height }}
      >
        <ComposedChart data={model.points} margin={{ top: 70, right: 8, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="liqShortFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={SHORT_COLOR} stopOpacity={0.22} />
              <stop offset="100%" stopColor={SHORT_COLOR} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="liqLongFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={LONG_COLOR} stopOpacity={0.2} />
              <stop offset="100%" stopColor={LONG_COLOR} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="5 5" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="index"
            type="number"
            domain={model.domain}
            allowDataOverflow
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={(value) => formatPrice(model.points[Math.round(value)]?.price)}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            ticks={ticks}
            minTickGap={34}
            dy={8}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="level"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={formatCompactNumber}
            tickLine={false}
            axisLine={false}
            width={54}
          />
          <YAxis
            yAxisId="cumulative"
            orientation="right"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={formatCompactNumber}
            tickLine={false}
            axisLine={false}
            width={62}
          />
          <Tooltip content={<LiquidationTooltip symbol={symbol} />} />
          <Legend
            verticalAlign="top"
            height={58}
            iconType="square"
            wrapperStyle={{ color: "var(--foreground)", fontSize: 12 }}
          />
          <ReferenceLine
            x={model.currentIndex}
            yAxisId="level"
            stroke={LONG_COLOR}
            strokeDasharray="8 6"
            strokeWidth={2}
            label={{
              value: `Current Price: ${formatPrice(currentPrice).slice(1)}`,
              position: "top",
              fill: "var(--foreground)",
              fontSize: 12,
            }}
          />
          <Area
            yAxisId="cumulative"
            type="monotone"
            dataKey="cumulativeShort"
            name="Cumulative Short"
            stroke={SHORT_COLOR}
            strokeWidth={2.5}
            fill="url(#liqShortFill)"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Area
            yAxisId="cumulative"
            type="monotone"
            dataKey="cumulativeLong"
            name="Cumulative Long"
            stroke={LONG_COLOR}
            strokeWidth={2.5}
            fill="url(#liqLongFill)"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="level"
            dataKey="shortBar"
            name="Short"
            fill={SHORT_COLOR}
            barSize={LIQUIDATION_BAR_SIZE}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="level"
            dataKey="longBar"
            name="Long"
            fill={LONG_COLOR}
            barSize={LIQUIDATION_BAR_SIZE}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
