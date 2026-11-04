import { useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import FlowLeadersView from "../components/FlowLeadersView";
import MetricCard from "../components/MetricCard";
import {
  BUY_COLOR,
  ChartLegend,
  FlowTimelineChart,
  NetFlowChart,
  PositioningChart,
  SELL_COLOR,
} from "../components/TrackedWalletCharts";
import WalletFormModal from "../components/WalletFormModal";
import {
  Chip,
  EmptyNote,
  LIQUIDATION_RANGE_PCT,
  LiquidationTable,
  Panel,
  SignalList,
  WalletLink,
  formatAgo,
  formatDuration,
  formatTradeTime,
  signedClass,
} from "../components/TrackedWalletUi";

import { useTrackedWalletData } from "../hooks/useTrackedWalletData";
import { useWallets } from "../hooks/useWallets";
import { cx } from "../lib/cx";
import {
  formatCompactCurrency,
  formatCompactSignedCurrency,
  formatPrice,
} from "../lib/formatters";
import {
  FLOW_WINDOWS,
  MAX_FLOW_WINDOW_MS,
  buildBigMoves,
  buildCapitalFlows,
  buildFlowTimeline,
  buildLiquidationWatch,
  buildNetFlows,
  buildPositioning,
  buildSharedCounterparties,
  buildSignals,
  buildWalletSnapshot,
  walletDisplayName,
} from "../lib/trackedWallets";

const CHART_ROWS = 10;
const MATRIX_ASSETS = 8;
const TIMELINE_ASSETS = 6;

function heatStyle(value, max) {
  if (!value || !max) {
    return undefined;
  }
  const share = Math.min(1, Math.abs(value) / max);
  if (share < 0.03) {
    return undefined;
  }
  const percent = Math.round(10 + share * 50);
  const color = value > 0 ? BUY_COLOR : SELL_COLOR;
  return { backgroundColor: `color-mix(in srgb, ${color} ${percent}%, transparent)` };
}

function FlowMatrix({ assets, byWallet }) {
  const columns = assets.slice(0, MATRIX_ASSETS).map((asset) => asset.symbol);
  const rows = byWallet.filter((row) => row.trades > 0);
  const max = Math.max(0, ...rows.flatMap((row) => columns.map((symbol) => Math.abs(row.netByAsset[symbol] ?? 0))));

  if (!rows.length) {
    return <EmptyNote>No trades in this window.</EmptyNote>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-light">Wallet</th>
            {columns.map((symbol) => (
              <th key={symbol} className="px-3 py-2 text-right font-light">
                {symbol}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-light">All assets</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.address} className="border-t border-border/60">
              <td className="whitespace-nowrap px-3 py-2">
                <WalletLink address={row.address} name={row.name} />
              </td>
              {columns.map((symbol) => {
                const value = row.netByAsset[symbol] ?? 0;
                return (
                  <td key={symbol} className="px-3 py-2 text-right tabular-nums" style={heatStyle(value, max)}>
                    {value ? formatCompactSignedCurrency(value) : <span className="text-muted-foreground">·</span>}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCompactSignedCurrency(row.netUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function flowBreakdown(row) {
  const parts = [];
  const add = (value, label) => {
    if (value >= 1) parts.push(`${label} ${formatCompactCurrency(value)}`);
  };
  add(row.bridgeInUsd, "deposited");
  add(row.bridgeOutUsd, "withdrew");
  add(row.evmInUsd, "from HyperEVM");
  add(row.evmOutUsd, "to HyperEVM");
  add(row.transferInUsd, "received");
  add(row.transferOutUsd, "sent");
  if (row.stakedHype >= 1) parts.push(`staked ${Math.round(row.stakedHype).toLocaleString("en-US")} HYPE`);
  if (row.unstakedHype >= 1) parts.push(`unstaked ${Math.round(row.unstakedHype).toLocaleString("en-US")} HYPE`);
  return parts.join(" · ");
}

function SharedCounterparties({ rows }) {
  const shared = buildSharedCounterparties(rows);
  if (!shared.length) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 px-3 pt-3 text-xs">
      <span className="uppercase tracking-wide text-muted-foreground">Shared counterparties</span>
      {shared.map((party) => (
        <div key={party.address} className="text-muted-foreground">
          <Link to={`/wallets/${party.address}`} className="qf-quiet-link font-mono">
            {party.address.slice(0, 6)}…{party.address.slice(-4)}
          </Link>{" "}
          {party.wallets
            .map((wallet) => {
              const parts = [];
              if (wallet.inUsd) parts.push(`sent ${formatCompactCurrency(wallet.inUsd)} to ${wallet.name}`);
              if (wallet.outUsd) parts.push(`received ${formatCompactCurrency(wallet.outUsd)} from ${wallet.name}`);
              return parts.join(", ");
            })
            .join(" · ")}
        </div>
      ))}
    </div>
  );
}

function CapitalFlowsTable({ rows }) {
  const active = rows.filter((row) => row.events > 0).sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd));
  if (!active.length) {
    return <EmptyNote>No deposits, withdrawals or transfers in this window.</EmptyNote>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-light">Wallet</th>
            <th className="px-3 py-2 text-right font-light">In</th>
            <th className="px-3 py-2 text-right font-light">Out</th>
            <th className="px-3 py-2 text-right font-light">Net</th>
            <th className="px-3 py-2 font-light">Breakdown</th>
          </tr>
        </thead>
        <tbody>
          {active.map((row) => (
            <tr key={row.address} className="border-t border-border/60">
              <td className="whitespace-nowrap px-3 py-2">
                <WalletLink address={row.address} name={row.name} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{row.inUsd ? formatCompactCurrency(row.inUsd) : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.outUsd ? formatCompactCurrency(row.outUsd) : "—"}</td>
              <td className={cx("px-3 py-2 text-right font-medium tabular-nums", signedClass(row.netUsd))}>
                {formatCompactSignedCurrency(row.netUsd)}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{flowBreakdown(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SharedCounterparties rows={rows} />
    </div>
  );
}

function BigTradesTable({ trades }) {
  if (!trades.length) {
    return <EmptyNote>No trades in this window.</EmptyNote>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-light">When</th>
            <th className="px-3 py-2 font-light">Wallet</th>
            <th className="px-3 py-2 font-light">Move</th>
            <th className="px-3 py-2 text-right font-light">Avg price</th>
            <th className="px-3 py-2 text-right font-light">Notional</th>
            <th className="px-3 py-2 text-right font-light">Realized</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.key} className="border-t border-border/60">
              <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                {formatTradeTime(trade.firstAt)}
                {trade.lastAt - trade.firstAt >= 60_000 ? ` → ${formatDuration(trade.lastAt - trade.firstAt)}` : ""}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <WalletLink address={trade.address} name={trade.name} />
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <span className={trade.side === "B" ? "text-profit" : "text-loss"}>{trade.dir}</span>{" "}
                <span className="font-medium">{trade.symbol}</span>
                {trade.market !== "perp" ? <span className="text-xs text-muted-foreground"> · {trade.market}</span> : null}
                {trade.isTwap ? <span className="text-xs text-muted-foreground"> · TWAP</span> : null}
                {trade.fills > 1 ? <span className="text-xs text-muted-foreground"> · {trade.fills} fills</span> : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatPrice(trade.avgPrice)}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCompactCurrency(trade.notionalUsd)}</td>
              <td className={cx("px-3 py-2 text-right tabular-nums", signedClass(trade.realizedPnlUsd))}>
                {trade.realizedPnlUsd ? formatCompactSignedCurrency(trade.realizedPnlUsd) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WalletsTable({ rows, now }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-light">Wallet</th>
            <th className="px-3 py-2 text-right font-light">Equity</th>
            <th className="px-3 py-2 text-right font-light">Long</th>
            <th className="px-3 py-2 text-right font-light">Short</th>
            <th className="px-3 py-2 text-right font-light">Leverage</th>
            <th className="px-3 py-2 text-right font-light">Unrealized</th>
            <th className="px-3 py-2 text-right font-light">Net bought</th>
            <th className="px-3 py-2 text-right font-light">Realized</th>
            <th className="px-3 py-2 text-right font-light">Last trade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.address} className="border-t border-border/60">
              <td className="whitespace-nowrap px-3 py-2">
                <WalletLink address={row.address} name={row.name} />
              </td>
              {row.snapshot ? (
                <>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCompactCurrency(row.snapshot.equityUsd)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.snapshot.longUsd ? formatCompactCurrency(row.snapshot.longUsd) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.snapshot.shortUsd ? formatCompactCurrency(row.snapshot.shortUsd) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {row.snapshot.leverage ? `${row.snapshot.leverage.toFixed(1)}x` : "—"}
                  </td>
                  <td className={cx("px-3 py-2 text-right tabular-nums", signedClass(row.snapshot.unrealizedPnlUsd))}>
                    {row.snapshot.unrealizedPnlUsd ? formatCompactSignedCurrency(row.snapshot.unrealizedPnlUsd) : "—"}
                  </td>
                  <td className={cx("px-3 py-2 text-right tabular-nums", signedClass(row.flow?.netUsd))}>
                    {row.flow?.trades ? formatCompactSignedCurrency(row.flow.netUsd) : "—"}
                  </td>
                  <td className={cx("px-3 py-2 text-right tabular-nums", signedClass(row.realizedAfterFeesUsd))}>
                    {row.flow?.trades ? formatCompactSignedCurrency(row.realizedAfterFeesUsd) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted-foreground">{formatAgo(row.lastTradeAt, now)}</td>
                </>
              ) : (
                <td colSpan={8} className="px-3 py-2 text-right text-xs text-muted-foreground">
                  {row.failed ? "Couldn't load this wallet" : "Loading…"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MyWalletsView() {
  const { wallets, addWallet } = useWallets();
  const [windowValue, setWindowValue] = useState("7d");
  const [timelineSymbol, setTimelineSymbol] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const data = useTrackedWalletData(wallets);
  const flowWindow = FLOW_WINDOWS.find((window) => window.value === windowValue) ?? FLOW_WINDOWS[1];
  // Anchor windows to when this load started, so they don't drift while wallets stream in.
  const now = data.loadedAt ?? (data.since ? data.since + MAX_FLOW_WINDOW_MS : 0);
  const since = now - flowWindow.ms;

  const analysis = useMemo(() => {
    const pricing = data.pricing;
    const loaded = wallets
      .map((wallet) => ({ wallet, raw: data.byAddress[wallet.address.toLowerCase()] }))
      .filter((entry) => entry.raw);

    const snapshots = pricing
      ? loaded.map(({ wallet, raw }) =>
          buildWalletSnapshot({
            wallet,
            clearinghouseEntries: raw.clearinghouseEntries,
            spotState: raw.spotState,
            stakingSummary: raw.stakingSummary,
            spotMetaAndAssetCtxs: pricing.spotMetaAndAssetCtxs,
            hypeMid: pricing.hypeMid,
          }),
        )
      : [];
    const walletFills = loaded.map(({ wallet, raw }) => ({ wallet, fills: raw.fills }));
    const spotPairNames = pricing?.spotPairNames;
    const positioning = buildPositioning(snapshots);
    const netFlows = buildNetFlows(walletFills, { since, spotPairNames });
    const liquidationWatch = buildLiquidationWatch(snapshots);
    const capitalFlows = buildCapitalFlows(
      loaded.map(({ wallet, raw }) => ({ wallet, ledger: raw.ledger })),
      { since, prices: pricing?.prices },
    );
    const bigTrades = buildBigMoves(walletFills, { since, spotPairNames });
    const signals = buildSignals({
      positioning,
      netFlows,
      liquidationWatch,
      snapshots,
      capitalFlows,
      windowLabel: flowWindow.label,
    });

    const totals = snapshots.reduce(
      (sum, snapshot) => ({
        equityUsd: sum.equityUsd + snapshot.equityUsd,
        longUsd: sum.longUsd + snapshot.longUsd,
        shortUsd: sum.shortUsd + snapshot.shortUsd,
        unrealizedPnlUsd: sum.unrealizedPnlUsd + snapshot.unrealizedPnlUsd,
      }),
      { equityUsd: 0, longUsd: 0, shortUsd: 0, unrealizedPnlUsd: 0 },
    );

    const flowByAddress = new Map(netFlows.byWallet.map((row) => [row.address, row]));
    const snapshotByAddress = new Map(snapshots.map((snapshot) => [snapshot.wallet.address, snapshot]));
    const walletRows = wallets
      .map((wallet) => ({
        address: wallet.address,
        name: walletDisplayName(wallet),
        snapshot: snapshotByAddress.get(wallet.address) ?? null,
        flow: flowByAddress.get(wallet.address) ?? null,
        realizedAfterFeesUsd: (flowByAddress.get(wallet.address)?.realizedPnlUsd ?? 0) - (flowByAddress.get(wallet.address)?.feesUsd ?? 0),
        lastTradeAt: data.byAddress[wallet.address.toLowerCase()]?.lastTradeAt ?? null,
        failed: Boolean(data.failed[wallet.address.toLowerCase()]),
      }))
      .sort((a, b) => (b.snapshot?.equityUsd ?? -1) - (a.snapshot?.equityUsd ?? -1));

    return { snapshots, walletFills, positioning, netFlows, liquidationWatch, capitalFlows, bigTrades, signals, totals, walletRows, spotPairNames };
  }, [wallets, data.byAddress, data.failed, data.pricing, since, flowWindow.label]);

  const timelineChoices = useMemo(
    () => [...analysis.netFlows.assets].sort((a, b) => b.grossUsd - a.grossUsd).slice(0, TIMELINE_ASSETS).map((asset) => asset.symbol),
    [analysis.netFlows.assets],
  );
  const activeTimelineSymbol = timelineSymbol && timelineChoices.includes(timelineSymbol) ? timelineSymbol : null;
  const timeline = useMemo(
    () =>
      buildFlowTimeline(analysis.walletFills, {
        since,
        until: now,
        bucketMs: flowWindow.bucketMs,
        symbol: activeTimelineSymbol,
        spotPairNames: analysis.spotPairNames,
      }),
    [analysis.walletFills, analysis.spotPairNames, since, now, flowWindow.bucketMs, activeTimelineSymbol],
  );

  const { progress } = data;
  const hasData = analysis.snapshots.length > 0;
  const netExposure = analysis.totals.longUsd - analysis.totals.shortUsd;
  const flowTotals = analysis.netFlows.totals;
  const realizedAfterFees = flowTotals.realizedPnlUsd - flowTotals.feesUsd;
  const statusText = progress.done
    ? `Updated ${new Date(data.loadedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} · ${progress.loaded} of ${progress.total} wallets${progress.failed ? ` · ${progress.failed} failed` : ""}`
    : `Loading ${progress.loaded} of ${progress.total} wallets…`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {wallets.map((wallet) => (
          <Link
            key={wallet.address}
            to={`/wallets/${wallet.address}`}
            className="qf-quiet-link rounded-sm border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted/50"
          >
            {walletDisplayName(wallet)}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1 rounded-sm border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-label="Track another wallet"
        >
          <Plus className="size-3.5" />
          Track wallet
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{statusText}</span>
          <button
            type="button"
            onClick={data.refresh}
            disabled={!progress.done}
            className="flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </button>
          <div className="flex items-center gap-1 rounded-sm border border-border p-1">
            {FLOW_WINDOWS.map((window) => (
              <Chip key={window.value} active={window.value === windowValue} onClick={() => setWindowValue(window.value)}>
                {window.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {data.error ? (
        <div className="rounded-sm border border-border bg-card p-4 text-sm text-muted-foreground">
          Couldn&apos;t load market data from Hyperliquid: {data.error.message}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Tracked equity" value={formatCompactCurrency(analysis.totals.equityUsd)} loading={!hasData} />
        <MetricCard label="Long exposure" value={formatCompactCurrency(analysis.totals.longUsd)} loading={!hasData} />
        <MetricCard label="Short exposure" value={formatCompactCurrency(analysis.totals.shortUsd)} loading={!hasData} />
        <MetricCard
          label="Net exposure"
          value={formatCompactSignedCurrency(netExposure)}
          tone={netExposure > 0 ? "positive" : netExposure < 0 ? "negative" : "neutral"}
          loading={!hasData}
        />
        <MetricCard
          label={`Net bought · ${flowWindow.label}`}
          value={formatCompactSignedCurrency(flowTotals.netUsd)}
          tone={flowTotals.netUsd > 0 ? "positive" : flowTotals.netUsd < 0 ? "negative" : "neutral"}
          loading={!hasData}
        />
        <MetricCard
          label={`Realized · ${flowWindow.label}`}
          value={formatCompactSignedCurrency(realizedAfterFees)}
          tone={realizedAfterFees > 0 ? "positive" : realizedAfterFees < 0 ? "negative" : "neutral"}
          loading={!hasData}
        />
      </div>

      <Panel title="What stands out" subtitle={`Read from live positions plus the last ${flowWindow.label} of trades and transfers.`}>
        <SignalList signals={analysis.signals} emptyText={hasData ? "Nothing notable yet in this window." : "Loading wallets…"} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Positioning by asset"
          subtitle="Open perp notional across tracked wallets. Hover a row for who holds what."
          actions={<ChartLegend items={[{ label: "Long", color: BUY_COLOR }, { label: "Short", color: SELL_COLOR }]} />}
        >
          {analysis.positioning.length ? (
            <PositioningChart rows={analysis.positioning.slice(0, CHART_ROWS)} />
          ) : (
            <EmptyNote>{hasData ? "No open positions." : "Loading positions…"}</EmptyNote>
          )}
        </Panel>

        <Panel
          title={`Net buying and selling · ${flowWindow.label}`}
          subtitle="Buys minus sells, perps and spot combined. Buys include covering shorts."
          actions={<ChartLegend items={[{ label: "Net bought", color: BUY_COLOR }, { label: "Net sold", color: SELL_COLOR }]} />}
        >
          {analysis.netFlows.assets.length ? (
            <NetFlowChart rows={analysis.netFlows.assets.slice(0, CHART_ROWS)} />
          ) : (
            <EmptyNote>{hasData ? "No trades in this window." : "Loading trades…"}</EmptyNote>
          )}
        </Panel>
      </div>

      <Panel
        title={`Flow over time · ${flowWindow.label}`}
        subtitle={`Bought above the line, sold below, per ${flowWindow.bucketMs >= 6 * 60 * 60 * 1000 ? "6 hours" : "hour"}.`}
        actions={<ChartLegend items={[{ label: "Bought", color: BUY_COLOR }, { label: "Sold", color: SELL_COLOR }]} />}
      >
        <div className="flex flex-wrap items-center gap-1">
          <Chip active={!activeTimelineSymbol} onClick={() => setTimelineSymbol(null)}>
            All assets
          </Chip>
          {timelineChoices.map((symbol) => (
            <Chip key={symbol} active={activeTimelineSymbol === symbol} onClick={() => setTimelineSymbol(symbol)}>
              {symbol}
            </Chip>
          ))}
        </div>
        {analysis.netFlows.totals.trades ? (
          <FlowTimelineChart buckets={timeline} bucketMs={flowWindow.bucketMs} symbol={activeTimelineSymbol} />
        ) : (
          <EmptyNote>{hasData ? "No trades in this window." : "Loading trades…"}</EmptyNote>
        )}
      </Panel>

      <Panel
        title={`Who traded what · ${flowWindow.label}`}
        subtitle="Net bought (+) or sold (−) per wallet and asset. Darker cells are bigger moves."
      >
        <FlowMatrix assets={analysis.netFlows.assets} byWallet={analysis.netFlows.byWallet} />
      </Panel>

      <Panel
        title="Liquidation watch"
        subtitle={`Open positions within ${LIQUIDATION_RANGE_PCT}% of liquidation, closest first. Under 15% is flagged.`}
      >
        <LiquidationTable rows={analysis.liquidationWatch} />
      </Panel>

      <Panel
        title={`Capital flows · ${flowWindow.label}`}
        subtitle="Bridge deposits and withdrawals, HyperEVM moves and transfers with other wallets. Moves between a wallet's own spot and perp balances are left out."
      >
        <CapitalFlowsTable rows={analysis.capitalFlows} />
      </Panel>

      <Panel
        title={`Biggest moves · ${flowWindow.label}`}
        subtitle="Runs of fills on one market in one direction, merged when less than 2 hours apart. Largest notional first."
      >
        <BigTradesTable trades={analysis.bigTrades} />
      </Panel>

      <Panel title="Wallets" subtitle={`Equity is perps, spot and staked HYPE. Net bought and realized (after fees) cover the last ${flowWindow.label}.`}>
        <WalletsTable rows={analysis.walletRows} now={now} />
      </Panel>

      <WalletFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={({ address, label }) => addWallet(address, label)}
        title="Track a wallet"
      />
    </div>
  );
}

const VIEWS = [
  { value: "mine", label: "My wallets" },
  { value: "leaders", label: "Market flow leaders" },
];

export default function TrackedWalletsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { wallets, addWallet } = useWallets();
  const view = searchParams.get("view") === "leaders" ? "leaders" : "mine";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-fit items-center gap-1 rounded-sm border border-border p-1" role="tablist" aria-label="Wallet set">
        {VIEWS.map((option) => (
          <Chip
            key={option.value}
            active={view === option.value}
            onClick={() => setSearchParams(option.value === "leaders" ? { view: "leaders" } : {}, { replace: true })}
          >
            {option.label}
          </Chip>
        ))}
      </div>
      {view === "leaders" ? <FlowLeadersView myWallets={wallets} addWallet={addWallet} /> : <MyWalletsView />}
    </div>
  );
}
