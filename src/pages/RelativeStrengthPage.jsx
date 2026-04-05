import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { fetchRelativeStrengthUniverse } from "../api/hyperliquid";
import ButtonGroup from "../components/ButtonGroup";
import DeferredMount from "../components/DeferredMount";
import MetricCard from "../components/MetricCard";
import { usePollingResource } from "../hooks/usePollingResource";
import { formatPercent, formatSignedPercent } from "../lib/formatters";
import {
  DEFAULT_RELATIVE_STRENGTH_FOCUS,
  RELATIVE_STRENGTH_UNIVERSE_OPTIONS,
  RELATIVE_STRENGTH_WINDOW_OPTIONS,
  buildRelativeStrengthModel,
  buildRelativeStrengthSnapshot,
  resolveRelativeStrengthFocus,
} from "../lib/relativeStrength";

const RelativeStrengthChart = lazy(() => import("../components/RelativeStrengthChart"));

function metricTone(value) {
  if (!Number.isFinite(value) || value === 0) {
    return "neutral";
  }

  return value > 0 ? "positive" : "negative";
}

function routeErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function formatAssetMove(asset) {
  if (!asset) {
    return "—";
  }

  return `${asset.symbol} ${formatSignedPercent(asset.latestChange)}`;
}

function formatRefreshLabel(asOf) {
  if (!Number.isFinite(asOf)) {
    return "Waiting for market data";
  }

  return `Updated ${new Date(asOf).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function ChartLoadingState({ height = 640 }) {
  return (
    <div
      className="flex items-center justify-center rounded-sm border border-border bg-card p-6 text-sm text-muted-foreground"
      style={{ height }}
    >
      Loading relative-strength chart…
    </div>
  );
}

export default function RelativeStrengthPage() {
  const [chartWindow, setChartWindow] = useState("24h");
  const [universeSize, setUniverseSize] = useState(24);
  const [focusSymbol, setFocusSymbol] = useState(DEFAULT_RELATIVE_STRENGTH_FOCUS);

  const resource = usePollingResource(
    () =>
      fetchRelativeStrengthUniverse({
        chartWindow,
        limit: universeSize,
      }),
    [chartWindow, universeSize],
    {
      intervalMs: 300_000,
      cacheKey: `relative-strength:${chartWindow}:${universeSize}`,
      staleTimeMs: 60_000,
    },
  );

  const model = useMemo(
    () => buildRelativeStrengthModel(resource.data?.assets ?? [], chartWindow),
    [resource.data, chartWindow],
  );

  useEffect(() => {
    const nextFocus = resolveRelativeStrengthFocus(model.assets, focusSymbol);

    if (nextFocus && nextFocus !== focusSymbol) {
      setFocusSymbol(nextFocus);
    }
  }, [focusSymbol, model.assets]);

  const snapshot = useMemo(
    () => buildRelativeStrengthSnapshot(model.assets, focusSymbol),
    [focusSymbol, model.assets],
  );

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm text-muted-foreground">
              Relative performance for the most active Hyperliquid perp markets. Every line is
              rebased to 0% at the start of the selected window so leadership, breadth, and
              laggards stand out immediately.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ButtonGroup
              kind="segmented"
              options={RELATIVE_STRENGTH_WINDOW_OPTIONS}
              value={chartWindow}
              onChange={setChartWindow}
              uppercase
            />
            <ButtonGroup
              kind="pills"
              options={RELATIVE_STRENGTH_UNIVERSE_OPTIONS}
              value={universeSize}
              onChange={setUniverseSize}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Leader"
            value={formatAssetMove(snapshot.leader)}
            tone={metricTone(snapshot.leader?.latestChange)}
            loading={resource.isLoading && !resource.data}
          />
          <MetricCard
            label="Focus"
            value={formatAssetMove(snapshot.focus)}
            tone={metricTone(snapshot.focus?.latestChange)}
            loading={resource.isLoading && !resource.data}
          />
          <MetricCard
            label="Market breadth"
            value={Number.isFinite(snapshot.breadthPercent) ? formatPercent(snapshot.breadthPercent) : "—"}
            tone={metricTone((snapshot.breadthPercent ?? 50) - 50)}
            loading={resource.isLoading && !resource.data}
          />
          <MetricCard
            label="Leader / laggard spread"
            value={Number.isFinite(snapshot.spreadPercent) ? formatPercent(snapshot.spreadPercent) : "—"}
            tone={metricTone(snapshot.spreadPercent)}
            loading={resource.isLoading && !resource.data}
          />
        </div>
      </section>

      {resource.error ? (
        <div className="rounded-sm border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {routeErrorMessage(resource.error, "Unable to load relative-strength data.")}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-light text-foreground">Cross-market strength map</h2>
            <p className="text-sm text-muted-foreground">
              Click a symbol on the left to highlight it. The active line gets a live tag on the
              right edge.
            </p>
          </div>
          <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
            {resource.isRefreshing ? "Refreshing live candles…" : formatRefreshLabel(resource.data?.asOf)}
          </p>
        </div>

        {resource.isLoading && !resource.data ? (
          <div className="rounded-sm border border-border bg-card p-6 text-sm text-muted-foreground">
            Loading relative-strength chart…
          </div>
        ) : null}

        {!resource.isLoading && !resource.error && !model.assets.length ? (
          <div className="rounded-sm border border-border bg-card p-6 text-sm text-muted-foreground">
            No relative-strength data is available right now.
          </div>
        ) : null}

        {!resource.error && model.assets.length ? (
          <DeferredMount fallback={<ChartLoadingState />}>
            <Suspense fallback={<ChartLoadingState />}>
              <RelativeStrengthChart
                data={model.chartData}
                assets={model.assets}
                focusSymbol={focusSymbol}
                onFocusChange={setFocusSymbol}
                domain={model.domain}
              />
            </Suspense>
          </DeferredMount>
        ) : null}
      </section>
    </div>
  );
}
