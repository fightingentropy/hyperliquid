import { useEffect, useRef, useState } from "react";
import { fetchTwapMarketData } from "../api/hyperliquid";
import { fetchTwapFeed } from "../api/hypurrscan";
import {
  buildActiveTwapRows,
  buildTwapMarketDirectory,
  createTwapTrackerState,
  reconcileActiveTwaps,
} from "../lib/hypurrscan";

// HypurrScan polls this feed every 5s; 7s keeps us in step without hammering it.
const POLL_INTERVAL_MS = 7_000;

// Maintains the live active-TWAP set across every market by polling the public
// feed and folding each snapshot into persistent tracker state, the same way
// hypurrscan.io/dashboard does. Returns display rows for the Active TWAPs
// table plus the HYPE-spot subset that feeds the buy-pressure card.
export function useActiveTwaps() {
  const stateRef = useRef(createTwapTrackerState());
  // Markets keep their last known label/price through a failed refresh so the
  // table doesn't flash to placeholders on a transient error.
  const directoryRef = useRef(new Map());
  const [snapshot, setSnapshot] = useState({
    activeTwaps: null,
    hypeSpotTwaps: null,
    isLoading: true,
    error: null,
    asOf: 0,
  });

  useEffect(() => {
    let isActive = true;
    let timeoutId;

    const poll = async () => {
      try {
        const twaps = await fetchTwapFeed();
        const now = Date.now();
        stateRef.current = reconcileActiveTwaps(stateRef.current, twaps, now);

        const marketIds = [
          ...new Set([...stateRef.current.activeByHash.values()].map((record) => record.marketId)),
        ];
        const marketData = await fetchTwapMarketData(marketIds);

        if (!isActive) {
          return;
        }

        for (const [marketId, market] of buildTwapMarketDirectory(marketData)) {
          directoryRef.current.set(marketId, market);
        }

        const rows = buildActiveTwapRows(stateRef.current, directoryRef.current);

        setSnapshot({
          activeTwaps: rows,
          hypeSpotTwaps: rows.filter((row) => row.isHypeSpot && Number.isFinite(row.value)),
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
