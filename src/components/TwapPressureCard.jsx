import { useEffect, useMemo, useState } from "react";
import { cx } from "../lib/cx";
import { formatSignedCurrency } from "../lib/formatters";
import { TWAP_PRESSURE_WINDOWS, projectTwapPressure } from "../lib/hypurrscan";

function pressureTone(value) {
  if (!Number.isFinite(value) || value === 0) {
    return "text-foreground";
  }

  return value > 0 ? "text-profit" : "text-loss";
}

function PressureRow({ label, value, hasData }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cx("text-lg font-light tabular-nums", pressureTone(value))}>
        {hasData ? formatSignedCurrency(value) : "—"}
      </span>
    </div>
  );
}

export default function TwapPressureCard({ activeTwaps, loading, error }) {
  // Re-tick once a second so the projection counts down as the TWAPs execute,
  // matching the live feel of the source dashboard.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const orders = activeTwaps ?? [];
  const hasData = Array.isArray(activeTwaps);

  const { next1h, next24h } = useMemo(
    () => ({
      next1h: projectTwapPressure(orders, now, TWAP_PRESSURE_WINDOWS.HOUR_MS),
      next24h: projectTwapPressure(orders, now, TWAP_PRESSURE_WINDOWS.DAY_MS),
    }),
    [orders, now],
  );

  const caption = error
    ? "Unable to load TWAP data."
    : !hasData && loading
      ? "Loading active orders…"
      : orders.length === 0
        ? "No active HYPE TWAPs"
        : `${orders.length} active TWAP${orders.length === 1 ? "" : "s"} · projected net flow`;

  return (
    <article className="flex h-full flex-col gap-4 rounded-sm border border-border bg-card px-5 py-4 text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-light uppercase tracking-wide text-muted-foreground">
          TWAPs HYPE Buy Pressure
        </p>
        <span className="text-xs font-light uppercase tracking-wide text-muted-foreground">
          Spot
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-3">
        <PressureRow label="Next 1h" value={next1h} hasData={hasData && !error} />
        <PressureRow label="Next 24h" value={next24h} hasData={hasData && !error} />
      </div>

      <p className="text-xs text-muted-foreground">{caption}</p>
    </article>
  );
}
