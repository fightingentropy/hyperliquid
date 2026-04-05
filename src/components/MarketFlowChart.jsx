import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cx } from "../lib/cx";
import { formatCurrency, formatSignedCurrency } from "../lib/formatters";

function getTickInterval(chartWindow, pointCount) {
  const targetTicks = chartWindow === "24h" ? 12 : chartWindow === "7d" ? 14 : 10;
  return pointCount <= targetTicks ? 0 : Math.max(0, Math.ceil(pointCount / targetTicks) - 1);
}

function formatMillions(value) {
  if (!Number.isFinite(value)) {
    return "$0M";
  }

  return `$${Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1_000_000)}M`;
}

function formatPriceTick(value) {
  if (!Number.isFinite(value)) {
    return "$0";
  }

  return `$${Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)}`;
}

function TooltipBody({ active, payload, mode, assetLabel }) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0]?.payload;

  if (!point) {
    return null;
  }

  const combinedCumulative = (point.cumPerpUsd ?? 0) + (point.cumSpotUsd ?? 0);
  const combinedInterval = (point.netPerpUsd ?? 0) + (point.netSpotUsd ?? 0);

  return (
    <div className="rounded-sm border border-border bg-card p-3 text-xs shadow-lg">
      <div className="mb-2 font-medium text-foreground">{point.tooltipLabel}</div>

      <div className="space-y-1">
        {Number.isFinite(point.closePrice) ? (
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">
              {mode === "interval" ? `${assetLabel} price:` : "Price:"}
            </span>
            <span className="font-mono font-semibold" style={{ color: "var(--primary)" }}>
              {formatPriceTick(point.closePrice)}
            </span>
          </div>
        ) : null}

        {mode === "interval" ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Net flow:</span>
              <span
                className={cx(
                  "font-mono font-semibold",
                  point.netUsd >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {formatSignedCurrency(point.netUsd, 2)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Buy flow:</span>
              <span className="font-mono text-foreground">{formatCurrency(point.buyUsd ?? 0, 2)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Sell flow:</span>
              <span className="font-mono text-foreground">{formatCurrency(point.sellUsd ?? 0, 2)}</span>
            </div>
          </>
        ) : null}

        {mode === "cumulative" ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Cumulative:</span>
              <span
                className={cx(
                  "font-mono font-semibold",
                  point.cumNetUsd >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {formatSignedCurrency(point.cumNetUsd, 2)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Interval net:</span>
              <span
                className={cx(
                  "font-mono font-semibold",
                  point.netUsd >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {formatSignedCurrency(point.netUsd, 2)}
              </span>
            </div>
          </>
        ) : null}

        {mode === "hype-comparison" ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Perp (cum):</span>
              <span
                className={cx(
                  "font-mono font-semibold",
                  point.cumPerpUsd >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {formatSignedCurrency(point.cumPerpUsd, 2)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Spot (cum):</span>
              <span
                className={cx(
                  "font-mono font-semibold",
                  point.cumSpotUsd >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {formatSignedCurrency(point.cumSpotUsd, 2)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Combined (cum):</span>
              <span
                className={cx(
                  "font-mono font-semibold",
                  combinedCumulative >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {formatSignedCurrency(combinedCumulative, 2)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Combined (interval):</span>
              <span
                className={cx(
                  "font-mono font-semibold",
                  combinedInterval >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {formatSignedCurrency(combinedInterval, 2)}
              </span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ChartLegend({ payload, onItemClick }) {
  const items = Array.isArray(payload) ? payload : [];

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 pt-3 text-xs">
      {items.map((item) => (
        <button
          key={String(item.dataKey ?? item.value)}
          type="button"
          className={cx(
            "inline-flex items-center gap-2 rounded-sm px-2 py-1 transition-colors hover:bg-muted/40",
            item.inactive ? "text-muted-foreground/70" : "text-muted-foreground",
          )}
          onClick={() => onItemClick(item)}
        >
          <span
            className="inline-block size-2.5 rounded-full"
            style={{
              backgroundColor: item.color ?? "var(--muted-foreground)",
              opacity: item.inactive ? 0.35 : 1,
            }}
          />
          <span className={cx("leading-none", item.inactive && "line-through")}>{item.value}</span>
        </button>
      ))}
    </div>
  );
}

export default function MarketFlowChart({
  data,
  chartWindow,
  mode,
  assetLabel,
  seriesVisibility,
  onLegendClick,
  height = 360,
}) {
  const tickInterval = getTickInterval(chartWindow, data.length);
  const initialDimension = { width: -1, height };

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minHeight={height}
        initialDimension={initialDimension}
      >
        <ComposedChart data={data} margin={{ top: 12, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="xLabel"
            interval={tickInterval}
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            dy={8}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatMillions}
            width={50}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            tick={{ fill: "var(--primary)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatPriceTick}
            width={58}
            domain={["dataMin", "dataMax"]}
            hide={!seriesVisibility.price}
          />
          <ReferenceLine
            yAxisId="left"
            y={0}
            stroke="var(--muted-foreground)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <Tooltip content={<TooltipBody mode={mode} assetLabel={assetLabel} />} />

          {mode === "interval" ? (
            <>
              <Bar
                yAxisId="left"
                dataKey="netUsd"
                name="Net"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
                isAnimationActive={false}
              >
                {data.map((point, index) => (
                  <Cell
                    key={`${point.bucketStart}-${index}`}
                    fill={point.netUsd >= 0 ? "var(--profit)" : "var(--loss)"}
                  />
                ))}
              </Bar>
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="closePrice"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={false}
                connectNulls
                name={`${assetLabel} Price`}
                isAnimationActive={false}
              />
            </>
          ) : null}

          {mode === "cumulative" ? (
            <>
              <Legend
                verticalAlign="bottom"
                height={34}
                content={(props) => (
                  <ChartLegend payload={props.payload} onItemClick={onLegendClick} />
                )}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="cumNetUsd"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
                connectNulls
                name="Cumulative net flow"
                isAnimationActive={false}
                hide={!seriesVisibility.primary}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="closePrice"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={false}
                connectNulls
                name="Price"
                isAnimationActive={false}
                hide={!seriesVisibility.price}
              />
            </>
          ) : null}

          {mode === "hype-comparison" ? (
            <>
              <Legend
                verticalAlign="bottom"
                height={34}
                content={(props) => (
                  <ChartLegend payload={props.payload} onItemClick={onLegendClick} />
                )}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="cumPerpUsd"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
                connectNulls
                name="HYPE Perp"
                isAnimationActive={false}
                hide={!seriesVisibility.perp}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="cumSpotUsd"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={false}
                connectNulls
                name="HYPE Spot"
                isAnimationActive={false}
                hide={!seriesVisibility.spot}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="closePrice"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={false}
                connectNulls
                name="Price"
                isAnimationActive={false}
                hide={!seriesVisibility.price}
              />
            </>
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
