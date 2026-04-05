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
  const total = slices.reduce((sum, slice) => sum + slice.valueUsd, 0);
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

        <div className="space-y-3 pt-1 lg:hidden">
          <div className="h-3 w-full overflow-hidden rounded-sm border border-border bg-muted">
            <div className="flex h-full w-full">
              {chartSlices.map((slice) => (
                <div
                  key={slice.key}
                  className="h-full"
                  style={{
                    width: `${total > 0 ? (slice.valueUsd / total) * 100 : 0}%`,
                    backgroundColor: slice.color,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2 text-xs">
            {chartSlices.map((slice) => (
              <div key={slice.key} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="text-muted-foreground">{slice.label}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-foreground">{formatCurrency(slice.valueUsd, 2)}</span>
                  <span className="font-mono text-muted-foreground">{slice.percent.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden items-center gap-4 pt-1 lg:flex">
          <div className="flex h-44 w-44 shrink-0 items-center justify-center">
            <RechartsPieChart width={176} height={176}>
              <Tooltip content={<WalletCompositionTooltip />} />
              <Pie
                data={chartSlices}
                dataKey="valueUsd"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={54}
                outerRadius={74}
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

          <div className="min-w-0 flex-1 space-y-2 text-xs">
            {chartSlices.map((slice) => (
              <div key={slice.key} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="text-muted-foreground">{slice.label}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-foreground">{formatCurrency(slice.valueUsd, 2)}</span>
                  <span className="font-mono text-muted-foreground">{slice.percent.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
