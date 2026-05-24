import { ExternalLink, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  fetchHyperliquidLiquidationMap,
  HYPERLIQUID_LIQUIDATION_SYMBOLS,
} from "../api/coinglass";
import LiquidationMapChart, {
  buildLiquidationChartModel,
} from "../components/LiquidationMapChart";
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

function LiquidationMetric({ label, value, tone }) {
  return (
    <div className="qf-liquidation-metric">
      <span className="qf-liquidation-metric__label">{label}</span>
      <strong className={cx("qf-liquidation-metric__value", tone && `is-${tone}`)}>{value}</strong>
    </div>
  );
}

export default function LiquidationMapPage() {
  const [symbol, setSymbol] = useState("BTC");
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
    <div className="qf-liquidation-page">
      <section className="qf-liquidation-panel">
        <div className="qf-liquidation-toolbar">
          <div className="qf-liquidation-title">
            <h2>Hyperliquid Liquidation Map</h2>
            <p>
              {data?.source ?? "CoinGlass"} data from {data?.endpoint ?? "/api/hyperliquid/topPosition/liqMap"}
            </p>
          </div>

          <div className="qf-liquidation-actions">
            <label className="qf-liquidation-select">
              <span>Symbol</span>
              <select
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
              className="qf-liquidation-icon-button"
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
              className="qf-liquidation-icon-button"
              title="Open CoinGlass source"
              aria-label="Open CoinGlass source"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="qf-liquidation-metrics" aria-label="Liquidation map summary">
          <LiquidationMetric label="Current Price" value={formatPrice(data?.price)} />
          <LiquidationMetric
            label="Cumulative Long"
            value={formatToken(chartModel.totalLong, symbol)}
            tone="long"
          />
          <LiquidationMetric
            label="Cumulative Short"
            value={formatToken(chartModel.totalShort, symbol)}
            tone="short"
          />
          <LiquidationMetric label="Updated" value={formatTime(data?.asOf)} />
        </div>

        <div className="qf-liquidation-chart-wrap">
          {hasChartData ? (
            <LiquidationMapChart
              model={chartModel}
              currentPrice={data.price}
              symbol={symbol}
              height={560}
            />
          ) : (
            <div className="qf-liquidation-empty">
              {isLoading ? "Loading liquidation map" : "No liquidation map data"}
            </div>
          )}

          {(isLoading || isRefreshing) && hasChartData ? (
            <div className="qf-liquidation-loading">
              <RefreshCw className="size-4 qf-spin" aria-hidden="true" />
              <span>Refreshing</span>
            </div>
          ) : null}
        </div>

        {error ? <div className="qf-liquidation-error">{error.message}</div> : null}
      </section>
    </div>
  );
}
