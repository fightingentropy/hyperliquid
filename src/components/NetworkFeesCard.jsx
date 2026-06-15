import { cx } from "../lib/cx";
import { formatCurrency, formatSignedPercent } from "../lib/formatters";

const CHART_VIEW_WIDTH = 320;
const CHART_VIEW_HEIGHT = 60;

function formatHourLabel(startSec) {
  return new Date(startSec * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FeeBars({ hourly }) {
  const values = hourly.map((bucket) => bucket.value);
  const max = Math.max(1, ...values);
  const slot = CHART_VIEW_WIDTH / hourly.length;
  const barWidth = slot * 0.62;

  return (
    <svg
      viewBox={`0 0 ${CHART_VIEW_WIDTH} ${CHART_VIEW_HEIGHT}`}
      width="100%"
      height={CHART_VIEW_HEIGHT}
      preserveAspectRatio="none"
      role="img"
      aria-label="Network fees per hour over the last 24 hours"
      className="block"
    >
      {hourly.map((bucket, index) => {
        const height = bucket.value > 0 ? Math.max(2, (bucket.value / max) * CHART_VIEW_HEIGHT) : 0;
        const x = index * slot + (slot - barWidth) / 2;

        return (
          <rect
            key={bucket.startSec}
            x={x}
            y={CHART_VIEW_HEIGHT - height}
            width={barWidth}
            height={height}
            rx={1}
            style={{ fill: "var(--primary)", opacity: 0.82 }}
          >
            <title>{`${formatHourLabel(bucket.startSec)} · ${formatCurrency(bucket.value, 0)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export default function NetworkFeesCard({ data, loading, error }) {
  const daily = data?.daily;
  const changePct = data?.changePct;
  const hourly = data?.hourly ?? [];
  const hasValue = Number.isFinite(daily);
  const changeTone = Number.isFinite(changePct)
    ? changePct >= 0
      ? "text-profit"
      : "text-loss"
    : "text-muted-foreground";

  return (
    <article className="flex h-full flex-col gap-4 rounded-sm border border-border bg-card px-5 py-4 text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-light uppercase tracking-wide text-muted-foreground">
          24h Fees
        </p>
        <span className="text-xs font-light uppercase tracking-wide text-muted-foreground">
          Network
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-2xl font-light tabular-nums text-foreground">
          {loading && !hasValue ? "Loading…" : hasValue ? formatCurrency(daily, 0) : "—"}
        </p>
        {Number.isFinite(changePct) ? (
          <span className={cx("text-sm font-light tabular-nums", changeTone)}>
            ({formatSignedPercent(changePct)})
          </span>
        ) : null}
      </div>

      <div className="mt-auto pt-1" style={{ minHeight: CHART_VIEW_HEIGHT }}>
        {error && !hasValue ? (
          <p className="text-sm text-muted-foreground">Unable to load fee data.</p>
        ) : hourly.length ? (
          <FeeBars hourly={hourly} />
        ) : (
          <div
            className="rounded-sm border border-border/60"
            style={{ height: CHART_VIEW_HEIGHT }}
          />
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Hyperliquid trading fees, last 24h · hourly
      </p>
    </article>
  );
}
