import { ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAllMids, fetchValidatorSummaries } from "../api/hyperliquid";
import { fetchGlobalAliases, fetchUnstakingQueue } from "../api/hypurrscan";
import ButtonGroup from "../components/ButtonGroup";
import UnstakingChart from "../components/UnstakingChart";
import { usePollingResource } from "../hooks/usePollingResource";
import { useWallets } from "../hooks/useWallets";
import { cx } from "../lib/cx";
import { formatCompactCurrency, formatCurrency, shortAddress } from "../lib/formatters";
import {
  UNSTAKING_SORTS,
  UNSTAKING_VIEWS,
  UNSTAKING_WINDOWS,
  bucketUnstakingByHour,
  buildWalletNames,
  formatUnstakingDuration,
  normalizeValidatorNames,
  selectUnstakingRows,
  summarizeUnstakingQueue,
} from "../lib/unstaking";
import { resolveHypeMid } from "../lib/wallet";

const QUEUE_POLL_MS = 60_000;
const PRICE_POLL_MS = 60_000;
const ALIASES_STALE_MS = 60 * 60_000;
const PAGE_SIZE = 100;
const CHART_HEIGHT = 280;
const HYPURRSCAN_UNSTAKING_URL = "https://hypurrscan.io/staking#unstaking";

const hypeFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const smallHypeFormatter = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });
const compactHypeFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

function formatHype(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return value > 0 && value < 1 ? smallHypeFormatter.format(value) : hypeFormatter.format(value);
}

function formatCompactHype(value) {
  return Number.isFinite(value) ? compactHypeFormatter.format(value) : "—";
}

function formatDay(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatClock(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

// One card per direction: HYPE unlocking in the next 1h/24h/7d, or HYPE that
// unlocked in the past 1h/24h/7d, with its value at the current HYPE price.
function WindowTotalsCard({ title, caption, prefix, totals, price, loading }) {
  return (
    <article className="rounded-sm border border-border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-light uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {caption ? <span className="text-xs text-muted-foreground">{caption}</span> : null}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        {UNSTAKING_WINDOWS.map((span) => {
          const amount = totals?.[span.key];
          const value = Number.isFinite(price) && Number.isFinite(amount) ? amount * price : null;

          return (
            <div key={span.key} className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {prefix} {span.label}
              </p>
              <p
                className="truncate text-xl font-light tabular-nums text-foreground"
                title={loading ? undefined : `${formatHype(amount)} HYPE`}
              >
                {loading ? "…" : formatCompactHype(amount)}
              </p>
              <p className="truncate text-xs tabular-nums text-muted-foreground">
                {loading || value === null ? " " : formatCompactCurrency(value)}
              </p>
            </div>
          );
        })}
      </div>
    </article>
  );
}

// On phones the date line and value column drop out and cells pad less, so the
// countdown, wallet and HYPE amount fit without scrolling sideways.
function QueueRow({ row, now, wallet, price, isPast }) {
  const gap = formatUnstakingDuration(row.time - now);

  return (
    <tr className="border-b border-border/60 last:border-b-0">
      <td
        className="whitespace-nowrap px-3 py-2.5 sm:px-4"
        title={new Date(row.time).toLocaleString()}
      >
        <span className="block font-mono tabular-nums text-foreground">
          {isPast ? `${gap} ago` : gap}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:block">{formatDay(row.time)}</span>
      </td>
      <td className="px-3 py-2.5 sm:px-4">
        <Link
          to={`/wallets/${row.user}`}
          className="qf-quiet-link qf-unstaking-wallet block"
          title={wallet ? `${wallet.name} · ${row.user}` : row.user}
        >
          {wallet ? (
            <span className="block truncate text-foreground">{wallet.name}</span>
          ) : null}
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {shortAddress(row.user)}
            {wallet?.isValidator ? " · validator" : ""}
          </span>
        </Link>
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground sm:px-4">
        {formatHype(row.amount)}
      </td>
      <td className="hidden px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
        {Number.isFinite(price) ? formatCurrency(row.amount * price) : "—"}
      </td>
    </tr>
  );
}

