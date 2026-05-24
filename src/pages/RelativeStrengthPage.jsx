import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { fetchRelativeStrengthMarkets, fetchRelativeStrengthUniverse } from "../api/hyperliquid";
import ButtonGroup from "../components/ButtonGroup";
import DeferredMount from "../components/DeferredMount";
import MetricCard from "../components/MetricCard";
import RelativeStrengthConfigModal from "../components/RelativeStrengthConfigModal";
import { usePollingResource } from "../hooks/usePollingResource";
import { formatPercent, formatSignedPercent } from "../lib/formatters";
import {
  DEFAULT_RELATIVE_STRENGTH_FOCUS,
  DEFAULT_RELATIVE_STRENGTH_SCOPE,
  DEFAULT_RELATIVE_STRENGTH_UNIVERSE_SIZE,
  DEFAULT_RELATIVE_STRENGTH_WINDOW,
  RELATIVE_STRENGTH_MARKET_OPTIONS,
  RELATIVE_STRENGTH_UNIVERSE_OPTIONS,
  RELATIVE_STRENGTH_WINDOW_OPTIONS,
  buildRelativeStrengthModel,
  buildRelativeStrengthSnapshot,
  resolveRelativeStrengthFocus,
} from "../lib/relativeStrength";

const RelativeStrengthChart = lazy(() => import("../components/RelativeStrengthChart"));
const RELATIVE_STRENGTH_MODEL_STORAGE_KEY = "hl-stats.relativeStrengthModel.v1";

function uniqueSymbols(symbols) {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => String(symbol ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function optionValueExists(options, value) {
  return options.some((option) => option.value === value);
}

function readStoredRelativeStrengthModel() {
  const fallback = {
    chartWindow: DEFAULT_RELATIVE_STRENGTH_WINDOW,
    marketScope: DEFAULT_RELATIVE_STRENGTH_SCOPE,
    universeSize: DEFAULT_RELATIVE_STRENGTH_UNIVERSE_SIZE,
    benchmarkSymbol: DEFAULT_RELATIVE_STRENGTH_FOCUS,
    selectedSymbols: null,
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(RELATIVE_STRENGTH_MODEL_STORAGE_KEY));

    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }

    return {
      chartWindow: optionValueExists(RELATIVE_STRENGTH_WINDOW_OPTIONS, parsed.chartWindow)
        ? parsed.chartWindow
        : fallback.chartWindow,
      marketScope: optionValueExists(RELATIVE_STRENGTH_MARKET_OPTIONS, parsed.marketScope)
        ? parsed.marketScope
        : fallback.marketScope,
      universeSize: optionValueExists(RELATIVE_STRENGTH_UNIVERSE_OPTIONS, parsed.universeSize)
        ? parsed.universeSize
        : fallback.universeSize,
      benchmarkSymbol: String(parsed.benchmarkSymbol ?? fallback.benchmarkSymbol).toUpperCase(),
      selectedSymbols: Array.isArray(parsed.selectedSymbols)
        ? uniqueSymbols(parsed.selectedSymbols)
        : fallback.selectedSymbols,
    };
  } catch {
    return fallback;
  }
}

