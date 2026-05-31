import { cx } from "../lib/cx";

export default function MetricCard({
  label,
  value,
  tone = "neutral",
  loading = false,
  surface = "default",
}) {
  const toneClassName =
    tone === "positive"
      ? "text-profit"
      : tone === "negative"
        ? "text-loss"
        : "text-foreground";

  if (surface === "market-flow") {
    return (
      <article className="flex h-full flex-col gap-4 rounded-sm border border-border bg-card py-4 text-card-foreground shadow-none">
        <div className="flex h-full flex-col justify-between gap-1.5 p-3">
          <p className="text-xs font-light uppercase tracking-wide text-muted-foreground">{label}</p>
          <p
            className={cx(
              "min-w-0 truncate text-xl font-light tabular-nums",
              toneClassName,
            )}
            title={typeof value === "string" ? value : undefined}
          >
            {loading ? "Loading…" : value}
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className="h-full rounded-sm border border-border bg-card">
      <div className="flex h-full flex-col justify-between gap-2 p-3">
        <p className="text-xs font-light uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cx("min-w-0 truncate text-xl font-light tabular-nums", toneClassName)}>
          {loading ? "Loading…" : value}
        </p>
      </div>
    </article>
  );
}