export default function UnstakingPage() {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [view, setView] = useState("upcoming");
  const [sort, setSort] = useState("time");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { wallets } = useWallets();

  const queue = usePollingResource(fetchUnstakingQueue, [refreshNonce], {
    intervalMs: QUEUE_POLL_MS,
    cacheKey: `unstaking-queue:${refreshNonce}`,
    staleTimeMs: 0,
  });

  const priceResource = usePollingResource(async () => resolveHypeMid(await fetchAllMids()), [], {
    intervalMs: PRICE_POLL_MS,
    cacheKey: "unstaking:hype-mid",
    staleTimeMs: 30_000,
  });

  // Names are optional: if either lookup fails, rows fall back to addresses.
  const aliases = usePollingResource(fetchGlobalAliases, [], {
    cacheKey: "hypurrscan:global-aliases",
    staleTimeMs: ALIASES_STALE_MS,
  });

  const validators = usePollingResource(
    async () => normalizeValidatorNames(await fetchValidatorSummaries()),
    [],
    { cacheKey: "unstaking:validator-names", staleTimeMs: ALIASES_STALE_MS },
  );

  // Re-tick once a second so countdowns run and releases move from upcoming
  // to released as their unlock time passes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const entries = queue.data?.entries ?? null;
  const price = Number.isFinite(priceResource.data) ? priceResource.data : null;
  const loading = queue.isLoading && !entries;
  const busy = queue.isLoading || queue.isRefreshing;
  const isPast = view === "past";

  const names = useMemo(
    () =>
      buildWalletNames({ aliases: aliases.data, validators: validators.data, savedWallets: wallets }),
    [aliases.data, validators.data, wallets],
  );
  const summary = useMemo(() => summarizeUnstakingQueue(entries, now), [entries, now]);
  const rows = useMemo(
    () => selectUnstakingRows(entries, now, { view, sort }),
    [entries, now, view, sort],
  );
  const visibleRows = rows.slice(0, limit);

  // The chart moves on the minute, not every countdown tick.
  const chartNow = Math.floor(now / 60_000) * 60_000;
  const buckets = useMemo(
    () => bucketUnstakingByHour(entries, chartNow, { view }),
    [entries, chartNow, view],
  );
  const peakBucket = buckets.reduce(
    (peak, bucket) => (bucket.amount > (peak?.amount ?? 0) ? bucket : peak),
    null,
  );
  const oldestTime = entries?.length ? entries[0].time : null;

  const upcomingCaption = entries
    ? `${summary.pendingCount.toLocaleString()} pending · ${summary.pendingWalletCount.toLocaleString()} wallets`
    : null;

  const tableCaption = !entries
    ? loading
      ? "Loading…"
      : null
    : isPast
      ? `${rows.length.toLocaleString()} released${oldestTime ? ` since ${formatDay(oldestTime)}` : ""}`
      : `${rows.length.toLocaleString()} pending · ${formatHype(summary.pendingAmount)} HYPE`;

  const changeView = (nextView) => {
    setView(nextView);
    setLimit(PAGE_SIZE);
  };

  const changeSort = (nextSort) => {
    setSort(nextSort);
    setLimit(PAGE_SIZE);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl space-y-1">
            <p className="text-sm text-muted-foreground">
              HYPE leaving staking. Once a wallet withdraws from staking, its HYPE waits 7 days
              before it reaches the wallet&apos;s spot balance. This lists every pending release on
              Hyperliquid, read from HypurrScan.
            </p>
            <p className="text-xs text-muted-foreground">
              Source: HypurrScan · updated {formatClock(queue.data?.fetchedAt)}
              {price !== null ? ` · HYPE ${formatCurrency(price, 2)}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              onClick={() => setRefreshNonce((value) => value + 1)}
              disabled={busy}
              title="Refresh unstaking queue"
              aria-label="Refresh unstaking queue"
            >
              <RefreshCw className={cx("size-4", busy && "qf-spin")} aria-hidden="true" />
            </button>

            <a
              href={HYPURRSCAN_UNSTAKING_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              title="Open on HypurrScan"
              aria-label="Open on HypurrScan"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <WindowTotalsCard
            title="Unlocking (HYPE)"
            caption={upcomingCaption}
            prefix="Next"
            totals={summary.upcoming}
            price={price}
            loading={loading}
          />
          <WindowTotalsCard
            title="Released (HYPE)"
            prefix="Past"
            totals={summary.past}
            price={price}
            loading={loading}
          />
        </div>
      </section>

      {queue.error ? (
        <div className="rounded-sm border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {errorMessage(queue.error, "Unable to load the unstaking queue.")}
        </div>
      ) : null}

      {/* The view switch scopes both the chart and the table below it. */}
      <div className="flex">
        <ButtonGroup
          kind="segmented"
          size="sm"
          options={UNSTAKING_VIEWS}
          value={view}
          onChange={changeView}
        />
      </div>

      <section className="rounded-sm border border-border bg-card text-card-foreground">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-4">
          <h2 className="text-xs font-light uppercase tracking-wide text-muted-foreground">
            {isPast ? "Released per hour" : "Unlocks per hour"}
          </h2>
          <span className="text-xs text-muted-foreground">
            HYPE · {isPast ? "past 7 days" : "next 7 days"}
            {peakBucket
              ? ` · peak ${formatCompactHype(peakBucket.amount)} at ${formatDay(peakBucket.start)}`
              : ""}
          </span>
        </div>

        <div className="border-t border-border px-2 py-4 sm:px-4">
          {entries ? (
            <UnstakingChart
              buckets={buckets}
              price={price}
              height={CHART_HEIGHT}
              label={`HYPE ${isPast ? "released" : "unlocking"} per hour over the ${isPast ? "past" : "next"} 7 days`}
            />
          ) : (
            <div
              className="flex items-center justify-center text-sm text-muted-foreground"
              style={{ height: CHART_HEIGHT }}
            >
              {loading ? "Loading chart…" : "Unable to load the unstaking queue."}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-sm border border-border bg-card text-card-foreground">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-xs font-light uppercase tracking-wide text-muted-foreground">
              Unstaking queue
            </h2>
            {tableCaption ? (
              <span className="text-xs text-muted-foreground">{tableCaption}</span>
            ) : null}
          </div>

          <ButtonGroup
            kind="segmented"
            size="sm"
            options={UNSTAKING_SORTS[view]}
            value={sort}
            onChange={changeSort}
          />
        </div>

        <div className="max-h-[620px] overflow-auto border-t border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-3 font-medium sm:px-4">
                  {isPast ? "Released" : "Unlocks in"}
                </th>
                <th className="px-3 py-3 font-medium sm:px-4">Wallet</th>
                <th className="px-3 py-3 text-right font-medium sm:px-4">HYPE</th>
                <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Value</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <QueueRow
                  key={`${row.time}-${row.user}-${index}`}
                  row={row}
                  now={now}
                  wallet={names.get(row.user)}
                  price={price}
                  isPast={isPast}
                />
              ))}
            </tbody>
          </table>

          {!visibleRows.length ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {loading
                ? "Loading unstaking queue…"
                : !entries
                  ? "Unable to load the unstaking queue."
                  : isPast
                    ? "No recent releases."
                    : "Nothing is unstaking right now."}
            </div>
          ) : null}

          {rows.length > visibleRows.length ? (
            <div className="border-t border-border px-5 py-3 text-center">
              <button
                type="button"
                className="rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                onClick={() => setLimit((value) => value + PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, rows.length - visibleRows.length)} more of{" "}
                {(rows.length - visibleRows.length).toLocaleString()}
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
