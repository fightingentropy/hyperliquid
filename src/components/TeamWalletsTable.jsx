import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Link } from "react-router-dom";
import { cx } from "../lib/cx";
import { shortAddress } from "../lib/formatters";
import {
  WALLET_CATEGORIES,
  buildFlowSegments,
  formatShare,
  formatTokenAmount,
  formatUsdValue,
  getWalletCategory,
  sortWalletRows,
} from "../lib/teamDistribution";

const PAGE_SIZE = 25;

const COLUMNS = [
  { key: "wallet", label: "Wallet · member" },
  { key: "flow", label: "Flow", sortable: false },
  { key: "received", label: "Received", numeric: true },
  { key: "kept", label: "Kept", numeric: true },
  { key: "staked", label: "Staked", numeric: true },
  { key: "sent", label: "Sent away", numeric: true },
  { key: "sold", label: "Sold (est.)", numeric: true },
  { key: "value", label: "Value", numeric: true },
  { key: "status", label: "Status" },
  { key: "outShare", label: "Out %", numeric: true },
];

export function FlowBar({ amounts, total, className }) {
  const segments = buildFlowSegments(amounts, total);

  return (
    <div
      className={cx("qf-flow-bar", className)}
      role="img"
      aria-label={`Flow: ${formatTokenAmount(amounts.kept + amounts.staked)} held, ${formatTokenAmount(amounts.sent)} sent, ${formatTokenAmount(amounts.sold)} sold of ${formatTokenAmount(total)}`}
    >
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={`qf-flow-fill--${segment.key}`}
          style={{ flex: `${segment.share * 100} 1 0%` }}
          title={`${segment.label}: ${(segment.share * 100).toFixed(1)}%`}
        />
      ))}
    </div>
  );
}

export function FlowSwatch({ tone, large = false }) {
  return (
    <span
      aria-hidden="true"
      className={cx("qf-flow-swatch", large && "qf-flow-swatch--lg", `qf-flow-fill--${tone}`)}
    />
  );
}

function SortIndicator({ active, direction }) {
  if (!active) {
    return <ArrowUpDown className="size-3 opacity-40" aria-hidden="true" />;
  }

  const Icon = direction === "asc" ? ArrowUp : ArrowDown;
  return <Icon className="size-3" aria-hidden="true" />;
}

function sumRows(rows) {
  return rows.reduce(
    (totals, row) => ({
      received: totals.received + row.received,
      kept: totals.kept + row.kept,
      staked: totals.staked + row.staked,
      sent: totals.sent + row.sent,
      sold: totals.sold + row.sold,
      held: totals.held + row.held,
    }),
    { received: 0, kept: 0, staked: 0, sent: 0, sold: 0, held: 0 },
  );
}

// Every wallet that received part of the selected distribution, filterable by
// what it did with the tokens. Value is the wallet's current holdings at the
// live price.
export default function TeamWalletsTable({ rows, price, loading, error }) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState({ key: "outShare", direction: "desc" });
  const [page, setPage] = useState(0);

  const categoryCounts = useMemo(() => {
    const counts = new Map();
    rows.forEach((row) => counts.set(row.category, (counts.get(row.category) ?? 0) + 1));
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    const visible =
      categoryFilter === "all" ? rows : rows.filter((row) => row.category === categoryFilter);
    return sortWalletRows(visible, sort.key, sort.direction);
  }, [rows, categoryFilter, sort]);

  const totals = useMemo(() => sumRows(filteredRows), [filteredRows]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filteredRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const chips = [
    { key: "all", label: "All", count: rows.length },
    ...WALLET_CATEGORIES.filter((category) => categoryCounts.get(category.key)).map((category) => ({
      key: category.key,
      label: category.label,
      count: categoryCounts.get(category.key),
      description: category.description,
    })),
  ];

  const handleSort = (key) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" },
    );
    setPage(0);
  };

  const emptyMessage = error
    ? "Unable to load team wallets."
    : loading
      ? "Loading wallets…"
      : "No wallets in this view.";

  return (
    <article className="qf-team-wallets rounded-sm border border-border bg-card text-card-foreground">
      <div className="qf-team-wallets__header">
        <div className="flex items-baseline gap-3">
          <h2 className="qf-team-eyebrow">Wallets</h2>
          <span className="qf-team-note">click a column to sort</span>
        </div>
        <span className="qf-team-note tabular-nums">
          {filteredRows.length} of {rows.length} wallets
        </span>
      </div>

      <div className="qf-team-chips">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-pressed={categoryFilter === chip.key}
            title={chip.description}
            className={cx("qf-team-chip", categoryFilter === chip.key && "is-active")}
            onClick={() => {
              setCategoryFilter(chip.key);
              setPage(0);
            }}
          >
            {chip.key === "all" ? null : <FlowSwatch tone={chip.key} />}
            {chip.label}
            <span className="qf-team-chip__count">{chip.count}</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto border-t border-border">
        <table className="qf-team-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={cx(column.numeric && "is-numeric")}
                  aria-sort={
                    sort.key === column.key
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {column.sortable === false ? (
                    column.label
                  ) : (
                    <button type="button" onClick={() => handleSort(column.key)}>
                      {column.label}
                      <SortIndicator active={sort.key === column.key} direction={sort.direction} />
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const category = getWalletCategory(row.category);

              return (
                <tr key={row.id}>
                  <td>
                    <Link
                      to={`/app/wallets/${row.address}`}
                      className="qf-team-table__wallet"
                      title={row.address}
                    >
                      {shortAddress(row.address)}
                    </Link>
                    {row.label ? <span className="qf-team-table__member">{row.label}</span> : null}
                  </td>
                  <td>
                    <FlowBar amounts={row} total={row.received} className="qf-flow-bar--row" />
                  </td>
                  <td className="is-numeric">{formatTokenAmount(row.received)}</td>
                  <td className="is-numeric">{formatTokenAmount(row.kept)}</td>
                  <td className="is-numeric">{formatTokenAmount(row.staked)}</td>
                  <td className="is-numeric">{formatTokenAmount(row.sent)}</td>
                  <td className="is-numeric">{formatTokenAmount(row.sold)}</td>
                  <td className="is-numeric">{formatUsdValue(row.held * price)}</td>
                  <td title={category?.description}>
                    <span className="inline-flex items-center gap-1.5">
                      <FlowSwatch tone={row.category} />
                      {category?.label}
                    </span>
                  </td>
                  <td className="is-numeric">{formatShare(row.outShare)}</td>
                </tr>
              );
            })}
          </tbody>
          {filteredRows.length ? (
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td className="is-numeric">{formatTokenAmount(totals.received)}</td>
                <td className="is-numeric">{formatTokenAmount(totals.kept)}</td>
                <td className="is-numeric">{formatTokenAmount(totals.staked)}</td>
                <td className="is-numeric">{formatTokenAmount(totals.sent)}</td>
                <td className="is-numeric">{formatTokenAmount(totals.sold)}</td>
                <td className="is-numeric">{formatUsdValue(totals.held * price)}</td>
                <td />
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>

        {!filteredRows.length ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</div>
        ) : null}
      </div>

      {pageCount > 1 ? (
        <div className="qf-team-pager">
          <span className="tabular-nums">
            Page {currentPage + 1} / {pageCount}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Prev
            </button>
            <button
              type="button"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <p className="qf-team-footnote">
        Sold (est.) is an estimate: what was received minus what was sent away, staked and kept.
        Sales aren’t visible directly. Sent away includes transfers between team wallets.
      </p>
    </article>
  );
}
