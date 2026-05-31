import { Cell, Pie, PieChart as RechartsPieChart, Tooltip } from "recharts";
import { formatCurrency } from "../lib/formatters";

function WalletCompositionTooltip({ active, payload }) {
  const slice = payload?.[0]?.payload;

  if (!active || !slice) {
    return null;
  }

  return (
    <div className="rounded-sm border border-border bg-card p-3 text-xs shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: slice.color }}
        />
        <span className="font-medium text-foreground">{slice.label}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Value</span>
        <span className="font-mono text-foreground">{formatCurrency(slice.valueUsd, 2)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Share</span>
        <span className="font-mono text-foreground">{slice.percent.toFixed(1)}%</span>
      </div>
    </div>
  );
}

export default function WalletCompositionCard({ slices }) {
  const colors = {
    spot: "#22c55e",
    staked: "#a78bfa",
    perps: "#f97316",
  };
  const chartSlices = slices.map((slice) => ({
    ...slice,
    color: colors[slice.key],
  }));

  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="space-y-2 p-4">
        <p className="text-sm font-medium text-muted-foreground">Account composition</p>
        <p className="text-[11px] text-muted-foreground/70">
          Spot vs staked HYPE vs perps (perp equity).
        </p>

        <div className="space-y-4 pt-4">
          <div className="flex justify-center">
            <RechartsPieChart width={224} height={224}>
              <Tooltip content={<WalletCompositionTooltip />} />
              <Pie
                data={chartSlices}
                dataKey="valueUsd"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={0}
                outerRadius={84}
                stroke="var(--border)"
                strokeWidth={1}
                isAnimationActive={false}
              >
                {chartSlices.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} />
                ))}
              </Pie>
            </RechartsPieChart>
          </div>

          <div className="grid grid-cols-1 gap-2 text-[10px] sm:grid-cols-3">
            {chartSlices.map((slice) => (
              <div
                key={slice.key}
                className="min-w-0 rounded-sm border border-border px-1.5 py-2"
              >
                <div className="mb-1 flex min-w-0 items-center gap-1">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="text-muted-foreground">{slice.label}</span>
                </div>
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate font-mono text-foreground">{formatCurrency(slice.valueUsd, 2)}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">{slice.percent.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
