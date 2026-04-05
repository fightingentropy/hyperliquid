import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cx } from "../lib/cx";
import { formatAxisCurrency, formatCurrency, formatSignedCurrency } from "../lib/formatters";

function tooltipValue(point, metric) {
  if (!point) {
    return "—";
  }

  return metric === "pnl" ? formatSignedCurrency(point.value, 2) : formatCurrency(point.value, 2);
}

function WalletPerformanceTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="rounded-sm border border-border bg-card p-3 text-xs shadow-lg">
      <div className="mb-2 font-medium text-foreground">{point.tooltipLabel}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">
          {metric === "pnl" ? "Realized PnL" : "Account value"}
        </span>
        <span
          className={cx(
            "font-mono font-semibold",
            metric === "pnl"
              ? point.value > 0
                ? "text-profit"
                : point.value < 0
                  ? "text-loss"
                  : "text-foreground"
              : "text-foreground",
          )}
        >
          {tooltipValue(point, metric)}
        </span>
      </div>
    </div>
  );
}

export default function WalletPerformanceChart({ data, metric, loading, height = 340 }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Loading chart...
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No performance data available.
      </div>
    );
  }

  const stroke = metric === "pnl" ? "var(--primary)" : "var(--foreground)";
  const fill = metric === "pnl" ? "rgba(249, 115, 22, 0.16)" : "rgba(255, 255, 255, 0.08)";

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="wallet-performance-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fill} stopOpacity={1} />
              <stop offset="100%" stopColor={fill} stopOpacity={0.1} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="axisLabel"
            axisLine={false}
            tickLine={false}
            minTickGap={28}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tickFormatter={formatAxisCurrency}
            width={84}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <Tooltip content={<WalletPerformanceTooltip metric={metric} />} />
          <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 4" />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill="url(#wallet-performance-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
