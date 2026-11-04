import { useEffect, useMemo, useState } from "react";
import { cx } from "../lib/cx";
import { formatCompactCurrency2, formatCompactSignedCurrency2 } from "../lib/formatters";
import {
  TWAP_PRESSURE_SCOPES,
  TWAP_PRESSURE_WINDOWS,
  filterHypeTwaps,
  projectTwapFlow,
} from "../lib/hypurrscan";

const SCOPE_STORAGE_KEY = "qf-twap-pressure-scope";
const WINDOWS = [
  { label: "Next 1h", ms: TWAP_PRESSURE_WINDOWS.HOUR_MS },
  { label: "Next 24h", ms: TWAP_PRESSURE_WINDOWS.DAY_MS },
];

function readStoredScope() {
  try {
    const value = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    return TWAP_PRESSURE_SCOPES.some((scope) => scope.value === value) ? value : "all";
  } catch {
    return "all";
  }
}

function storeScope(value) {
  try {
    window.localStorage.setItem(SCOPE_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable; the toggle still works for this visit.
  }
}

function pressureTone(value) {
  if (!Number.isFinite(value) || value === 0) {
    return "text-foreground";
  }

  return value > 0 ? "text-profit" : "text-loss";
}

function PressureTile({ label, flow, hasData }) {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border p-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={cx("text-lg font-light", pressureTone(flow.net))}>
          {hasData ? formatCompactSignedCurrency2(flow.net) : "—"}
        </span>
      </div>
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={hasData ? `${Math.round(flow.buyPct)}% buys` : "No data"}
      >
        {hasData && flow.buy + flow.sell > 0 ? (
          <>
            <div style={{ width: `${flow.buyPct}%`, backgroundColor: "var(--flow-buy)" }} />
            <div style={{ width: "2px", backgroundColor: "var(--card)" }} />
            <div style={{ flex: 1, backgroundColor: "var(--flow-sell)" }} />
          </>
        ) : null}
      </div>
      <div className="flex items-start justify-between gap-2 text-xs tabular-nums">
        <span className="flex flex-col text-muted-foreground">
          Buy <span className="text-foreground">{hasData ? formatCompactCurrency2(flow.buy) : "—"}</span>
        </span>
        <span className="flex flex-col text-right text-muted-foreground">
          Sell <span className="text-foreground">{hasData ? formatCompactCurrency2(flow.sell) : "—"}</span>
        </span>
      </div>
    </div>
  );
}

export default function TwapPressureCard({ activeTwaps, loading, error }) {
  // Re-tick once a second so the projection counts down as the TWAPs execute,
  // matching the live feel of the source dashboard.
  const [now, setNow] = useState(() => Date.now());
  const [scope, setScope] = useState(readStoredScope);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const hasData = Array.isArray(activeTwaps) && !error;
  const orders = useMemo(() => filterHypeTwaps(activeTwaps, scope), [activeTwaps, scope]);
  const flows = useMemo(() => WINDOWS.map((range) => projectTwapFlow(orders, now, range.ms)), [orders, now]);

  const caption = error
    ? "Unable to load TWAP data."
    : !Array.isArray(activeTwaps) && loading
      ? "Loading active orders…"
      : orders.length === 0
        ? `No active HYPE${scope === "spot" ? " spot" : ""} TWAPs`
        : `${orders.length} active HYPE${scope === "spot" ? " spot" : ""} TWAP${orders.length === 1 ? "" : "s"} · projected flow`;

  const selectScope = (value) => {
    setScope(value);
    storeScope(value);
  };

  return (
    <article className="flex h-full flex-col gap-3 rounded-sm border border-border bg-card px-5 py-4 text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-light uppercase tracking-wide text-muted-foreground">
          TWAP HYPE Buy Pressure
        </p>
        <div className="flex items-center gap-1 rounded-sm border border-border p-1" role="group" aria-label="Markets">
          {TWAP_PRESSURE_SCOPES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => selectScope(option.value)}
              aria-pressed={scope === option.value}
              className={
                scope === option.value
                  ? "rounded-sm bg-muted px-2 py-0.5 text-xs font-medium uppercase text-foreground"
                  : "rounded-sm px-2 py-0.5 text-xs uppercase text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {WINDOWS.map((range, index) => (
          <PressureTile key={range.label} label={range.label} flow={flows[index]} hasData={hasData} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{caption}</p>
    </article>
  );
}
