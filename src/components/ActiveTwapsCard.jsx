import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Link } from "react-router-dom";
import { cx } from "../lib/cx";
import { formatCurrency, shortAddress } from "../lib/formatters";
import { twapRemainingFraction } from "../lib/hypurrscan";
import ButtonGroup from "./ButtonGroup";
import TokenMark from "./TokenMark";

// Same market separation hypurrscan's Active TWAPs table ships: primary
// perps, spot pairs, and HIP-3 builder-dex markets (xyz:SP500 and friends).
const SEGMENT_OPTIONS = [
  { value: "all", label: "All" },
  { value: "spot", label: "Spot" },
  { value: "perp", label: "Perps" },
  { value: "hip3", label: "HIP-3" },
];

function formatAmount(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function TwapRow({ row }) {
  return (
    <tr className="border-b border-border/60 last:border-b-0">
      <td className="px-4 py-2.5">
        <span
          className={cx(
            "inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            row.isBuy ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss",
          )}
        >
          {row.isBuy ? "BUY" : "SELL"}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-foreground">
        {row.remainingValue === null ? "—" : formatCurrency(row.remainingValue, 2)}
      </td>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2">
          <TokenMark coin={row.iconCoin || row.token} />
          <span className="font-medium text-foreground">{row.token}</span>
        </span>
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatAmount(row.amount)}</td>
      <td className="px-4 py-2.5 text-right">
        <Link
          to={`/app/wallets/${row.user}`}
          className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          title={row.user}
        >
          {shortAddress(row.user)}
        </Link>
      </td>
    </tr>
  );
}

// The Active TWAPs table from hypurrscan.io/dashboard: every running TWAP
// order network-wide, separated by market segment. The value column shows the
// notional still left to execute and counts down as orders fill.
export default function ActiveTwapsCard({ rows, loading, error }) {
  const [segment, setSegment] = useState("all");
  const [sortDirection, setSortDirection] = useState("desc");

  // Re-tick once a second so remaining values count down live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const hasData = Array.isArray(rows);

  const visibleRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;

    return (rows ?? [])
      .filter((row) => segment === "all" || row.segment === segment)
      .map((row) => ({
        ...row,
        remainingValue: row.value === null ? null : row.value * twapRemainingFraction(row, now),
      }))
      .sort((left, right) => {
        // Rows without a price sink to the bottom either way.
        if (left.remainingValue === null || right.remainingValue === null) {
          return (left.remainingValue === null) - (right.remainingValue === null);
        }

        return (left.remainingValue - right.remainingValue) * direction;
      });
  }, [rows, segment, sortDirection, now]);

  const caption = error
    ? "Unable to load TWAP data."
    : !hasData && loading
      ? "Loading active orders…"
      : `${visibleRows.length} active TWAP${visibleRows.length === 1 ? "" : "s"}`;

  const SortIcon = sortDirection === "asc" ? ArrowUp : ArrowDown;

  return (
    <article className="flex h-full flex-col rounded-sm border border-border bg-card text-card-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xs font-light uppercase tracking-wide text-muted-foreground">
            Active TWAPs
          </h2>
          <span className="text-xs text-muted-foreground">{caption}</span>
        </div>

        <ButtonGroup
          kind="segmented"
          size="sm"
          options={SEGMENT_OPTIONS}
          value={segment}
          onChange={setSegment}
        />
      </div>

      <div className="max-h-[520px] flex-1 overflow-y-auto border-t border-border">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-3 font-medium">Side</th>
              <th className="px-4 py-3 text-right font-medium">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground"
                  onClick={() =>
                    setSortDirection((current) => (current === "desc" ? "asc" : "desc"))
                  }
                >
                  <SortIcon className="size-3" aria-hidden="true" />
                  Value
                </button>
              </th>
              <th className="px-4 py-3 font-medium">Token</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">From</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <TwapRow key={row.hash} row={row} />
            ))}
          </tbody>
        </table>

        {!visibleRows.length ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            {error && !hasData
              ? "Unable to load TWAP data."
              : loading && !hasData
                ? "Loading active orders…"
                : "No active TWAPs for this market filter."}
          </div>
        ) : null}
      </div>
    </article>
  );
}
