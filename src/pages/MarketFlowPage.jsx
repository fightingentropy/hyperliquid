import { lazy, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchHourlyCandles } from "../api/hyperliquid";
import { fetchMarketFlowBatch, fetchMarketFlowSummaries } from "../api/marketFlow";
import ButtonGroup from "../components/ButtonGroup";
import DeferredMount from "../components/DeferredMount";
import MetricCard from "../components/MetricCard";
import ParticipantListCard from "../components/ParticipantListCard";
import { usePollingResource } from "../hooks/usePollingResource";
import {
  ASSET_OPTIONS,
  CHART_WINDOWS,
  HYPE_MARKET_OPTIONS,
  PARTICIPANT_WINDOWS,
  TOP_LIMITS,
  buildCumulativeSeries,
  buildHypeComparisonSeries,
  buildIntervalSeries,
  buildMarketFlowSearchParams,
  formatParticipantWindowLabel,
  getSelectedMarket,
  parseMarketFlowState,
} from "../lib/marketFlow";
import { formatSignedCurrency } from "../lib/formatters";

const MarketFlowChart = lazy(() => import("../components/MarketFlowChart"));

function metricTone(value) {
  if (!Number.isFinite(value) || value === 0) {
    return "neutral";
  }

  return value > 0 ? "positive" : "negative";
}

function routeErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function ChartLoadingState({ height = 360 }) {
  return (
    <div
      className="flex items-center justify-center rounded-sm border border-border/60 bg-card text-sm text-muted-foreground"
      style={{ height }}
    >
      Loading chart...
    </div>
  );
}

