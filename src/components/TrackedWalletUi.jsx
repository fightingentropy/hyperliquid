import { Link } from "react-router-dom";
import { cx } from "../lib/cx";
import { formatCompactCurrency, formatCompactSignedCurrency, formatPrice } from "../lib/formatters";
import { SELL_COLOR } from "./TrackedWalletCharts";

// Pieces shared by the Tracked Wallets views (your wallets and market-flow leaders).

export const SIGNAL_LABELS = { buy: "Buying", sell: "Selling", risk: "Risk", info: "Note" };

export function formatAgo(timestamp, now) {
  if (!timestamp) {
    return "—";
  }
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatTradeTime(timestamp) {
  return new Date(timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function signedClass(value) {
  if (!Number.isFinite(value) || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-profit" : "text-loss";
}

export function Panel({ title, subtitle, actions, children, className }) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-3 rounded-sm border border-border bg-card p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyNote({ children }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function WalletLink({ address, name }) {
  return (
    <Link to={`/wallets/${address}`} className="qf-quiet-link font-medium">
      {name}
    </Link>
  );
}

export function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-sm bg-muted px-3 py-1.5 text-xs font-medium text-foreground"
          : "rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

export function DistanceMeter({ percent }) {
  const width = Math.max(2, Math.min(100, percent));
  const near = percent < 15;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: near ? SELL_COLOR : "var(--muted-foreground)" }} />
      </div>
      <span className={cx("w-14 text-right tabular-nums", near ? "font-medium text-loss" : "text-foreground")}>
        {percent.toFixed(1)}%
      </span>
    </div>
  );
}

export const LIQUIDATION_RANGE_PCT = 50;
export const LIQUIDATION_ROWS = 10;

export function LiquidationTable({ rows }) {
  const near = rows.filter((row) => row.distancePct <= LIQUIDATION_RANGE_PCT).slice(0, LIQUIDATION_ROWS);
  const hidden = rows.length - near.length;
  if (!near.length) {
    return <EmptyNote>No open position is within {LIQUIDATION_RANGE_PCT}% of liquidation.</EmptyNote>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-light">Position</th>
            <th className="px-3 py-2 text-right font-light">Value</th>
            <th className="px-3 py-2 text-right font-light">Entry</th>
            <th className="px-3 py-2 text-right font-light">Mark</th>
            <th className="px-3 py-2 text-right font-light">Liq. price</th>
            <th className="px-3 py-2 text-right font-light">Unrealized</th>
            <th className="px-3 py-2 text-right font-light">Distance</th>
          </tr>
        </thead>
        <tbody>
          {near.map((row) => (
            <tr key={row.key} className="border-t border-border/60">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{row.symbol}</span>
                  <span className={cx("text-xs", row.side === "LONG" ? "text-profit" : "text-loss")}>
                    {row.side === "LONG" ? "Long" : "Short"} {row.leverage ? `${row.leverage}x` : ""}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <Link to={`/wallets/${row.address}`} className="qf-quiet-link">
                    {row.name}
                  </Link>
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCompactCurrency(row.valueUsd)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatPrice(row.entryPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatPrice(row.markPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatPrice(row.liquidationPrice)}</td>
              <td className={cx("px-3 py-2 text-right tabular-nums", signedClass(row.unrealizedPnlUsd))}>
                {formatCompactSignedCurrency(row.unrealizedPnlUsd)}
              </td>
              <td className="px-3 py-2">
                <DistanceMeter percent={row.distancePct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 ? (
        <p className="px-3 pt-2 text-xs text-muted-foreground">
          {hidden} more position{hidden === 1 ? " is" : "s are"} over {LIQUIDATION_RANGE_PCT}% from liquidation.
        </p>
      ) : null}
    </div>
  );
}


export function SignalList({ signals, emptyText }) {
  if (!signals.length) {
    return <EmptyNote>{emptyText}</EmptyNote>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {signals.map((signal) => (
        <li key={signal.text} className="flex items-start gap-3 text-sm">
          <span
            className={cx(
              "mt-0.5 w-16 shrink-0 rounded-sm px-1.5 py-0.5 text-center text-[10px] uppercase tracking-wide",
              signal.kind === "risk" ? "bg-muted text-loss" : "bg-muted text-muted-foreground",
            )}
          >
            {SIGNAL_LABELS[signal.kind] ?? "Note"}
          </span>
          <span className="text-foreground">{signal.text}</span>
        </li>
      ))}
    </ul>
  );
}