function writeStoredRelativeStrengthModel(model) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(RELATIVE_STRENGTH_MODEL_STORAGE_KEY, JSON.stringify(model));
}

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
  const [initialModel] = useState(readStoredRelativeStrengthModel);
  const [chartWindow, setChartWindow] = useState(initialModel.chartWindow);
  const [marketScope, setMarketScope] = useState(initialModel.marketScope);
  const [universeSize, setUniverseSize] = useState(initialModel.universeSize);
  const [benchmarkSymbol, setBenchmarkSymbol] = useState(initialModel.benchmarkSymbol);
  const [selectedSymbols, setSelectedSymbols] = useState(initialModel.selectedSymbols);
  const [modelOpen, setModelOpen] = useState(false);
  const selectedSymbolsKey = selectedSymbols?.length ? selectedSymbols.join(",") : "auto";

  const resource = usePollingResource(
    () =>
      fetchRelativeStrengthUniverse({
        chartWindow,
        limit: universeSize,
        marketScope,
        benchmarkSymbol,
        includedSymbols: selectedSymbols,
      }),
    [chartWindow, marketScope, universeSize, benchmarkSymbol, selectedSymbolsKey],
    {
      intervalMs: 300_000,
      cacheKey: `relative-strength:${chartWindow}:${marketScope}:${universeSize}:${benchmarkSymbol}:${selectedSymbolsKey}`,
      staleTimeMs: 60_000,
    },
  );
  const marketsResource = usePollingResource(
    () => fetchRelativeStrengthMarkets({ marketScope: "combined" }),
    [],
    {
      intervalMs: 300_000,
      cacheKey: "relative-strength:markets:combined",
      staleTimeMs: 300_000,
    },
  );

  const model = useMemo(
    () => buildRelativeStrengthModel(resource.data?.assets ?? [], chartWindow),
    [resource.data, chartWindow],
  );

  useEffect(() => {
    const nextFocus = resolveRelativeStrengthFocus(model.assets, benchmarkSymbol);

    if (nextFocus && nextFocus !== benchmarkSymbol) {
      setBenchmarkSymbol(nextFocus);
    }
  }, [benchmarkSymbol, model.assets]);

  useEffect(() => {
    writeStoredRelativeStrengthModel({
      chartWindow,
      marketScope,
      universeSize,
      benchmarkSymbol,
      selectedSymbols,
    });
  }, [benchmarkSymbol, chartWindow, marketScope, selectedSymbols, universeSize]);

  const snapshot = useMemo(
    () => buildRelativeStrengthSnapshot(model.assets, benchmarkSymbol),
    [benchmarkSymbol, model.assets],
  );
  const activeSymbols = useMemo(
    () => uniqueSymbols(model.assets.map((asset) => asset.symbol)),
    [model.assets],
  );
  const availableMarkets = marketsResource.data?.markets ?? resource.data?.markets ?? [];
  const customModelActive = Boolean(selectedSymbols?.length);

  const handleMarketScopeChange = (nextScope) => {
    setMarketScope(nextScope);
    setSelectedSymbols(null);
  };

  const handleApplyModel = (nextModel) => {
    setMarketScope(nextModel.marketScope);
    setBenchmarkSymbol(nextModel.benchmarkSymbol);
    setSelectedSymbols(nextModel.selectedSymbols?.length ? nextModel.selectedSymbols : null);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm text-muted-foreground">
              Relative performance for the most active Hyperliquid perp markets and XYZ Markets
              HIP-3 TradFi perps. Every line is rebased to 0% at the start of the selected window
              so leadership, breadth, and laggards stand out immediately.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ButtonGroup
              kind="segmented"
              options={RELATIVE_STRENGTH_MARKET_OPTIONS}
              value={marketScope}
              onChange={handleMarketScopeChange}
              size="sm"
            />
            <ButtonGroup
              kind="segmented"
              options={RELATIVE_STRENGTH_WINDOW_OPTIONS}
              value={chartWindow}
              onChange={setChartWindow}
              uppercase
            />
            {customModelActive ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-sm bg-muted px-3 py-1.5 text-xs font-medium text-foreground">
                  Custom {selectedSymbols.length} assets
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSymbols(null)}
                  className="rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
                >
                  Auto
                </button>
              </div>
            ) : (
              <ButtonGroup
                kind="pills"
                options={RELATIVE_STRENGTH_UNIVERSE_OPTIONS}
                value={universeSize}
                onChange={setUniverseSize}
              />
            )}
            <button
              type="button"
              onClick={() => setModelOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-sm border border-border px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
            >
              <SlidersHorizontal className="size-4" />
              Model
            </button>
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
            label="Benchmark"
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
              Click a symbol on the left to set the benchmark. The active line gets a live tag on the
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
                focusSymbol={benchmarkSymbol}
                onFocusChange={setBenchmarkSymbol}
                domain={model.domain}
              />
            </Suspense>
          </DeferredMount>
        ) : null}
      </section>

      <RelativeStrengthConfigModal
        open={modelOpen}
        markets={availableMarkets}
        marketScope={marketScope}
        benchmarkSymbol={benchmarkSymbol}
        selectedSymbols={selectedSymbols}
        activeSymbols={activeSymbols}
        onApply={handleApplyModel}
        onClose={() => setModelOpen(false)}
        isLoading={marketsResource.isLoading && !marketsResource.data}
      />
    </div>
  );
}
