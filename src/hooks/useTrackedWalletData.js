import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAllClearinghouseStates,
  fetchAllMids,
  fetchClearinghouseState,
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
// "positions" mode (market-flow leaders, ~50 wallets) skips staking, fills and
// ledger and reads only the main and xyz perp dexes plus spot: ~6 weight each.
const POSITIONS_CONCURRENCY = 4;

async function loadPositions(address, isCancelled) {
  const retry = (load) => withRetry(load, { isCancelled });
  const [main, xyz, spotState] = await Promise.all([
    retry(() => fetchClearinghouseState({ user: address, dex: "" })),
    retry(() => fetchClearinghouseState({ user: address, dex: "xyz" })),
    retry(() => fetchSpotClearinghouseState({ user: address })),
  ]);
  return {
    clearinghouseEntries: [
      { dex: "", state: main },
      { dex: "xyz", state: xyz },
    ],
    spotState,
    stakingSummary: null,
    fills: [],
    ledger: [],
    lastTradeAt: null,
  };
}

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

export function useTrackedWalletData(wallets, { mode = "full" } = {}) {
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
          mids,
        },
      }));

      const concurrency = mode === "positions" ? POSITIONS_CONCURRENCY : WALLET_CONCURRENCY;
      await runWithConcurrency(addresses, concurrency, async (address) => {
        if (cancelled) {
          return;
        }
        try {
          const data =
            mode === "positions" ? await loadPositions(address, isCancelled) : await loadWallet(address, since, isCancelled);
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
  }, [walletKey, refreshToken, mode]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  const progress = useMemo(() => {
    const addresses = walletKey ? walletKey.split(",") : [];
    const loaded = addresses.filter((address) => state.byAddress[address]).length;
    const failed = addresses.filter((address) => state.failed[address]).length;
    return { total: addresses.length, loaded, failed, done: state.loadedAt !== null };
  }, [walletKey, state.byAddress, state.failed, state.loadedAt]);

  return { ...state, progress, refresh };
}
