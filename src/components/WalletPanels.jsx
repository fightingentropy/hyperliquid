import { useState } from "react";
import { ExternalLink, Share2 } from "lucide-react";
import { Link } from "react-router-dom";
import ButtonGroup from "./ButtonGroup";
import { cx } from "../lib/cx";
import {
  POSITION_VIEW_OPTIONS,
  buildNotionalDeltaRows,
  formatDateDay,
  formatDateTime,
  formatTime,
} from "../lib/wallet";
import {
  formatCount,
  formatCompactSignedCurrency2,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatSignedCurrency,
  shortAddress,
} from "../lib/formatters";

function toneClass(value) {
  if (!Number.isFinite(value) || value === 0) {
    return "text-muted-foreground";
  }

  return value > 0 ? "text-profit" : "text-loss";
}

function formatQuantity(value, maximumFractionDigits = 4) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

function formatPositionQuantity(value, maximumFractionDigits = 4) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const formatted = formatQuantity(Math.abs(value), maximumFractionDigits);
  return value < 0 ? `-${formatted}` : formatted;
}

function formatCompactCurrencyLower(value, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const absValue = Math.abs(value);
  const units = [
    { threshold: 1_000_000_000, suffix: "b" },
    { threshold: 1_000_000, suffix: "m" },
    { threshold: 1_000, suffix: "k" },
  ];
  const unit = units.find((item) => absValue >= item.threshold);

  if (!unit) {
    return formatCurrency(absValue, maximumFractionDigits);
  }

  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits,
  }).format(absValue / unit.threshold)}${unit.suffix}`;
}

function formatCompactSignedCurrencyLower(value, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  if (value === 0) {
    return "$0";
  }

  return `${value > 0 ? "+" : "-"}${formatCompactCurrencyLower(value, maximumFractionDigits)}`;
}

function formatPositionPrice(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value)}`;
}

function formatPositionFunding(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  if (Math.abs(value) >= 1_000) {
    return formatCompactSignedCurrencyLower(value, 2);
  }

  return formatSignedCurrency(value, 4);
}

function formatNetCurrency(value, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const sign = value < 0 ? "-" : "";

  return `$${sign}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits > 0 ? 2 : 0,
  }).format(Math.abs(value))}`;
}