export default function MarketFlowPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseMarketFlowState(searchParams), [searchParams]);
  const selectedMarket = useMemo(() => getSelectedMarket(state), [state]);

  const [seriesVisibility, setSeriesVisibility] = useState({
    primary: true,
    perp: true,
    spot: true,
    price: true,
  });

  const updateState = (patch) => {
    const nextState = { ...state, ...patch };
    const nextParams = buildMarketFlowSearchParams(nextState);
    setSearchParams(nextParams, { replace: true });
  };

  const batchResource = usePollingResource(
    () =>
      fetchMarketFlowBatch({
        marketId: selectedMarket.marketId,
        chartWindow: state.chartWindow,
        participantsWindow: state.participantWindow,
        limit: state.topLimit,
      }),
    [selectedMarket.marketId, state.chartWindow, state.participantWindow, state.topLimit],
    {
      intervalMs: 60_000,
      cacheKey: `market-flow:batch:${selectedMarket.marketId}:${state.chartWindow}:${state.participantWindow}:${state.topLimit}`,
      staleTimeMs: 30_000,
    },
  );

  const candlesResource = usePollingResource(
    () =>
      fetchHourlyCandles({
        coin: selectedMarket.candleCoin,
        chartWindow: state.chartWindow,
      }),
    [selectedMarket.candleCoin, state.chartWindow],
    {
      intervalMs: 600_000,
      initialData: [],
      cacheKey: `market-flow:candles:${selectedMarket.candleCoin}:${state.chartWindow}`,
      staleTimeMs: 60_000,
    },
  );

  const hypeSummariesResource = usePollingResource(
    () =>
      fetchMarketFlowSummaries({
        marketIds: ["HYPE-PERP", "HYPE-SPOT"],
        window: state.chartWindow,
      }),
    [state.chartWindow],
    {
      enabled: state.asset === "HYPE" && state.chartMode === "cumulative",
      intervalMs: 60_000,
      initialData: null,
      cacheKey: `market-flow:summaries:${state.chartWindow}`,
      staleTimeMs: 30_000,
    },
  );

  const batchData = batchResource.data;
  const summary = batchData?.summary ?? null;
  const deltas = summary?.deltas ?? null;
  const selectedDelta = deltas?.[state.participantWindow] ?? null;
  const labels = batchData?.labels ?? {};

  const intervalSeries = useMemo(
    () => buildIntervalSeries(summary, state.chartWindow, candlesResource.data),
    [summary, state.chartWindow, candlesResource.data],
  );

  const cumulativeSeries = useMemo(() => buildCumulativeSeries(intervalSeries), [intervalSeries]);

  const hypeComparisonSeries = useMemo(
    () =>
      buildHypeComparisonSeries(hypeSummariesResource.data?.summaries, state.chartWindow, candlesResource.data),
    [hypeSummariesResource.data, state.chartWindow, candlesResource.data],
  );

  const chartVariant =
    state.chartMode === "interval"
      ? "interval"
      : state.asset === "HYPE"
        ? "hype-comparison"
        : "cumulative";

  const chartData =
    chartVariant === "interval"
      ? intervalSeries
      : chartVariant === "hype-comparison"
        ? hypeComparisonSeries
        : cumulativeSeries;

  const chartTitle =
    state.chartMode === "cumulative"
      ? `Cumulative net flow (${state.chartWindow === "30d" ? "4h" : "hour"} buckets, last ${state.chartWindow})`
      : `Net flow per ${state.chartWindow === "30d" ? "4h" : "hour"} (last ${state.chartWindow})`;

  const chartError =
    chartVariant === "hype-comparison"
      ? hypeSummariesResource.error
      : batchResource.error || candlesResource.error;

  const chartLoading =
    batchResource.isLoading ||
    candlesResource.isLoading ||
    (chartVariant === "hype-comparison" && hypeSummariesResource.isLoading);

  const participantTitle =
    state.participantsView === "total" ? "Participant total volume" : "Participant net flow";

  const participantDescription =
    state.participantsView === "total"
      ? "Sum of buys and sells over the selected window."
      : "Aggregated buys minus sells (includes passive + aggressive trades).";

  const participantWindowOptions = PARTICIPANT_WINDOWS.map((window) => ({
    value: window,
    label: formatParticipantWindowLabel(window),
  }));

  const topLimitOptions = TOP_LIMITS.map((limit) => ({
    value: limit,
    label: `Top ${limit}`,
  }));

  const handleLegendClick = (entry) => {
    if (entry?.dataKey === "cumNetUsd") {
      setSeriesVisibility((current) => ({ ...current, primary: !current.primary }));
    }

    if (entry?.dataKey === "cumPerpUsd") {
      setSeriesVisibility((current) => ({ ...current, perp: !current.perp }));
    }

    if (entry?.dataKey === "cumSpotUsd") {
      setSeriesVisibility((current) => ({ ...current, spot: !current.spot }));
    }

    if (entry?.dataKey === "closePrice") {
      setSeriesVisibility((current) => ({ ...current, price: !current.price }));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Participant market flow from Hyperliquid trade data: buy vs sell pressure across HYPE
          spot & perps, plus a curated set of perps and index markets.
        </p>

        <ButtonGroup
          className="mt-4"
          kind="underline"
          options={ASSET_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          value={state.asset}
          onChange={(asset) =>
            updateState({
              asset,
              chartMode: "interval",
            })
          }
          uppercase
        />

        {state.asset === "HYPE" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ButtonGroup
              kind="segmented"
              options={HYPE_MARKET_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={state.hypeMarketId}
              onChange={(hypeMarketId) => updateState({ hypeMarketId })}
            />

            {state.chartMode === "cumulative" ? (
              <p className="text-xs text-muted-foreground">
                Cumulative view always shows both Perp + Spot. Selection affects participant
                tables below.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {batchResource.error ? (
        <div className="rounded-sm border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {routeErrorMessage(batchResource.error, "Unable to load market-flow data.")}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Net delta 1h"
          value={deltas ? formatSignedCurrency(Math.round(deltas["1h"].netUsd)) : "—"}
          tone={metricTone(deltas?.["1h"]?.netUsd)}
          loading={batchResource.isLoading && !summary}
        />
        <MetricCard
          label="Net delta 4h"
          value={deltas ? formatSignedCurrency(Math.round(deltas["4h"].netUsd)) : "—"}
          tone={metricTone(deltas?.["4h"]?.netUsd)}
          loading={batchResource.isLoading && !summary}
        />
        <MetricCard
          label="Net delta 1D"
          value={deltas ? formatSignedCurrency(Math.round(deltas["24h"].netUsd)) : "—"}
          tone={metricTone(deltas?.["24h"]?.netUsd)}
          loading={batchResource.isLoading && !summary}
        />
        <MetricCard
          label="Net delta 7d"
          value={deltas ? formatSignedCurrency(Math.round(deltas["7d"].netUsd)) : "—"}
          tone={metricTone(deltas?.["7d"]?.netUsd)}
          loading={batchResource.isLoading && !summary}
        />
        <MetricCard
          label="Net delta 30d"
          value={deltas ? formatSignedCurrency(Math.round(deltas["30d"].netUsd)) : "—"}
          tone={metricTone(deltas?.["30d"]?.netUsd)}
          loading={batchResource.isLoading && !summary}
        />
      </section>

      <section className="rounded-sm border border-border bg-card">
        <div className="p-6 pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-light text-foreground">{chartTitle}</h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ButtonGroup
                kind="segmented"
                size="sm"
                options={[
                  { value: "interval", label: "Interval" },
                  { value: "cumulative", label: "Cumulative" },
                ]}
                value={state.chartMode}
                onChange={(chartMode) => updateState({ chartMode })}
              />

              <ButtonGroup
                kind="pills"
                options={CHART_WINDOWS.map((window) => ({
                  value: window,
                  label: window.toUpperCase(),
                }))}
                value={state.chartWindow}
                onChange={(chartWindow) => updateState({ chartWindow })}
                uppercase
              />
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 pt-4">
          {chartLoading ? <div className="text-sm text-muted-foreground">Loading chart…</div> : null}
          {chartError && !chartLoading ? (
            <div className="rounded-sm border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              {routeErrorMessage(
                chartError,
                chartVariant === "hype-comparison"
                  ? "Unable to load HYPE spot/perp chart data."
                  : "Unable to load chart data.",
              )}
            </div>
          ) : null}
          {!chartLoading && !chartError && !chartData.length ? (
            <div className="text-sm text-muted-foreground">No chart data is available.</div>
          ) : null}
          {!chartLoading && !chartError && chartData.length ? (
            <DeferredMount fallback={<ChartLoadingState />}>
              <Suspense fallback={<ChartLoadingState />}>
                <MarketFlowChart
                  data={chartData}
                  chartWindow={state.chartWindow}
                  mode={chartVariant}
                  assetLabel={selectedMarket.assetLabel}
                  seriesVisibility={seriesVisibility}
                  onLegendClick={handleLegendClick}
                />
              </Suspense>
            </DeferredMount>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-light text-foreground">{participantTitle}</h2>
            <p className="text-sm text-muted-foreground">{participantDescription}</p>
            <ButtonGroup
              className="mt-3"
              kind="underline"
              options={[
                { value: "net", label: "Net flow" },
                { value: "total", label: "Total volume" },
              ]}
              value={state.participantsView}
              onChange={(participantsView) => updateState({ participantsView })}
              uppercase
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ButtonGroup
              kind="pills"
              options={participantWindowOptions}
              value={state.participantWindow}
              onChange={(participantWindow) => updateState({ participantWindow })}
              uppercase
            />
            <div className="h-4 w-px bg-border" />
            <ButtonGroup
              kind="pills"
              options={topLimitOptions}
              value={state.topLimit}
              onChange={(topLimit) => updateState({ topLimit })}
            />
          </div>
        </div>

        {state.participantsView === "net" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ParticipantListCard
              title={`Top net buyers (${state.participantWindow.toUpperCase()})`}
              rows={batchData?.topBuys?.top ?? []}
              labels={labels}
              mode="net"
              tone="positive"
            />
            <ParticipantListCard
              title={`Top net sellers (${state.participantWindow.toUpperCase()})`}
              rows={batchData?.topSells?.top ?? []}
              labels={labels}
              mode="net"
              tone="negative"
            />
          </div>
        ) : (
          <ParticipantListCard
            title={`Top total volume (${state.participantWindow.toUpperCase()})`}
            rows={batchData?.topVolume?.top ?? []}
            labels={labels}
            mode="total"
            volumeDelta={selectedDelta}
          />
        )}
      </section>
    </div>
  );
}
