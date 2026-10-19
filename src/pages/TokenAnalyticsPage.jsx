import { RefreshCw } from "lucide-react";
import { lazy, Suspense, useId, useMemo, useState } from "react";
import {
  fetchGenesisInfo,
  fetchHolderDistribution,
  fetchSpotSymbolMaps,
} from "../api/tokenAnalytics";
import DeferredMount from "../components/DeferredMount";
import MetricCard from "../components/MetricCard";
import { usePollingResource } from "../hooks/usePollingResource";
import { cx } from "../lib/cx";
import { formatCount } from "../lib/formatters";
import {
  DEFAULT_TOKEN_SYMBOL,
  buildDistributionBuckets,
  computeDistributionStats,
  formatTokenAmount,
  listSpotTokens,
  normalizeTokenSymbol,
  parseGenesisBalances,
  parseHolderBalances,
} from "../lib/tokenAnalytics";

const TokenDistributionChart = lazy(() => import("../components/TokenDistributionChart"));

const CHART_HEIGHT = 360;

function routeErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function unsupportedTokenMessage(token) {
  return `Unsupported token ${token}. Only Hyperliquid spot tokens are supported.`;
}

function formatUpdatedAt(unixSeconds) {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(unixSeconds * 1000));
}

// Draft input, the token actually loaded, and the Refresh/submit handler. Until
// the spot symbol maps arrive every symbol is allowed through.
function useTokenSelection(spotTokens) {
  const [draft, setDraft] = useState(DEFAULT_TOKEN_SYMBOL);
  const [token, setToken] = useState(DEFAULT_TOKEN_SYMBOL);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [notice, setNotice] = useState(null);

  const hasTokenList = spotTokens.size > 0;
  const isSupported = !hasTokenList || spotTokens.has(token);

  const submit = (event) => {
    event.preventDefault();
    const nextToken = normalizeTokenSymbol(draft);

    if (!nextToken) {
      return;
    }

    setNotice(null);

    if (hasTokenList && !spotTokens.has(nextToken)) {
      setNotice(unsupportedTokenMessage(nextToken));
      return;
    }

    if (nextToken === token) {
      setRefreshNonce((value) => value + 1);
      return;
    }

    setToken(nextToken);
  };

  return {
    draft,
    setDraft,
    token,
    refreshNonce,
    isSupported,
    notice: notice ?? (isSupported ? null : unsupportedTokenMessage(token)),
    submit,
  };
}

function useTokenResource(kind, selection, request) {
  return usePollingResource(() => request(selection.token), [selection.token, selection.refreshNonce], {
    enabled: selection.isSupported,
    cacheKey: `token-analytics:${kind}:${selection.token}`,
  });
}

function TokenPicker({ selection, listId, busy, label }) {
  return (
    <form className="flex flex-wrap items-center gap-3" onSubmit={selection.submit}>
      <label className="inline-flex h-9 items-center gap-2 rounded-sm border border-border bg-card px-3 text-sm text-muted-foreground">
        <span>Token</span>
        <input
          className="w-24 bg-transparent font-medium text-foreground outline-none"
          value={selection.draft}
          onChange={(event) => selection.setDraft(event.target.value.toUpperCase())}
          list={listId}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label={`${label} token symbol`}
        />
      </label>

      <button
        type="submit"
        className="inline-flex h-9 items-center gap-2 rounded-sm border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-default disabled:opacity-60"
        disabled={busy}
        title={`Refresh ${label.toLowerCase()}`}
      >
        <RefreshCw className={cx("size-4", busy && "qf-spin")} aria-hidden="true" />
        <span>{busy ? "Refreshing…" : "Refresh"}</span>
      </button>
    </form>
  );
}

function ChartLoadingState({ label = "Loading chart…" }) {
  return (
    <div
      className="flex items-center justify-center rounded-sm border border-border/60 bg-card text-sm text-muted-foreground"
      style={{ height: CHART_HEIGHT }}
    >
      {label}
    </div>
  );
}

