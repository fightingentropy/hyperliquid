import { useEffect, useRef, useState } from "react";
import { fetchSpotMetaAndAssetCtxs } from "../api/hyperliquid";
import { requestJson } from "../api/request";
import {
  activeTwapsFromState,
  createTwapTrackerState,
  reconcileHypeTwaps,
  selectHypeSpotPriceByAssetId,
} from "../lib/hypurrscan";

const TWAP_FEED_URL = "https://api.hypurrscan.io/twap/*";
// HypurrScan polls this feed every 5s; 7s keeps us in step without hammering it.
const POLL_INTERVAL_MS = 7_000;

// Maintains a live HYPE TWAP active-set by polling the public feed and folding
// each snapshot into persistent state (honoring the `ended` cancellation flag),
// the same way hypurrscan.io/dashboard does. The returned `activeTwaps` is fed to
// the card's per-second projection.
export function useHypeTwapPressure() {
  const stateRef = useRef(createTwapTrackerState());
  const [snapshot, setSnapshot] = useState({
    activeTwaps: null,
    isLoading: true,
    error: null,
    asOf: 0,
  });

  useEffect(() => {
    let isActive = true;
    let timeoutId;

    const poll = async () => {
      try {
        const [twaps, spotMetaAndAssetCtxs] = await Promise.all([
          requestJson(TWAP_FEED_URL, undefined, { cacheTtlMs: 0 }),
          fetchSpotMetaAndAssetCtxs(),
        ]);

        if (!isActive) {
          return;
        }

        const priceByAssetId = selectHypeSpotPriceByAssetId(spotMetaAndAssetCtxs);
        const now = Date.now();
        stateRef.current = reconcileHypeTwaps({ ...stateRef.current, twaps, priceByAssetId, now });

        setSnapshot({
          activeTwaps: activeTwapsFromState(stateRef.current),
          isLoading: false,
          error: null,
          asOf: now,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }

        // Keep the last good active-set; just surface the error.
        setSnapshot((previous) => ({
          ...previous,
          isLoading: previous.activeTwaps === null,
          error,
        }));
      }
    };

    const scheduleNext = () => {
      timeoutId = window.setTimeout(async () => {
        if (typeof document === "undefined" || !document.hidden) {
          await poll();
        }
        if (isActive) {
          scheduleNext();
        }
      }, POLL_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void poll();
      }
    };

    void poll();
    scheduleNext();

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      isActive = false;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, []);

  return snapshot;
}
