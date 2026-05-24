import { ExternalLink, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  fetchHyperliquidLiquidationMap,
  HYPERLIQUID_LIQUIDATION_SYMBOLS,
} from "../api/coinglass";
import LiquidationMapChart, {
  buildLiquidationChartModel,
} from "../components/LiquidationMapChart";
import MetricCard from "../components/MetricCard";
import { usePollingResource } from "../hooks/usePollingResource";
import { cx } from "../lib/cx";

const POLL_INTERVAL_MS = 60_000;
const COINGLASS_SOURCE_URL = "https://www.coinglass.com/hyperliquid-liquidation-map";

function formatPrice(value) {
  if (!Number.isFinite(value)) {
    return "$0";
  }

  return `$${Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 1_000 ? 0 : 4,
  }).format(value)}`;
}

function formatToken(value, symbol) {
  if (!Number.isFinite(value)) {
    return `0 ${symbol}`;
  }

  return `${Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 3,
  }).format(value)} ${symbol}`;
}

function formatTime(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Live";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function routeErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

export default function LiquidationMapPage() {
  const [symbol, setSymbol] = useState("HYPE");
  const [refreshNonce, setRefreshNonce] = useState(0);

  const { data, error, isLoading, isRefreshing } = usePollingResource(
    () => fetchHyperliquidLiquidationMap({ symbol }),
    [symbol, refreshNonce],
    {
      intervalMs: POLL_INTERVAL_MS,
      cacheKey: `coinglass-liq-map:${symbol}:${refreshNonce}`,
      staleTimeMs: 0,
    },
  );

  const chartModel = useMemo(() => buildLiquidationChartModel(data), [data]);
  const hasChartData = chartModel.points.length > 1;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm text-muted-foreground">
              Hyperliquid whale liquidation levels reconstructed from CoinGlass map data. The
              chart shows cumulative long and short liquidation leverage around the current price.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-9 items-center gap-2 rounded-sm border border-border bg-card px-3 text-sm text-muted-foreground">
              <span>Symbol</span>
              <select
                className="min-w-24 bg-transparent font-medium text-foreground outline-none"
                value={symbol}
                onChange={(event) => {
                  setSymbol(event.target.value);
                  setRefreshNonce(0);
                }}
              >
                {HYPERLIQUID_LIQUIDATION_SYMBOLS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-default disabled:opacity-60"
              onClick={() => setRefreshNonce((value) => value + 1)}
              disabled={isLoading || isRefreshing}
              title="Refresh liquidation map"
              aria-label="Refresh liquidation map"
            >
              <RefreshCw
                className={cx("size-4", (isLoading || isRefreshing) && "qf-spin")}
                aria-hidden="true"
              />
            </button>

            <a
              href={COINGLASS_SOURCE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              title="Open CoinGlass source"
              aria-label="Open CoinGlass source"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Current price"
            value={formatPrice(data?.price)}
            loading={isLoading && !data}
          />
          <MetricCard
            label="Cumulative Long"
            value={formatToken(chartModel.totalLong, symbol)}
            tone="negative"
            loading={isLoading && !data}
          />
          <MetricCard
            label="Cumulative Short"
            value={formatToken(chartModel.totalShort, symbol)}
            tone="positive"
            loading={isLoading && !data}
          />
          <MetricCard
            label="Updated"
            value={formatTime(data?.asOf)}
            loading={isLoading && !data}
          />
        </div>
      </section>

      {error ? (
        <div className="rounded-sm border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {routeErrorMessage(error, "Unable to load liquidation-map data.")}
        </div>
      ) : null}

      <section className="rounded-sm border border-border bg-card">
        <div className="p-6 pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-light text-foreground">Hyperliquid liquidation map</h2>
              <p className="text-sm text-muted-foreground">
                {data?.source ?? "CoinGlass"} data from{" "}
                {data?.endpoint ?? "/api/hyperliquid/topPosition/liqMap"}
              </p>
            </div>

            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
              {isRefreshing ? "Refreshing…" : formatTime(data?.asOf)}
            </p>
          </div>
        </div>

        <div className="relative px-6 pb-6 pt-4">
          {hasChartData ? (
            <LiquidationMapChart
              model={chartModel}
              currentPrice={data.price}
              symbol={symbol}
              height={560}
            />
          ) : (
            <div className="flex min-h-[28rem] items-center justify-center rounded-sm border border-border/60 bg-card text-sm text-muted-foreground">
              {isLoading ? "Loading liquidation map" : "No liquidation map data"}
            </div>
          )}

          {(isLoading || isRefreshing) && hasChartData ? (
            <div className="absolute right-8 top-6 inline-flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-lg">
              <RefreshCw className="size-4 qf-spin" aria-hidden="true" />
              <span>Refreshing</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
