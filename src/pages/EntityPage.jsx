import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import {
  fetchAllMids,
  fetchClearinghouseState,
  fetchDelegatorSummary,
  fetchSpotClearinghouseState,
  fetchSpotMetaAndAssetCtxs,
} from "../api/hyperliquid";
import { fetchEntity, fetchEntityWallets } from "../api/qwantify";
import { usePollingResource } from "../hooks/usePollingResource";
import { runWithConcurrency, withRetry } from "../lib/async";
import {
  MIN_DISPLAY_HYPE,
  normalizeEntity,
  normalizeEntityWallets,
  summarizeEntityBalances,
  summarizeWalletBalance,
} from "../lib/entities";
import { formatCount, formatCurrency, formatSignedCurrency, shortAddress } from "../lib/formatters";
import { EntityDescription, EntityTypeBadge } from "./EntitiesPage";

// Balances: main perps + xyz equity perps + spot, three wallets at a time.
// Staking is a heavier Hyperliquid request, so it runs afterwards, two at a time.
const BALANCE_CONCURRENCY = 3;
const STAKING_CONCURRENCY = 2;

const hypeAmount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function useEntityBalances(wallets) {
  const walletKey = wallets.map((wallet) => wallet.address).join(",");
  const [state, setState] = useState({ pricing: null, snapshots: {}, failed: {}, error: null });

  useEffect(() => {
    if (!walletKey) {
      return undefined;
    }

    const addresses = walletKey.split(",");
    let cancelled = false;
    const isCancelled = () => cancelled;
    setState({ pricing: null, snapshots: {}, failed: {}, error: null });

    const updateSnapshot = (address, patch) =>
      setState((previous) => ({
        ...previous,
        snapshots: {
          ...previous.snapshots,
          [address]: { ...previous.snapshots[address], ...patch },
        },
      }));
    const markFailed = (address, part) =>
      setState((previous) => ({
        ...previous,
        failed: { ...previous.failed, [address]: [...(previous.failed[address] ?? []), part] },
      }));

    (async () => {
      const [spotMetaAndAssetCtxs, mids] = await Promise.all([
        fetchSpotMetaAndAssetCtxs(),
        fetchAllMids(),
      ]);
      if (cancelled) {
        return;
      }
      setState((previous) => ({
        ...previous,
        pricing: { spotMetaAndAssetCtxs, hypeMid: Number(mids?.HYPE) },
      }));

      await runWithConcurrency(addresses, BALANCE_CONCURRENCY, async (address) => {
        if (cancelled) {
          return;
        }
        try {
          const [main, xyz, spotState] = await withRetry(
            () =>
              Promise.all([
                fetchClearinghouseState({ user: address, dex: "" }),
                fetchClearinghouseState({ user: address, dex: "xyz" }),
                fetchSpotClearinghouseState({ user: address }),
              ]),
            { isCancelled },
          );
          if (!cancelled) {
            updateSnapshot(address, {
              clearinghouseEntries: [
                { dex: "", state: main },
                { dex: "xyz", state: xyz },
              ],
              spotState,
            });
          }
        } catch {
          if (!cancelled) {
            markFailed(address, "balances");
          }
        }
      });

      await runWithConcurrency(addresses, STAKING_CONCURRENCY, async (address) => {
        if (cancelled) {
          return;
        }
        try {
          const stakingSummary = await withRetry(
            () => fetchDelegatorSummary({ user: address }),
            { isCancelled },
          );
          if (!cancelled) {
            updateSnapshot(address, { stakingSummary });
          }
        } catch {
          if (!cancelled) {
            markFailed(address, "staking");
          }
        }
      });
    })().catch((error) => {
      if (!cancelled) {
        setState((previous) => ({ ...previous, error }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [walletKey]);

  const balances = useMemo(() => {
    const result = {};
    if (!state.pricing) {
      return result;
    }
    Object.entries(state.snapshots).forEach(([address, snapshot]) => {
      if (!snapshot.clearinghouseEntries) {
        return;
      }
      result[address] = summarizeWalletBalance({
        clearinghouseEntries: snapshot.clearinghouseEntries,
        spotState: snapshot.spotState,
        stakingSummary: snapshot.stakingSummary ?? null,
        spotMetaAndAssetCtxs: state.pricing.spotMetaAndAssetCtxs,
        hypeMid: state.pricing.hypeMid,
      });
    });
    return result;
  }, [state.pricing, state.snapshots]);

  return { balances, failed: state.failed, error: state.error, hypeMid: state.pricing?.hypeMid ?? null };
}

function StatCard({ label, value, detail }) {
  return (
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-medium tabular-nums">{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function Pending() {
  return <span className="text-muted-foreground">···</span>;
}

export default function EntityPage() {
  const { entityId = "" } = useParams();

  const entityResource = usePollingResource(() => fetchEntity(entityId), [entityId], {
    enabled: Boolean(entityId),
    cacheKey: `entities:${entityId}`,
    staleTimeMs: 300_000,
  });
  const walletsResource = usePollingResource(() => fetchEntityWallets(entityId), [entityId], {
    enabled: Boolean(entityId),
    initialData: [],
    cacheKey: `entities:${entityId}:wallets`,
    staleTimeMs: 300_000,
  });

  const entity = entityResource.data ? normalizeEntity(entityResource.data) : null;
  const wallets = useMemo(() => normalizeEntityWallets(walletsResource.data), [walletsResource.data]);
  const { balances, failed, error: balanceError } = useEntityBalances(wallets);

  const summary = useMemo(
    () => summarizeEntityBalances(wallets.map((wallet) => balances[wallet.address] ?? null)),
    [wallets, balances],
  );
  const failedCount = Object.keys(failed).length;
  const balancesDone = summary.loadedCount + Object.values(failed).filter((parts) => parts.includes("balances")).length;
  const stakingDone = summary.stakingLoadedCount + Object.values(failed).filter((parts) => parts.includes("staking")).length;
  const isLoadingBalances = wallets.length > 0 && balancesDone < wallets.length;
  const isLoadingStaking = wallets.length > 0 && stakingDone < wallets.length;

  const rows = useMemo(
    () =>
      wallets
        .map((wallet) => ({ ...wallet, balance: balances[wallet.address] ?? null }))
        .sort((left, right) => (right.balance?.totalUsd ?? -1) - (left.balance?.totalUsd ?? -1)),
    [wallets, balances],
  );

  if (entityResource.error && !entity) {
    return (
      <div className="rounded-sm border border-border bg-card p-6 text-sm text-muted-foreground">
        Failed to load this entity: {entityResource.error.message}{" "}
        <Link to="/entities" className="underline">
          Back to entities
        </Link>
      </div>
    );
  }

  if (!entity) {
    return <div className="text-sm text-muted-foreground">Loading entity…</div>;
  }

  const progress = isLoadingBalances
    ? `Loading balances: ${balancesDone} of ${wallets.length} wallets`
    : isLoadingStaking
      ? `Loading staked HYPE: ${stakingDone} of ${wallets.length} wallets`
      : `All ${wallets.length} wallets`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          to="/entities"
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Entities
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-medium">{entity.name}</h1>
          <EntityTypeBadge type={entity.type} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>
            {wallets.length} linked wallet{wallets.length === 1 ? "" : "s"}
          </span>
          {entity.trackFills ? <span>· Tracking fills</span> : null}
          {entity.twitterHandle && entity.twitterUrl ? (
            <a href={entity.twitterUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
              · {entity.twitterHandle}
            </a>
          ) : null}
        </div>
        {entity.description ? (
          <div className="text-sm">
            <EntityDescription text={entity.description} />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Net worth"
          value={summary.loadedCount ? formatCurrency(summary.totalUsd) : "—"}
          detail={progress}
        />
        <StatCard
          label="Perps equity"
          value={summary.loadedCount ? formatCurrency(summary.perpsUsd) : "—"}
          detail={
            summary.openPositions
              ? `${summary.openPositions} open position${summary.openPositions === 1 ? "" : "s"} · ${formatCurrency(summary.notionalUsd)} notional · ${formatSignedCurrency(summary.unrealizedPnlUsd)} uPnL`
              : "No open perps"
          }
        />
        <StatCard
          label="Spot"
          value={summary.loadedCount ? formatCurrency(summary.spotUsd) : "—"}
          detail="HyperCore spot balances at mid"
        />
        <StatCard
          label="Staked HYPE"
          value={summary.stakingLoadedCount ? formatCurrency(summary.stakedUsd) : "—"}
          detail={
            summary.stakingLoadedCount
              ? `${hypeAmount.format(summary.stakedHype)} HYPE across ${summary.stakingWalletCount} wallet${summary.stakingWalletCount === 1 ? "" : "s"}`
              : "Delegated, undelegated and unstaking"
          }
        />
      </div>

      {balanceError ? (
        <div className="rounded-sm border border-border bg-card p-4 text-sm text-muted-foreground">
          Couldn&apos;t load prices from Hyperliquid: {balanceError.message}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-sm border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-light">Wallet</th>
              <th className="px-4 py-3 font-light">Type</th>
              <th className="px-4 py-3 text-right font-light">Perps</th>
              <th className="px-4 py-3 text-right font-light">Spot</th>
              <th className="px-4 py-3 text-right font-light">Staked HYPE</th>
              <th className="px-4 py-3 text-right font-light">Total</th>
              <th className="px-4 py-3 text-right font-light">Positions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const balance = row.balance;
              const parts = failed[row.address] ?? [];
              const balanceFailed = parts.includes("balances");
              const stakingFailed = parts.includes("staking");
              const cell = (value) =>
                balance ? value : balanceFailed ? <span className="text-muted-foreground">failed</span> : <Pending />;

              return (
                <tr key={row.address} className="border-b border-border/60 last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      to={`/wallets/${row.address}`}
                      className="font-mono text-xs hover:underline"
                      title={row.address}
                    >
                      {shortAddress(row.address)}
                    </Link>
                    {row.label ? <div className="text-xs text-muted-foreground">{row.label}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                    {row.type ?? "—"}
                    {row.relation && row.relation !== "owned" ? ` · ${row.relation}` : ""}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{cell(formatCurrency(balance?.perpsUsd))}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{cell(formatCurrency(balance?.spotUsd))}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {balance && balance.stakedHype !== null ? (
                      <>
                        {formatCurrency(balance.stakedUsd)}
                        {balance.stakedHype >= MIN_DISPLAY_HYPE ? (
                          <div className="text-xs text-muted-foreground">{hypeAmount.format(balance.stakedHype)} HYPE</div>
                        ) : null}
                      </>
                    ) : stakingFailed ? (
                      <span className="text-muted-foreground">failed</span>
                    ) : (
                      <Pending />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {cell(formatCurrency(balance?.totalUsd))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {cell(balance?.openPositions ? formatCount(balance.openPositions) : "—")}
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {walletsResource.isLoading ? "Loading wallets…" : "This entity has no linked wallets."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Entity and wallet list from Qwantify. Balances are live from Hyperliquid: main and xyz
        (equity) perps, HyperCore spot, and staked HYPE, priced at mid. HyperEVM balances aren&apos;t
        included.
        {failedCount ? ` ${failedCount} wallet${failedCount === 1 ? "" : "s"} couldn't be loaded.` : ""}
      </p>
    </div>
  );
}
