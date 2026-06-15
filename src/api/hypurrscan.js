import { fetchSpotMetaAndAssetCtxs } from "./hyperliquid";
import {
  buildActiveHypeTwaps,
  computeFeeStats,
  selectHypeSpotPriceByAssetId,
} from "../lib/hypurrscan";
import { requestJson } from "./request";

// HypurrScan exposes these endpoints with permissive CORS, so the browser can
// read them directly (no proxy needed, unlike the Qwantify API).
const HYPURRSCAN_API = "https://api.hypurrscan.io";
const FEES_CACHE_TTL_MS = 60_000;
const TWAP_CACHE_TTL_MS = 30_000;

// Cumulative network-fee snapshots -> 24h total, prior day, percent change, and
// 24 hourly buckets for the mini chart.
export async function fetchNetworkFeeStats() {
  const feesRecent = await requestJson(`${HYPURRSCAN_API}/feesRecent`, undefined, {
    cacheTtlMs: FEES_CACHE_TTL_MS,
  });

  return computeFeeStats(feesRecent);
}

// Recent TWAP orders + live HYPE spot prices -> the active HYPE orders, reduced
// to what the (live-ticking) pressure projection needs.
export async function fetchHypeTwapPressure() {
  const [twaps, spotMetaAndAssetCtxs] = await Promise.all([
    requestJson(`${HYPURRSCAN_API}/twap/*`, undefined, { cacheTtlMs: TWAP_CACHE_TTL_MS }),
    fetchSpotMetaAndAssetCtxs(),
  ]);

  const priceByAssetId = selectHypeSpotPriceByAssetId(spotMetaAndAssetCtxs);
  const now = Date.now();
  const activeTwaps = buildActiveHypeTwaps({ twaps, priceByAssetId, now });

  return { activeTwaps, asOf: now };
}
