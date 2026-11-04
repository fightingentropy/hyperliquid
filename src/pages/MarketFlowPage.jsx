import { lazy, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchHourlyCandles } from "../api/hyperliquid";
import { fetchMarketFlowBatch, fetchMarketFlowSummaries } from "../api/marketFlow";
import ButtonGroup from "../components/ButtonGroup";
import DeferredMount from "../components/DeferredMount";
import NetworkPulse from "../components/NetworkPulse";
import ParticipantListCard from "../components/ParticipantListCard";
import { usePollingResource } from "../hooks/usePollingResource";
import { cx } from "../lib/cx";
import { formatCompactCurrency2, formatCompactSignedCurrency2 } from "../lib/formatters";
import {
  ASSET_OPTIONS,
  CHART_WINDOWS,
  MARKET_TYPES,
  PARTICIPANT_WINDOWS,
  TOP_LIMITS,
  buildCumulativeSeries,
  buildIntervalSeries,
  buildSpotPerpComparisonSeries,
  buildMarketFlowSearchParams,
  formatParticipantWindowLabel,
  getSelectedMarket,
  parseMarketFlowState,
} from "../lib/marketFlow";

const MarketFlowChart = lazy(() => import("../components/MarketFlowChart"));

function routeErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

const WINDOW_LABELS = { "1h": "1 hour", "4h": "4 hours", "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

function signedTone(value) {
  if (!Number.isFinite(value) || value === 0) {
    return "text-foreground";
  }
  return value > 0 ? "text-profit" : "text-loss";
}

// Net flow per window with the bought/sold split, as Qwantify shows it. A tile
// is also the participant-window picker for the rankings below.
function FlowWindowTiles({ deltas, selected, onSelect, loading }) {
  return (
    <section className="rounded-sm border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <h2 className="text-sm font-medium text-foreground">Net flow by window</h2>
        <p className="text-xs text-muted-foreground">Select a window to rank participants below</p>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-3 lg:grid-cols-5">
        {PARTICIPANT_WINDOWS.map((windowValue) => {
          const delta = deltas?.[windowValue];
          const buy = delta?.buyUsd;
          const sell = delta?.sellUsd;
          const total = (buy ?? 0) + (sell ?? 0);
          const buyPct = total > 0 ? (buy / total) * 100 : 50;
          const isSelected = windowValue === selected;
          return (
            <button
              key={windowValue}
              type="button"
              onClick={() => onSelect(windowValue)}
              aria-pressed={isSelected}
              className={cx(
                "flex flex-col gap-2 rounded-sm border p-3 text-left transition-colors",
                isSelected ? "border-border bg-muted" : "border-transparent hover:bg-muted/50",
              )}
            >
              <span className="text-xs text-muted-foreground">{WINDOW_LABELS[windowValue]}</span>
              <span className={cx("text-xl font-light", signedTone(delta?.netUsd))}>
                {delta ? formatCompactSignedCurrency2(delta.netUsd) : loading ? "Loading…" : "—"}
              </span>
              <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                {total > 0 ? (
                  <>
                    <span style={{ width: `${buyPct}%`, backgroundColor: "var(--flow-buy)" }} />
                    <span style={{ width: "2px", backgroundColor: "var(--card)" }} />
                    <span style={{ flex: 1, backgroundColor: "var(--flow-sell)" }} />
                  </>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">
                Bought <span className="text-foreground">{delta ? formatCompactCurrency2(buy) : "—"}</span>
                <br />
                Sold <span className="text-foreground">{delta ? formatCompactCurrency2(sell) : "—"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
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

  const pairedMarketIds = selectedMarket.pairedMarketIds;
  const pairedSummariesResource = usePollingResource(
    () =>
      fetchMarketFlowSummaries({
        marketIds: [pairedMarketIds.perp, pairedMarketIds.spot],
        window: state.chartWindow,
      }),
    [pairedMarketIds?.perp, pairedMarketIds?.spot, state.chartWindow],
    {
      enabled: Boolean(pairedMarketIds) && state.chartMode === "cumulative",
      intervalMs: 60_000,
      initialData: null,
      cacheKey: `market-flow:summaries:${pairedMarketIds?.perp}:${pairedMarketIds?.spot}:${state.chartWindow}`,
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

  const spotPerpComparisonSeries = useMemo(
    () =>
      buildSpotPerpComparisonSeries(
        pairedSummariesResource.data?.summaries,
        pairedMarketIds,
        state.chartWindow,
        candlesResource.data,
      ),
    [pairedSummariesResource.data, pairedMarketIds, state.chartWindow, candlesResource.data],
  );

  const chartVariant =
    state.chartMode === "interval"
      ? "interval"
      : pairedMarketIds
        ? "spot-perp-comparison"
        : "cumulative";

  const chartData =
    chartVariant === "interval"
      ? intervalSeries
      : chartVariant === "spot-perp-comparison"
        ? spotPerpComparisonSeries
        : cumulativeSeries;

  const chartTitle =
    state.chartMode === "cumulative"
      ? `Cumulative net flow (${state.chartWindow === "30d" ? "4h" : "hour"} buckets, last ${state.chartWindow})`
      : `Net flow per ${state.chartWindow === "30d" ? "4h" : "hour"} (last ${state.chartWindow})`;

  const chartError =
    chartVariant === "spot-perp-comparison"
      ? pairedSummariesResource.error
      : batchResource.error || candlesResource.error;

  const chartLoading =
    batchResource.isLoading ||
    candlesResource.isLoading ||
    (chartVariant === "spot-perp-comparison" && pairedSummariesResource.isLoading);

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
      <NetworkPulse />

      <div>
        <p className="text-sm text-muted-foreground">
          Buys minus sells from Hyperliquid fills, maker and taker, across spot and perp markets
          plus a curated set of index markets. Refreshes every minute.
        </p>

        <ButtonGroup
          className="mt-4"
          kind="underline"
          options={ASSET_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          value={state.asset}
          onChange={(asset) =>
            updateState({
              asset,
              marketType: "perp",
              chartMode: "interval",
            })
          }
        />

        {pairedMarketIds ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ButtonGroup
              kind="segmented"
              options={MARKET_TYPES.map((marketType) => ({
                value: marketType,
                label: `${selectedMarket.baseLabel} ${marketType === "spot" ? "Spot" : "Perp"}`,
              }))}
              value={selectedMarket.marketType}
              onChange={(marketType) => updateState({ marketType })}
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

      <FlowWindowTiles
        deltas={deltas}
        selected={state.participantWindow}
        onSelect={(participantWindow) => updateState({ participantWindow })}
        loading={batchResource.isLoading && !summary}
      />

      <section className="rounded-sm border border-border bg-card">
        <div className="p-6 pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-light text-foreground">{chartTitle}</h2>
              {Number.isFinite(deltas?.[state.chartWindow]?.netUsd) ? (
                <span className={cx("text-sm", signedTone(deltas[state.chartWindow].netUsd))}>
                  {formatCompactSignedCurrency2(deltas[state.chartWindow].netUsd)}
                </span>
              ) : null}
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
                chartVariant === "spot-perp-comparison"
                  ? `Unable to load ${selectedMarket.baseLabel} spot/perp chart data.`
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
                  baseLabel={selectedMarket.baseLabel}
                  seriesVisibility={seriesVisibility}
                  onLegendClick={handleLegendClick}
                />
              </Suspense>
            </DeferredMount>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Maker and taker fills, bucketed by {state.chartWindow === "30d" ? "4 hours" : "hour"} in UTC. Price is
            the bucket close.
          </p>
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
