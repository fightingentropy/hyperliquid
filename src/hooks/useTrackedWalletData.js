import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAllClearinghouseStates,
  fetchAllMids,
  fetchAllUserFills,
  fetchDelegatorSummary,
  fetchSpotClearinghouseState,
  fetchSpotMetaAndAssetCtxs,
  fetchUserFills,
  fetchUserNonFundingLedgerUpdates,
} from "../api/hyperliquid";
import { runWithConcurrency, withRetry } from "../lib/async";
import { MAX_FLOW_WINDOW_MS, buildSpotPairNames } from "../lib/trackedWallets";
import { buildSpotPriceMap } from "../lib/wallet";

// Each wallet costs roughly 80 Hyperliquid request weight (positions on every
// perp dex, spot, staking, a week of fills and ledger updates). Three at a time
// keeps a dozen tracked wallets well inside the 1200/minute budget.
const WALLET_CONCURRENCY = 3;

async function loadWallet(address, since, isCancelled) {
  const retry = (load) => withRetry(load, { isCancelled });
  const [clearinghouseEntries, spotState, stakingSummary, fills, ledger] = await Promise.all([
    retry(() => fetchAllClearinghouseStates({ user: address })),
    retry(() => fetchSpotClearinghouseState({ user: address })),
    retry(() => fetchDelegatorSummary({ user: address })),
    retry(() => fetchAllUserFills({ user: address, startTime: since })),
    retry(() => fetchUserNonFundingLedgerUpdates({ user: address, startTime: since })),
  ]);

  let lastTradeAt = fills.reduce((latest, fill) => Math.max(latest, Number(fill.time) || 0), 0) || null;
  if (!lastTradeAt) {
    // Quiet this week: the most recent fills say when it last traded at all.
    const recent = await retry(() => fetchUserFills({ user: address, aggregateByTime: true }));
    lastTradeAt = (Array.isArray(recent) ? recent : []).reduce((latest, fill) => Math.max(latest, Number(fill.time) || 0), 0) || null;
  }

  return {
    clearinghouseEntries,
    spotState,
    stakingSummary,
    fills: Array.isArray(fills) ? fills : [],
    ledger: Array.isArray(ledger) ? ledger : [],
    lastTradeAt,
  };
}

export function useTrackedWalletData(wallets) {
  const walletKey = wallets.map((wallet) => wallet.address.toLowerCase()).join(",");
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState({ pricing: null, byAddress: {}, failed: {}, loadedAt: null, error: null, since: null });

  useEffect(() => {
    if (!walletKey) {
      return undefined;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;
    const addresses = walletKey.split(",");
    const since = Date.now() - MAX_FLOW_WINDOW_MS;
    setState((previous) => ({ ...previous, failed: {}, error: null, since, loadedAt: null }));

    (async () => {
      const [spotMetaAndAssetCtxs, mids] = await Promise.all([
        withRetry(() => fetchSpotMetaAndAssetCtxs(), { isCancelled }),
        withRetry(() => fetchAllMids(), { isCancelled }),
      ]);
      if (cancelled) {
        return;
      }
      setState((previous) => ({
        ...previous,
        pricing: {
          spotMetaAndAssetCtxs,
          hypeMid: Number(mids?.HYPE),
          prices: buildSpotPriceMap(spotMetaAndAssetCtxs),
          spotPairNames: buildSpotPairNames(spotMetaAndAssetCtxs),
        },
      }));

      await runWithConcurrency(addresses, WALLET_CONCURRENCY, async (address) => {
        if (cancelled) {
          return;
        }
        try {
          const data = await loadWallet(address, since, isCancelled);
          if (!cancelled) {
            setState((previous) => ({ ...previous, byAddress: { ...previous.byAddress, [address]: data } }));
          }
        } catch (error) {
          if (!cancelled) {
            setState((previous) => ({ ...previous, failed: { ...previous.failed, [address]: error } }));
          }
        }
      });

      if (!cancelled) {
        setState((previous) => ({ ...previous, loadedAt: Date.now() }));
      }
    })().catch((error) => {
      if (!cancelled) {
        setState((previous) => ({ ...previous, error }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [walletKey, refreshToken]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  const progress = useMemo(() => {
    const addresses = walletKey ? walletKey.split(",") : [];
    const loaded = addresses.filter((address) => state.byAddress[address]).length;
    const failed = addresses.filter((address) => state.failed[address]).length;
    return { total: addresses.length, loaded, failed, done: state.loadedAt !== null };
  }, [walletKey, state.byAddress, state.failed, state.loadedAt]);

  return { ...state, progress, refresh };
}
