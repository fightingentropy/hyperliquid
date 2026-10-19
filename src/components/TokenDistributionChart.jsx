import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cx } from "../lib/cx";
import { formatCount } from "../lib/formatters";
import { formatCompactAmount } from "../lib/tokenAnalytics";

const COUNT_COLOR = "#60a5fa";
const CUMULATIVE_COLOR = "var(--primary)";

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

function TooltipBody({ active, payload, countLabel }) {
  const bucket = active ? payload?.[0]?.payload : null;

  if (!bucket) {
    return null;
  }

  return (
    <div className="min-w-[180px] rounded-sm border border-border bg-card p-3 text-xs shadow-lg">
      <div className="mb-2 border-b border-border pb-2">
        <div className="font-medium text-foreground">{bucket.label}</div>
        <div className="text-muted-foreground">Range (tokens)</div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: COUNT_COLOR }} />
            {countLabel}
          </span>
          <span className="font-mono text-foreground">{formatCount(bucket.count)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="pl-4 text-muted-foreground">Bucket total</span>
          <span className="font-mono text-foreground">{formatCompactAmount(bucket.binTotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: CUMULATIVE_COLOR }} />
            Cumulative supply
          </span>
          <span className="font-mono text-foreground">{formatPercent(bucket.cumulativeSupplyPct)}</span>
        </div>
      </div>
    </div>
  );
}

function ChartLegend({ payload, onItemClick }) {
  const items = Array.isArray(payload) ? payload : [];

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 pt-3 text-xs">
      {items.map((item) => (
        <button
          key={String(item.dataKey)}
          type="button"
          className={cx(
            "inline-flex items-center gap-2 rounded-sm px-2 py-1 transition-colors hover:bg-muted/40",
            item.inactive ? "text-muted-foreground/70" : "text-muted-foreground",
          )}
          onClick={() => onItemClick(item.dataKey)}
        >
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: item.color, opacity: item.inactive ? 0.35 : 1 }}
          />
          <span className={cx("leading-none", item.inactive && "line-through")}>{item.value}</span>
        </button>
      ))}
    </div>
  );
}

// Histogram of entries per balance bucket (left axis) with the cumulative
// share of supply up to each bucket (right axis, 0-100%).
export default function TokenDistributionChart({
  buckets,
  countLabel,
  cumulativeLabel,
  height = 360,
}) {
  const [hidden, setHidden] = useState({ count: false, cumulativeSupplyPct: false });
  const initialDimension = { width: -1, height };

  const toggleSeries = (dataKey) => {
    setHidden((current) => ({ ...current, [dataKey]: !current[dataKey] }));
  };

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minHeight={height}
        initialDimension={initialDimension}
      >
        <ComposedChart data={buckets} margin={{ top: 12, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            angle={-25}
            textAnchor="end"
            height={60}
            interval={0}
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickMargin={8}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            yAxisId="count"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCompactAmount}
            width={50}
          />
          <YAxis
            yAxisId="cumulative"
            orientation="right"
            domain={[0, 100]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${value}%`}
            width={45}
          />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }}
            content={<TooltipBody countLabel={countLabel} />}
          />
          <Legend
            verticalAlign="bottom"
            height={34}
            content={(props) => <ChartLegend payload={props.payload} onItemClick={toggleSeries} />}
          />
          <Bar
            yAxisId="count"
            dataKey="count"
            name={countLabel}
            fill={COUNT_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            minPointSize={2}
            isAnimationActive={false}
            hide={hidden.count}
          />
          <Line
            yAxisId="cumulative"
            type="linear"
            dataKey="cumulativeSupplyPct"
            name={cumulativeLabel}
            stroke={CUMULATIVE_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "var(--card)", stroke: CUMULATIVE_COLOR, strokeWidth: 2 }}
            isAnimationActive={false}
            hide={hidden.cumulativeSupplyPct}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
