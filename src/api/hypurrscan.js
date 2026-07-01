import { computeFeeStats } from "../lib/hypurrscan";
import { requestJson } from "./request";

// HypurrScan exposes these endpoints with permissive CORS, so the browser can
// read them directly (no proxy needed, unlike the Qwantify API).
const HYPURRSCAN_API = "https://api.hypurrscan.io";
const FEES_CACHE_TTL_MS = 60_000;

// Cumulative network-fee snapshots -> 24h total, prior day, percent change, and
// 24 hourly buckets for the mini chart.
export async function fetchNetworkFeeStats() {
  const feesRecent = await requestJson(`${HYPURRSCAN_API}/feesRecent`, undefined, {
    cacheTtlMs: FEES_CACHE_TTL_MS,
  });

  return computeFeeStats(feesRecent);
}

// The rolling window of recent TWAP orders across every market. Always fetched
// fresh: the active-set is maintained statefully (cancellations + retention)
// in the useActiveTwaps hook, which folds each snapshot into tracker state.
export async function fetchTwapFeed() {
  return requestJson(`${HYPURRSCAN_API}/twap/*`, undefined, { cacheTtlMs: 0 });
}