function DistributionCard({
  title,
  description,
  selection,
  listId,
  resource,
  metrics,
  buckets,
  countLabel,
  cumulativeLabel,
  errorPrefix,
  emptyLabel,
}) {
  const busy = resource.isLoading || resource.isRefreshing;

  let chart;
  if (!selection.isSupported) {
    chart = null;
  } else if (resource.isLoading) {
    chart = <ChartLoadingState label="Loading distribution…" />;
  } else if (!buckets.length) {
    chart = resource.error ? null : <ChartLoadingState label={emptyLabel} />;
  } else {
    chart = (
      <DeferredMount fallback={<ChartLoadingState />}>
        <Suspense fallback={<ChartLoadingState />}>
          <TokenDistributionChart
            buckets={buckets}
            countLabel={countLabel}
            cumulativeLabel={cumulativeLabel}
            height={CHART_HEIGHT}
          />
        </Suspense>
      </DeferredMount>
    );
  }

  return (
    <section className="rounded-sm border border-border bg-card">
      <div className="flex flex-col gap-4 border-b border-border p-6 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-light text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <TokenPicker selection={selection} listId={listId} busy={busy} label={title} />
      </div>

      <div className="space-y-6 p-6">
        {selection.notice ? (
          <div className="rounded-sm border border-border bg-destructive/10 p-4 text-sm text-destructive">
            {selection.notice}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {metrics.map((metric) => (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              loading={resource.isLoading && !resource.data}
            />
          ))}
        </div>

        {resource.error && selection.isSupported ? (
          <div className="rounded-sm border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            {errorPrefix}: {routeErrorMessage(resource.error, "request failed.")}
          </div>
        ) : null}

        {chart}
      </div>
    </section>
  );
}

function GenesisDistributionCard({ spotTokens, listId }) {
  const selection = useTokenSelection(spotTokens);
  const resource = useTokenResource("genesis", selection, fetchGenesisInfo);

  const balances = useMemo(() => parseGenesisBalances(resource.data), [resource.data]);
  const stats = useMemo(() => computeDistributionStats(balances), [balances]);
  const { buckets, scale } = useMemo(() => buildDistributionBuckets(balances), [balances]);

  const description = `Token allocations for ${selection.token}.${
    scale === "log" ? " (Logarithmic X-Axis)" : ""
  } • Hyperliquid spot tokens only`;

  return (
    <DistributionCard
      title="Genesis Distribution"
      description={description}
      selection={selection}
      listId={listId}
      resource={resource}
      metrics={[
        { label: "Recipients", value: stats ? formatCount(stats.count) : "—" },
        { label: "Median", value: stats ? formatTokenAmount(stats.median, selection.token) : "—" },
        { label: "Average", value: stats ? formatTokenAmount(stats.average, selection.token) : "—" },
        {
          label: "Mode",
          value: buckets.length ? (scale === "log" ? "Logarithmic" : "Linear") : "—",
        },
      ]}
      buckets={buckets}
      countLabel="Addresses"
      cumulativeLabel="Cumulative %"
      errorPrefix="Failed to load genesis data"
      emptyLabel="No genesis allocation data available."
    />
  );
}

function HolderDistributionCard({ spotTokens, listId }) {
  const selection = useTokenSelection(spotTokens);
  const resource = useTokenResource("holders", selection, fetchHolderDistribution);

  const balances = useMemo(() => parseHolderBalances(resource.data), [resource.data]);
  const { buckets, scale } = useMemo(() => buildDistributionBuckets(balances), [balances]);
  const thresholds = resource.data?.thresholds;
  const updatedAt = formatUpdatedAt(resource.data?.lastUpdate);

  const description = [
    `Holder concentration for ${selection.token}. ${
      scale === "log" ? "(Logarithmic buckets)" : "(Linear buckets)"
    }`,
    "Hyperliquid spot tokens only",
    updatedAt ? `Updated ${updatedAt}` : null,
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <DistributionCard
      title="Token Holders Distribution"
      description={description}
      selection={selection}
      listId={listId}
      resource={resource}
      metrics={[
        {
          label: "Total holders",
          value: resource.data ? formatCount(resource.data.holderCount) : "—",
        },
        // Each rank card shows the smallest balance inside that rank band.
        { label: "Ranks 1-100", value: formatTokenAmount(thresholds?.top100, selection.token) },
        { label: "Ranks 101-1000", value: formatTokenAmount(thresholds?.top1000, selection.token) },
        { label: "1000+", value: formatTokenAmount(thresholds?.thousandPlus, selection.token) },
      ]}
      buckets={buckets}
      countLabel="Holders"
      cumulativeLabel="Cumulative Supply %"
      errorPrefix="Failed to load holders distribution"
      emptyLabel="No holder distribution data available."
    />
  );
}

export default function TokenAnalyticsPage() {
  const listId = useId();
  const symbolMapsResource = usePollingResource(() => fetchSpotSymbolMaps(), [], {
    cacheKey: "token-analytics:spot-symbol-maps",
    staleTimeMs: 3_600_000,
  });

  const spotTokenList = useMemo(
    () => listSpotTokens(symbolMapsResource.data),
    [symbolMapsResource.data],
  );
  const spotTokens = useMemo(() => new Set(spotTokenList), [spotTokenList]);

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <p className="text-sm text-muted-foreground">
          Supply distribution views for genesis allocations and current holder concentrations.
          Hyperliquid spot tokens only. The rank cards show the smallest balance held within each
          rank band.
        </p>
      </div>

      <datalist id={listId}>
        {spotTokenList.map((token) => (
          <option key={token} value={token} />
        ))}
      </datalist>

      <GenesisDistributionCard spotTokens={spotTokens} listId={listId} />
      <HolderDistributionCard spotTokens={spotTokens} listId={listId} />
    </div>
  );
}