function formatSignedPercent(value, maximumFractionDigits = 1) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  if (value === 0) {
    return "0%";
  }

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    signDisplay: "always",
  }).format(value)}%`;
}

function formatMaybePercent(value, maximumFractionDigits = 1) {
  return Number.isFinite(value) ? formatPercent(value, maximumFractionDigits) : "—";
}

function StatCard({ label, value, valueSuffix, tone = "neutral", badge, footer }) {
  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="space-y-2 p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
          {label}
        </p>
        <div className="flex items-baseline justify-between gap-3">
          <div
            className={cx(
              "text-xl font-light sm:text-2xl",
              tone === "positive"
                ? "text-profit"
                : tone === "negative"
                  ? "text-loss"
                  : "text-foreground",
            )}
          >
            {value}
          </div>
          {valueSuffix ? (
            <div className="text-xs text-muted-foreground">{valueSuffix}</div>
          ) : null}
          {badge ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        {footer ? <div className="text-[11px] text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  );
}

export function WalletOverviewGrid({ metrics, slices }) {
  const sliceMap = Object.fromEntries(slices.map((s) => [s.key, s]));
  const realized24h = `${formatSignedCurrency(metrics.realizedDelta24hUsd, 2)} (${formatMaybePercent(metrics.realizedDelta24hPct, 1)})`;
  const realized7d = `${formatSignedCurrency(metrics.realizedDelta7dUsd, 2)} (${formatMaybePercent(metrics.realizedDelta7dPct, 1)})`;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total Equity"
        value={formatCurrency(metrics.totalEquityUsd, 2)}
        footer={
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full border border-border bg-muted">
              <div className="flex h-full w-full">
                <div className="h-full bg-emerald-500" style={{ width: `${sliceMap.spot?.percent ?? 0}%` }} />
                <div className="h-full bg-orange-500" style={{ width: `${sliceMap.perps?.percent ?? 0}%` }} />
                <div className="h-full bg-violet-500" style={{ width: `${sliceMap.staked?.percent ?? 0}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span>Spot {sliceMap.spot?.percent.toFixed(0)}%</span>
              <span>Perps {sliceMap.perps?.percent.toFixed(0)}%</span>
              <span>Staked {sliceMap.staked?.percent.toFixed(0)}%</span>
            </div>
          </div>
        }
      />

      <StatCard
        label="Realized PnL (All Time)"
        value={formatSignedCurrency(metrics.realizedAllTimeUsd, 2)}
        tone={
          metrics.realizedAllTimeUsd > 0
            ? "positive"
            : metrics.realizedAllTimeUsd < 0
              ? "negative"
              : "neutral"
        }
        footer={
          <div className="grid grid-cols-2 gap-2 font-mono">
            <span
              className={cx(
                "truncate rounded-sm border border-border px-2 py-1",
                toneClass(metrics.realizedDelta24hUsd),
              )}
              title={realized24h}
            >
              24h {realized24h}
            </span>
            <span
              className={cx(
                "truncate rounded-sm border border-border px-2 py-1",
                toneClass(metrics.realizedDelta7dUsd),
              )}
              title={realized7d}
            >
              7d {realized7d}
            </span>
          </div>
        }
      />

      <StatCard
        label="Margin Utilization"
        value={metrics.marginUsedPct === null ? "—" : formatPercent(metrics.marginUsedPct, 1)}
        footer={
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono">Used {formatCurrency(metrics.marginUsedUsd, 2)}</span>
              <span>Perp equity {formatCurrency(metrics.perpsEquityUsd, 2)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cx(
                  "h-full transition-all",
                  metrics.marginUsedPct === null
                    ? "bg-muted-foreground/40"
                    : metrics.marginUsedPct < 30
                      ? "bg-profit"
                      : metrics.marginUsedPct <= 60
                        ? "bg-orange-500"
                        : "bg-loss",
                )}
                style={{ width: `${Math.max(0, Math.min(100, metrics.marginUsedPct ?? 0))}%` }}
              />
            </div>
          </div>
        }
      />

      <StatCard
        label="Risk Profile"
        value={metrics.effectiveLeverage === null ? "—" : `${metrics.effectiveLeverage.toFixed(2)}x`}
        badge={metrics.biasLabel}
        footer={
          <div className="space-y-2">
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-profit" style={{ width: `${metrics.longPct}%` }} />
              <div className="h-full bg-loss" style={{ width: `${metrics.shortPct}%` }} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Long {metrics.longPct.toFixed(1)}% ({metrics.longCount})</span>
              <span>Short {metrics.shortPct.toFixed(1)}% ({metrics.shortCount})</span>
            </div>
          </div>
        }
      />
    </div>
  );
}

function PanelShell({ title, description, children }) {
  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ message }) {
  return <div className="p-6 text-center text-sm text-muted-foreground">{message}</div>;
}

