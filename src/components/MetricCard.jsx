import { cx } from "../lib/cx";

export default function MetricCard({ label, value, tone = "neutral", loading = false }) {
  const toneClassName =
    tone === "positive"
      ? "text-profit"
      : tone === "negative"
        ? "text-loss"
        : "text-foreground";

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
