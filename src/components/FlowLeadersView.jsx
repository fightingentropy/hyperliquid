import { useMemo, useState } from "react";
import { Check, Plus, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { fetchMarketFlowBatch } from "../api/marketFlow";
import { usePollingResource } from "../hooks/usePollingResource";
import { useTrackedWalletData } from "../hooks/useTrackedWalletData";
import { cx } from "../lib/cx";
import {
  LEADER_LIMIT,
  LEADER_WINDOWS,
  assetExposure,
  buildLeaderSignals,
  buildLeaders,
  exposureAmount,
  formatTradePrice,
} from "../lib/flowLeaders";
import { formatCompactCurrency, formatCompactSignedCurrency, formatCount } from "../lib/formatters";
import { ASSET_OPTIONS, MARKET_FLOW_MARKETS } from "../lib/marketFlow";
import { buildLiquidationWatch, buildPositioning, buildWalletSnapshot, describeCoin, walletDisplayName } from "../lib/trackedWallets";
import MetricCard from "./MetricCard";
import { BUY_COLOR, ChartLegend, PositioningChart, SELL_COLOR } from "./TrackedWalletCharts";
import { Chip, EmptyNote, LiquidationTable, Panel, SignalList, WalletLink, signedClass } from "./TrackedWalletUi";

const COHORT_CHART_ROWS = 8;
const DEFAULT_MARKET = "HYPE-PERP";
const DEFAULT_WINDOW = "24h";

const PAIRED_ASSETS = new Set(
  MARKET_FLOW_MARKETS.filter((market) => market.marketType === "spot").map((market) => market.asset),
);

const MARKET_OPTIONS = MARKET_FLOW_MARKETS.map((market) => {
  const base = ASSET_OPTIONS.find((option) => option.value === market.asset)?.label ?? market.asset;
  const label = PAIRED_ASSETS.has(market.asset) ? `${base} ${market.marketType === "spot" ? "Spot" : "Perp"}` : base;
  return { ...market, label, symbol: describeCoin(market.candleCoin).symbol };
});

const STYLE_LABELS = { "one-sided": "One-sided", "two-sided": "Two-sided", mixed: "Mixed" };

function otherBets(snapshot, symbol) {
  return (snapshot?.positions ?? [])
    .filter((position) => describeCoin(position.coin).symbol !== symbol)
    .sort((a, b) => b.positionValueUsd - a.positionValueUsd)
    .slice(0, 2)
    .map((position) => `${describeCoin(position.coin).symbol} ${position.side === "LONG" ? "long" : "short"} ${formatCompactCurrency(position.positionValueUsd)}`)
    .join(" · ");
}

function ExposureCell({ exposure, symbol }) {
  if (!exposure) {
    return <span className="text-muted-foreground">···</span>;
  }
  if (exposure.side === "flat") {
    return <span className="text-muted-foreground">No {symbol}</span>;
  }
  if (exposure.side === "hedged") {
    return (
      <div>
        <span className="text-foreground">Hedged</span>{" "}
        <span className="tabular-nums">{formatCompactCurrency(exposureAmount(exposure))}</span>
        <div className="text-xs text-muted-foreground">
          perp short vs {formatCompactCurrency(exposure.spotUsd)} spot · net {formatCompactSignedCurrency(exposure.netUsd)}
        </div>
      </div>
    );
  }
  const label = exposure.side === "spot" ? "Spot" : exposure.side === "long" ? "Long" : "Short";
  return (
    <div>
      <span className={exposure.netUsd >= 0 ? "text-profit" : "text-loss"}>{label}</span>{" "}
      <span className="tabular-nums">{formatCompactCurrency(exposureAmount(exposure))}</span>
      {exposure.perpUsd && exposure.entryPrice ? (
        <div className="text-xs text-muted-foreground">
          entry {formatTradePrice(exposure.entryPrice)} ·{" "}
          <span className={signedClass(exposure.unrealizedPnlUsd)}>{formatCompactSignedCurrency(exposure.unrealizedPnlUsd)}</span>
        </div>
      ) : exposure.spotUsd && exposure.perpUsd ? (
        <div className="text-xs text-muted-foreground">incl. spot {formatCompactCurrency(exposure.spotUsd)}</div>
      ) : null}
    </div>
  );
}

function LeadersTable({ leaders, snapshots, exposures, symbol, windowLabel, tracked, onTrack, failed }) {
  if (!leaders.length) {
    return <EmptyNote>No wallets in this window.</EmptyNote>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-light">#</th>
            <th className="px-3 py-2 font-light">Wallet</th>
            <th className="px-3 py-2 text-right font-light">Net · {windowLabel}</th>
            <th className="px-3 py-2 text-right font-light">Trades</th>
            <th className="px-3 py-2 text-right font-light">Avg entry</th>
            <th className="px-3 py-2 font-light">{symbol} now</th>
            <th className="px-3 py-2 text-right font-light">Equity</th>
            <th className="px-3 py-2 font-light">Other bets</th>
            <th className="px-3 py-2" aria-label="Track" />
          </tr>
        </thead>
        <tbody>
          {leaders.map((leader) => {
            const snapshot = snapshots.get(leader.address);
            const isTracked = tracked.has(leader.address);
            return (
              <tr key={leader.address} className="border-t border-border/60 align-top">
                <td className="px-3 py-2 text-xs text-muted-foreground">{leader.rank}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <WalletLink address={leader.address} name={walletDisplayName(leader)} />
                  <div className="text-xs text-muted-foreground">{STYLE_LABELS[leader.style]}</div>
                </td>
                <td className={cx("px-3 py-2 text-right font-medium tabular-nums", signedClass(leader.netUsd))}>
                  {formatCompactSignedCurrency(leader.netUsd)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCount(leader.tradeCount)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatTradePrice(leader.avgEntry)}</td>
                <td className="px-3 py-2">
                  {failed.has(leader.address) ? (
                    <span className="text-xs text-muted-foreground">Couldn&apos;t load</span>
                  ) : (
                    <ExposureCell exposure={exposures.get(leader.address)} symbol={symbol} />
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {snapshot ? formatCompactCurrency(snapshot.perpsUsd + snapshot.spotUsd) : "···"}
                  {snapshot?.leverage ? <div className="text-xs text-muted-foreground">{snapshot.leverage.toFixed(1)}x</div> : null}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{snapshot ? otherBets(snapshot, symbol) || "—" : "···"}</td>
                <td className="px-3 py-2 text-right">
                  {isTracked ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Check className="size-3.5" /> Tracked
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onTrack(leader)}
                      className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                      <Plus className="size-3.5" /> Track
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function FlowLeadersView({ myWallets, addWallet }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshToken, setRefreshToken] = useState(0);
  const market = MARKET_OPTIONS.find((option) => option.marketId === searchParams.get("market")) ?? MARKET_OPTIONS.find((option) => option.marketId === DEFAULT_MARKET);
  const windowValue = LEADER_WINDOWS.includes(searchParams.get("window")) ? searchParams.get("window") : DEFAULT_WINDOW;
  const symbol = market.symbol;

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    next.set("view", "leaders");
    next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const batchResource = usePollingResource(
    () => fetchMarketFlowBatch({ marketId: market.marketId, chartWindow: "24h", participantsWindow: windowValue, limit: LEADER_LIMIT }),
    [market.marketId, windowValue, refreshToken],
    { cacheKey: `flow-leaders:${market.marketId}:${windowValue}:${refreshToken}`, staleTimeMs: 60_000 },
  );

  const leaders = useMemo(() => buildLeaders(batchResource.data), [batchResource.data]);
  const leaderWallets = useMemo(() => leaders.map((leader) => ({ address: leader.address, label: leader.label })), [leaders]);
  const data = useTrackedWalletData(leaderWallets, { mode: "positions" });
  const tracked = useMemo(() => new Set(myWallets.map((wallet) => wallet.address.toLowerCase())), [myWallets]);
  const failed = useMemo(() => new Set(Object.keys(data.failed)), [data.failed]);

  const analysis = useMemo(() => {
    const pricing = data.pricing;
    const snapshots = new Map();
    const exposures = new Map();
    if (pricing) {
      for (const leader of leaders) {
        const raw = data.byAddress[leader.address];
        if (!raw) continue;
        const snapshot = buildWalletSnapshot({
          wallet: { address: leader.address, label: leader.label },
          clearinghouseEntries: raw.clearinghouseEntries,
          spotState: raw.spotState,
          stakingSummary: null,
          spotMetaAndAssetCtxs: pricing.spotMetaAndAssetCtxs,
          hypeMid: pricing.hypeMid,
        });
        snapshots.set(leader.address, snapshot);
        exposures.set(leader.address, assetExposure({ snapshot, spotState: raw.spotState, prices: pricing.prices, symbol }));
      }
    }

    const byCohort = (cohort) => leaders.filter((leader) => leader.cohort === cohort);
    const cohortSnapshots = (cohort) => byCohort(cohort).map((leader) => snapshots.get(leader.address)).filter(Boolean);
    const positioningByCohort = { buyer: buildPositioning(cohortSnapshots("buyer")), seller: buildPositioning(cohortSnapshots("seller")) };
    const liquidationWatch = buildLiquidationWatch([...snapshots.values()]);

    const markFromPositions = [...exposures.values()].find((exposure) => Number.isFinite(exposure.markPrice))?.markPrice;
    const mid = Number(pricing?.mids?.[market.candleCoin]);
    const markPrice = Number.isFinite(mid) && mid > 0 ? mid : markFromPositions ?? null;

    const signals = buildLeaderSignals({
      leaders,
      exposures,
      symbol,
      windowLabel: windowValue,
      markPrice,
      positioningByCohort,
      myAddresses: tracked,
      liquidationWatch,
    });

    const sideCount = (cohort, sides) =>
      byCohort(cohort).filter((leader) => sides.includes(exposures.get(leader.address)?.side)).length;

    return {
      snapshots,
      exposures,
      positioningByCohort,
      liquidationWatch,
      signals,
      buyers: byCohort("buyer"),
      sellers: byCohort("seller"),
      buyersNet: byCohort("buyer").reduce((sum, leader) => sum + leader.netUsd, 0),
      sellersNet: byCohort("seller").reduce((sum, leader) => sum + leader.netUsd, 0),
      buyersLong: sideCount("buyer", ["long", "spot"]),
      sellersShort: sideCount("seller", ["short"]),
      cohortLoaded: { buyer: cohortSnapshots("buyer").length, seller: cohortSnapshots("seller").length },
      equityUsd: [...snapshots.values()].reduce((sum, snapshot) => sum + snapshot.perpsUsd + snapshot.spotUsd, 0),
      twoSided: leaders.filter((leader) => leader.style === "two-sided").length,
    };
  }, [leaders, data.byAddress, data.pricing, symbol, windowValue, tracked, market.candleCoin]);

  const { progress } = data;
  const loadingLeaders = batchResource.isLoading && !batchResource.data;
  const hasSnapshots = analysis.snapshots.size > 0;
  const statusText = loadingLeaders
    ? "Loading leaders…"
    : progress.done
      ? `${progress.loaded} of ${progress.total} wallets loaded${progress.failed ? ` · ${progress.failed} failed` : ""}`
      : `Loading positions ${progress.loaded} of ${progress.total}…`;

  const onTrack = (leader) =>
    addWallet(leader.address, leader.label ?? `Top ${symbol} ${leader.cohort} (${windowValue})`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1">
        {MARKET_OPTIONS.map((option) => (
          <Chip key={option.marketId} active={option.marketId === market.marketId} onClick={() => setParam("market", option.marketId)}>
            {option.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-sm border border-border p-1">
          {LEADER_WINDOWS.map((value) => (
            <Chip key={value} active={value === windowValue} onClick={() => setParam("window", value)}>
              {value}
            </Chip>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          Top {LEADER_LIMIT} net buyers and sellers of {market.label} from Market Flow, with their live positions.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{statusText}</span>
          <button
            type="button"
            onClick={() => {
              setRefreshToken((token) => token + 1);
              data.refresh();
            }}
            disabled={!progress.done}
            className="flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {batchResource.error ? (
        <div className="rounded-sm border border-border bg-card p-4 text-sm text-muted-foreground">
          Couldn&apos;t load Market Flow leaders: {batchResource.error.message}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard label={`Top buyers net · ${windowValue}`} value={formatCompactSignedCurrency(analysis.buyersNet)} tone="positive" loading={loadingLeaders} />
        <MetricCard label={`Top sellers net · ${windowValue}`} value={formatCompactSignedCurrency(analysis.sellersNet)} tone="negative" loading={loadingLeaders} />
        <MetricCard
          label={`Buyers net long ${symbol}`}
          value={`${analysis.buyersLong} of ${analysis.buyers.length}`}
          loading={!hasSnapshots}
        />
        <MetricCard
          label={`Sellers net short ${symbol}`}
          value={`${analysis.sellersShort} of ${analysis.sellers.length}`}
          loading={!hasSnapshots}
        />
        <MetricCard label="Leaders' equity" value={formatCompactCurrency(analysis.equityUsd)} loading={!hasSnapshots} />
        <MetricCard label="Two-sided traders" value={`${analysis.twoSided} / ${leaders.length}`} loading={loadingLeaders} />
      </div>

      <Panel title="What they're doing" subtitle={`Read from their ${market.label} flow over ${windowValue} and their positions right now.`}>
        <SignalList signals={hasSnapshots ? analysis.signals : []} emptyText={loadingLeaders ? "Loading leaders…" : "Loading positions…"} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          ["buyer", "What the top buyers hold"],
          ["seller", "What the top sellers hold"],
        ].map(([cohort, title]) => (
          <Panel
            key={cohort}
            title={title}
            subtitle="Open perp notional across the group, all markets."
            actions={<ChartLegend items={[{ label: "Long", color: BUY_COLOR }, { label: "Short", color: SELL_COLOR }]} />}
          >
            {analysis.positioningByCohort[cohort].length ? (
              <PositioningChart rows={analysis.positioningByCohort[cohort].slice(0, COHORT_CHART_ROWS)} />
            ) : (
              <EmptyNote>
                {progress.done || analysis.cohortLoaded[cohort] === analysis[cohort === "buyer" ? "buyers" : "sellers"].length
                  ? "No open perp positions."
                  : "Loading positions…"}
              </EmptyNote>
            )}
          </Panel>
        ))}
      </div>

      {[
        ["buyer", `Top net buyers · ${market.label} · ${windowValue}`, analysis.buyers],
        ["seller", `Top net sellers · ${market.label} · ${windowValue}`, analysis.sellers],
      ].map(([cohort, title, rows]) => (
        <Panel
          key={cohort}
          title={title}
          subtitle={`Net and trades from Market Flow. "${symbol} now" is their live perp position plus spot balance. Two-sided wallets trade both directions heavily.`}
        >
          <LeadersTable
            leaders={rows}
            snapshots={analysis.snapshots}
            exposures={analysis.exposures}
            symbol={symbol}
            windowLabel={windowValue}
            tracked={tracked}
            onTrack={onTrack}
            failed={failed}
          />
        </Panel>
      ))}

      <Panel title="Liquidation watch" subtitle="Leaders' open positions within 50% of liquidation, closest first.">
        <LiquidationTable rows={analysis.liquidationWatch} />
      </Panel>
    </div>
  );
}