function ErrorState({ message }) {
  return (
    <div className="rounded-sm border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

const LOCAL_POSITION_TOKEN_ICONS = new Set([
  "ASTER",
  "HYPE",
  "TON",
  "ZEC",
  "xyz__TSLA",
  "xyz__XYZ100",
]);

const POSITION_TOKEN_FALLBACKS = {
  NEAR: {
    "--token-bg": "#be35cf",
    "--token-highlight": "#f08aff",
    "--token-fg": "#05020a",
  },
  WLD: {
    "--token-bg": "#335fe2",
    "--token-highlight": "#83a5ff",
    "--token-fg": "#050713",
  },
  XMR: {
    "--token-bg": "#3e36d3",
    "--token-highlight": "#8d6cff",
    "--token-fg": "#050513",
  },
};

function getPositionTokenFallbackStyle(normalizedCoin) {
  const preset = POSITION_TOKEN_FALLBACKS[normalizedCoin.toUpperCase()];
  if (preset) {
    return preset;
  }

  return {
    "--token-hue": `${Math.abs(
      normalizedCoin.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0),
    ) % 360}deg`,
  };
}

function PositionTokenMark({ coin }) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedCoin = String(coin ?? "").replace(/^xyz:/i, "").trim().toUpperCase();
  const label = normalizedCoin.slice(0, normalizedCoin.length <= 3 ? 2 : 1).toUpperCase();
  const rawCoin = String(coin ?? "").trim();
  const rawIconName = rawCoin.replace(/^xyz:/i, "xyz__").replace(/[/:]/g, "__");
  const iconName = rawIconName.startsWith("xyz__")
    ? `xyz__${rawIconName.slice("xyz__".length).toUpperCase()}`
    : rawIconName.toUpperCase();
  const iconSrc = iconName ? `/hyperliquid/coins/${iconName}.svg` : "";
  const hasLocalIcon = LOCAL_POSITION_TOKEN_ICONS.has(iconName);

  if (hasLocalIcon && iconSrc && !imageFailed) {
    return (
      <span className="qf-position-token qf-position-token--image">
        <img
          src={iconSrc}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className="qf-position-token"
      style={getPositionTokenFallbackStyle(normalizedCoin)}
      aria-hidden="true"
    >
      {label || "?"}
    </span>
  );
}

export function WalletPositionsPanel({ tabs, snapshot, viewMode, onViewModeChange, error, loading }) {
  if (error) {
    return <ErrorState message={error} />;
  }

  if (loading && !snapshot.positions.length) {
    return (
      <div className="qf-positions-card">
        {tabs}
        <EmptyState message="Loading positions..." />
      </div>
    );
  }

  const positions = snapshot.positions;

  return (
    <div className="qf-positions-card">
      {tabs}

      <div className="qf-positions-summary">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="font-mono">
              Long: <span className="text-profit">{formatCompactCurrencyLower(snapshot.longExposureUsd)}</span>
            </span>
            <span className="font-mono">
              Short: <span className="text-loss">{formatCompactCurrencyLower(snapshot.shortExposureUsd)}</span>
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className="font-mono text-xs text-muted-foreground">
              Total PnL:{" "}
              <span className={toneClass(snapshot.totalUnrealizedPnlUsd)}>
                {formatCompactSignedCurrencyLower(snapshot.totalUnrealizedPnlUsd)}
              </span>
            </span>

            <div className="sm:hidden">
              <ButtonGroup
                kind="segmented"
                size="sm"
                value={viewMode}
                onChange={onViewModeChange}
                options={POSITION_VIEW_OPTIONS}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="qf-positions-totals hidden flex-wrap items-center gap-4 text-sm text-muted-foreground sm:flex">
        <span>
          Value: <span className="font-mono text-foreground">{formatCurrency(snapshot.accountValueUsd, 2)}</span>
        </span>
        <span>
          Notional: <span className="font-mono text-foreground">{formatCurrency(snapshot.totalNotionalUsd, 2)}</span>
        </span>
        <span>
          Net Notional:{" "}
          <span className="font-mono text-foreground">{formatNetCurrency(snapshot.netExposureUsd, 2)}</span>
        </span>
      </div>

      {!positions.length ? (
        <EmptyState message="No open positions." />
      ) : viewMode === "cards" ? (
        <div className="space-y-2 px-4 py-3 sm:hidden">
          {positions.map((position) => (
            <div key={position.id} className="rounded-sm border border-border bg-card px-3 py-3">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cx(
                        "h-1.5 w-1.5 rounded-full",
                        position.side === "LONG" ? "bg-profit" : "bg-loss",
                      )}
                    />
                    <PositionTokenMark coin={position.coin} />
                    <span className="truncate font-mono text-sm text-foreground">{position.coin}</span>
                  </div>
                  <span
                    className={cx(
                      "font-mono text-sm tabular-nums",
                      position.side === "LONG" ? "text-profit" : "text-loss",
                    )}
                  >
                    {formatPositionQuantity(position.size)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <div>Entry</div>
                    <div className="font-mono text-foreground">{formatPrice(position.entryPrice)}</div>
                  </div>
                  <div>
                    <div>Mark</div>
                    <div className="font-mono text-foreground">{formatPrice(position.markPrice)}</div>
                  </div>
                  <div>
                    <div>Value</div>
                    <div className="font-mono text-foreground">
                      {formatCompactCurrencyLower(position.positionValueUsd)}
                    </div>
                  </div>
                  <div>
                    <div>PnL</div>
                    <div className={cx("font-mono", toneClass(position.unrealizedPnlUsd))}>
                      {formatCompactSignedCurrencyLower(position.unrealizedPnlUsd)}
                    </div>
                  </div>
                  <div>
                    <div>ROE</div>
                    <div className={cx("font-mono", toneClass(position.roePct))}>
                      {formatSignedPercent(position.roePct, 4)}
                    </div>
                  </div>
                  <div>
                    <div>Funding</div>
                    <div className={cx("font-mono", toneClass(position.fundingUsd))}>
                      {formatCompactSignedCurrencyLower(position.fundingUsd, 2)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : viewMode === "details" ? (
        <div className="space-y-0 sm:hidden">
          {positions.map((position, index) => (
            <div
              key={position.id}
              className={cx(
                "flex items-center justify-between gap-4 px-4 py-3",
                index > 0 && "border-t border-border/60",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      "h-1.5 w-1.5 rounded-full",
                      position.side === "LONG" ? "bg-profit" : "bg-loss",
                    )}
                  />
                  <PositionTokenMark coin={position.coin} />
                  <span className="truncate font-mono text-sm text-foreground">{position.coin}</span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  <span className="font-mono tabular-nums">
                    Size {formatPositionQuantity(position.size)} • {formatCompactCurrencyLower(position.positionValueUsd)}
                  </span>
                </div>
              </div>

              <div className="text-right">
                <div className={cx("font-mono text-sm tabular-nums", toneClass(position.unrealizedPnlUsd))}>
                  {formatCompactSignedCurrencyLower(position.unrealizedPnlUsd)}
                </div>
                <div className={cx("mt-1 font-mono text-[11px] tabular-nums", toneClass(position.roePct))}>
                  {formatSignedPercent(position.roePct, 4)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="qf-positions-table w-full min-w-[1216px]">
            <thead>
              <tr>
                <th className="qf-positions-col-symbol">Symbol</th>
                <th className="qf-positions-col-size text-right">Size</th>
                <th className="qf-positions-col-price text-right">Entry Price</th>
                <th className="qf-positions-col-price text-right">Mark Price</th>
                <th className="qf-positions-col-value text-right">Position Value</th>
                <th className="qf-positions-col-value text-right">Unrealized PnL</th>
                <th className="qf-positions-col-roe text-right">ROE</th>
                <th className="qf-positions-col-funding text-right">Funding</th>
                <th className="qf-positions-col-liq text-right">Liq. Price</th>
                <th className="qf-positions-col-action text-right" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.id} className="qf-positions-row">
                  <td>
                    <div className="qf-position-symbol">
                      <span
                        className={cx(
                          "qf-position-side-dot",
                          position.side === "LONG" ? "is-long" : "is-short",
                        )}
                      />
                      <PositionTokenMark coin={position.coin} />
                      <span>{position.coin}</span>
                    </div>
                  </td>
                  <td
                    className={cx(
                      "text-right font-mono tabular-nums",
                      position.side === "LONG" ? "text-profit" : "text-loss",
                    )}
                  >
                    {formatPositionQuantity(position.size)}
                  </td>
                  <td className="text-right font-mono tabular-nums">{formatPositionPrice(position.entryPrice)}</td>
                  <td className="text-right font-mono tabular-nums">{formatPositionPrice(position.markPrice)}</td>
                  <td className="text-right font-mono tabular-nums">
                    {formatCompactCurrencyLower(position.positionValueUsd)}
                  </td>
                  <td className={cx("text-right font-mono", toneClass(position.unrealizedPnlUsd))}>
                    {formatCompactSignedCurrencyLower(position.unrealizedPnlUsd)}
                  </td>
                  <td className={cx("text-right font-mono", toneClass(position.roePct))}>
                    {formatSignedPercent(position.roePct, 4)}
                  </td>
                  <td className={cx("text-right font-mono", toneClass(position.fundingUsd))}>
                    {formatPositionFunding(position.fundingUsd)}
                  </td>
                  <td className="text-right font-mono text-muted-foreground">
                    {position.liquidationPrice === null ? "-" : formatPositionPrice(position.liquidationPrice)}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="qf-position-action"
                      aria-label={`Share poster for ${position.coin} ${position.side.toLowerCase()}`}
                      title="Share poster"
                    >
                      <Share2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function WalletOrdersPanel({ groups, error, loading }) {
  if (error) {
    return <ErrorState message={error} />;
  }

  if (loading && !groups.length) {
    return <EmptyState message="Loading open orders..." />;
  }

  return (
    <PanelShell title="Open orders" description="Pending limit orders grouped by pair.">
      {!groups.length ? (
        <EmptyState message="No open orders." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3">Pair</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3 text-right">Orders</th>
                <th className="px-4 py-3 text-right">Total Size</th>
                <th className="px-4 py-3 text-right">Notional</th>
                <th className="px-4 py-3 text-right">Limit Px Range</th>
                <th className="px-4 py-3 text-right">DEX</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id} className="border-b border-border/60 text-foreground last:border-b-0">
                  <td className="px-4 py-3 font-mono">{group.coin}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cx(
                        "inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        group.side === "B" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss",
                      )}
                    >
                      {group.side === "B" ? "BUY" : "SELL"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{group.ordersCount}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatQuantity(group.totalSize)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(group.totalNotionalUsd, 2)}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatPrice(group.minLimitPrice)} - {formatPrice(group.maxLimitPrice)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono uppercase">
                    {group.dexes.map((dex) => (dex === "main" ? "MAIN" : dex)).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

export function WalletHoldingsPanel({ snapshot, error, loading }) {
  if (error) {
    return <ErrorState message={error} />;
  }

  if (loading && !snapshot.holdings.length) {
    return <EmptyState message="Loading holdings..." />;
  }

  return (
    <PanelShell
      title={`Holdings${snapshot.stakingEntries.length ? " & Staking" : ""}`}
      description={`Aggregated across wallet + subaccounts (${snapshot.sourceWalletCount} total).`}
    >
      {snapshot.stakingEntries.length ? (
        <div className="grid grid-cols-1 gap-3 border-b border-border px-4 py-4 md:grid-cols-3">
          {snapshot.stakingEntries.map((entry) => (
            <div key={entry.id} className="rounded-sm border border-border bg-card px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-foreground">{entry.label}</span>
                <span className="rounded-full border border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {entry.badge}
                </span>
              </div>
              <div className="mt-3 text-lg font-light text-foreground">{formatQuantity(entry.amount, 2)}</div>
              <div className="text-xs text-muted-foreground">{formatCurrency(entry.valueUsd, 2)}</div>
            </div>
          ))}
        </div>
      ) : null}

      {!snapshot.holdings.length ? (
        <EmptyState message="No spot holdings available." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Available</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-right">Avg Entry</th>
                <th className="px-4 py-3 text-right">Return</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.holdings.map((holding) => (
                <tr key={holding.coin} className="border-b border-border/60 text-foreground last:border-b-0">
                  <td className="px-4 py-3 font-mono">{holding.coin}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatQuantity(holding.total)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatQuantity(holding.available)}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {holding.midPx === null ? "—" : formatPrice(holding.midPx)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {holding.valueUsd === null ? "—" : formatCurrency(holding.valueUsd, 2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {holding.avgEntryPxUsd === null ? "—" : formatPrice(holding.avgEntryPxUsd)}
                  </td>
                  <td className={cx("px-4 py-3 text-right font-mono", toneClass(holding.returnUsd ?? 0))}>
                    {holding.returnUsd === null
                      ? "—"
                      : `${formatSignedCurrency(holding.returnUsd, 2)} (${formatPercent(holding.returnPct ?? 0, 1)})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

export function WalletTradesPanel({ rows, error, loading }) {
  if (error) {
    return <ErrorState message={error} />;
  }

  if (loading && !rows.length) {
    return <EmptyState message="Loading trades..." />;
  }

  return (
    <PanelShell title="Recent trades" description={`Showing ${formatCount(rows.length)} aggregated fills.`}>
      {!rows.length ? (
        <EmptyState message="No trades available." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Coin</th>
                <th className="px-4 py-3">Dir</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Size</th>
                <th className="px-4 py-3 text-right">Notional</th>
                <th className="px-4 py-3 text-right">Fee</th>
                <th className="px-4 py-3 text-right">PnL</th>
                <th className="px-4 py-3 text-right">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.hash}:${row.parsedTime}:${row.tid ?? "fill"}`} className="border-b border-border/60 text-foreground last:border-b-0">
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(row.parsedTime)}</td>
                  <td className="px-4 py-3 font-mono">{row.coin}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cx(
                        "inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        row.direction.includes("BUY") || row.direction.includes("LONG")
                          ? "bg-profit/10 text-profit"
                          : "bg-loss/10 text-loss",
                      )}
                    >
                      {row.direction}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{formatPrice(row.price)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatQuantity(row.size)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(row.notionalUsd, 2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {formatCurrency(row.feeUsd, 2)}
                  </td>
                  <td className={cx("px-4 py-3 text-right font-mono", toneClass(row.closedPnlUsd))}>
                    {formatSignedCurrency(row.closedPnlUsd, 2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`https://app.hyperliquid.xyz/explorer/tx/${row.hash}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground transition hover:text-foreground"
                    >
                      {shortAddress(row.hash)}
                      <ExternalLink className="size-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

export function WalletPerformanceBreakdownPanel({ rows, error, loading }) {
  if (error) {
    return <ErrorState message={error} />;
  }

  if (loading && !rows.length) {
    return <EmptyState message="Loading performance breakdown..." />;
  }

  return (
    <PanelShell
      title="Asset breakdown"
      description={`Performance by asset based on ${formatCount(rows.reduce((sum, row) => sum + row.tradeCount, 0))} fills.`}
    >
      {!rows.length ? (
        <EmptyState message="No asset data available." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3 text-right">PnL</th>
                <th className="px-4 py-3 text-right">Volume</th>
                <th className="px-4 py-3 text-right">Trades</th>
                <th className="px-4 py-3 text-right">Win Rate</th>
                <th className="px-4 py-3 text-right">Avg Win</th>
                <th className="px-4 py-3 text-right">Avg Loss</th>
                <th className="px-4 py-3 text-right">Fees</th>
                <th className="px-4 py-3 text-right">Builder</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.coin} className="border-b border-border/60 text-foreground last:border-b-0">
                  <td className="px-4 py-3 font-mono">{row.coin}</td>
                  <td className={cx("px-4 py-3 text-right font-mono", toneClass(row.realizedPnl))}>
                    {formatSignedCurrency(row.realizedPnl, 2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {formatCurrency(row.volume, 2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{formatCount(row.tradeCount)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatPercent(row.winRate, 1)}</td>
                  <td className="px-4 py-3 text-right font-mono text-profit">
                    {formatCurrency(row.avgWin, 2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-loss">
                    {formatSignedCurrency(row.avgLoss, 2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {formatCurrency(row.fees, 2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {formatCurrency(row.builderFees, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

function StatisticsValue({ label, value, tone }) {
  return (
    <div className="rounded-sm border border-border bg-card px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cx(
          "mt-2 text-2xl font-light",
          tone === "positive"
            ? "text-profit"
            : tone === "negative"
              ? "text-loss"
              : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function WalletStatisticsPanel({ stats, error, loading }) {
  if (error) {
    return <ErrorState message={error} />;
  }

  if (loading && !stats) {
    return <EmptyState message="Loading statistics..." />;
  }

  if (!stats || stats.totalTrades === 0) {
    return <EmptyState message="No statistics available." />;
  }

  return (
    <div className="space-y-6 rounded-sm border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Trade Distribution
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-profit">Wins: {formatCount(stats.winningTrades)}</span>
              <span className="text-loss">Losses: {formatCount(stats.losingTrades)}</span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-profit"
                style={{ width: `${(stats.winningTrades / stats.totalTrades) * 100}%` }}
              />
              <div
                className="h-full bg-loss"
                style={{ width: `${(stats.losingTrades / stats.totalTrades) * 100}%` }}
              />
            </div>
            <div className="text-center">
              <span className="text-3xl font-light text-foreground">
                {formatPercent(stats.winRate, 1)}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">win rate</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Profit Factor
          </h4>
          <div className="flex h-20 items-center justify-center">
            <span className={cx("text-4xl font-light", stats.profitFactor >= 1 ? "text-profit" : "text-loss")}>
              {Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"}
            </span>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {stats.profitFactor >= 1.5
              ? "Good risk/reward ratio"
              : stats.profitFactor >= 1
                ? "Breaking even or slight profit"
                : "Losing money on average"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatisticsValue label="Total Trades" value={formatCount(stats.totalTrades)} />
        <StatisticsValue label="Winning Trades" value={formatCount(stats.winningTrades)} tone="positive" />
        <StatisticsValue label="Losing Trades" value={formatCount(stats.losingTrades)} tone="negative" />
        <StatisticsValue label="Win Rate" value={formatPercent(stats.winRate, 1)} />
        <StatisticsValue label="Average Win" value={formatCurrency(stats.avgWin, 2)} tone="positive" />
        <StatisticsValue label="Average Loss" value={formatSignedCurrency(stats.avgLoss, 2)} tone="negative" />
        <StatisticsValue label="Largest Win" value={formatCurrency(stats.largestWin, 2)} tone="positive" />
        <StatisticsValue label="Largest Loss" value={formatSignedCurrency(stats.largestLoss, 2)} tone="negative" />
      </div>
    </div>
  );
}

function renderWalletParty(address, currentWalletAddress) {
  if (!address) {
    return <span className="text-muted-foreground">—</span>;
  }

  const isCurrentWallet =
    currentWalletAddress && address.toLowerCase() === currentWalletAddress.toLowerCase();

  if (isCurrentWallet) {
    return <span className="font-medium text-foreground">Self</span>;
  }

  return (
    <Link
      to={`/app/wallets/${encodeURIComponent(address)}`}
      className="font-mono text-xs underline-offset-4 transition hover:underline"
    >
      {shortAddress(address)}
    </Link>
  );
}

export function WalletTransactionsPanel({ rows, error, loading, currentWalletAddress }) {
  if (error) {
    return <ErrorState message={error} />;
  }

  if (loading && !rows.length) {
    return <EmptyState message="Loading transactions..." />;
  }

  return (
    <PanelShell title="Transactions" description={`Showing ${formatCount(rows.length)} non-funding ledger updates.`}>
      {!rows.length ? (
        <EmptyState message="No transactions available." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Tx</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Token</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 text-foreground last:border-b-0">
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="flex flex-col">
                      <span>{formatDateDay(row.time)}</span>
                      <span className="text-[11px] text-muted-foreground/70">{formatTime(row.time)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`https://app.hyperliquid.xyz/explorer/tx/${row.hash}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 font-mono text-xs transition hover:text-foreground"
                    >
                      {shortAddress(row.hash)}
                      <ExternalLink className="size-3.5" />
                    </a>
                  </td>
                  <td className="px-4 py-3">{row.type}</td>
                  <td className="px-4 py-3">{renderWalletParty(row.from, currentWalletAddress)}</td>
                  <td className="px-4 py-3">{renderWalletParty(row.to, currentWalletAddress)}</td>
                  <td className="px-4 py-3 font-mono">{row.token}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatQuantity(row.amount)}
                    {row.usdValue ? ` (${formatCurrency(row.usdValue, 2)})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

export function WalletNotionalDeltasPanel({ payload, error, loading }) {
  if (error) {
    return <ErrorState message={error} />;
  }

  if (loading && !payload?.deltas?.length) {
    return <EmptyState message="Loading notional deltas..." />;
  }

  const rows = buildNotionalDeltaRows(payload);

  if (!rows.length) {
    return null;
  }

  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="px-4 py-3">
        <p className="text-sm font-medium text-foreground">Net Notional Delta</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-t border-border">
              <th className="px-4 py-2.5 font-medium">Symbol</th>
              <th className="px-4 py-2.5 text-right font-medium">&Delta;1H</th>
              <th className="px-4 py-2.5 text-right font-medium">&Delta;4H</th>
              <th className="px-4 py-2.5 text-right font-medium">&Delta;12H</th>
              <th className="px-4 py-2.5 text-right font-medium">&Delta;1D</th>
              <th className="px-4 py-2.5 text-right font-medium">&Delta;7D</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.symbol} className="border-t border-border/60 text-foreground">
                <td className="px-4 py-2.5">{row.symbol}</td>
                {["1h", "4h", "12h", "1d", "7d"].map((window) => (
                  <td key={window} className={cx("px-4 py-2.5 text-right tabular-nums", toneClass(row.deltas[window]))}>
                    {formatCompactSignedCurrency2(row.deltas[window])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
