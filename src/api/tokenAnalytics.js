import { requestJson, withQuery } from "./request";

const TOKEN_ANALYTICS_CACHE_TTL_MS = 60_000;
// The spot universe only changes when a token is deployed, so the symbol maps
// are cached for an hour (the same stale time Qwantify uses).
const SPOT_SYMBOL_MAPS_CACHE_TTL_MS = 3_600_000;

export function fetchSpotSymbolMaps() {
  return requestJson("/api/markets/spot-symbol-maps", undefined, {
    cacheTtlMs: SPOT_SYMBOL_MAPS_CACHE_TTL_MS,
  });
}

export function fetchGenesisInfo(tokenSymbol) {
  return requestJson(withQuery("/api/markets/genesis-info", { tokenSymbol }), undefined, {
    cacheTtlMs: TOKEN_ANALYTICS_CACHE_TTL_MS,
  });
}

export function fetchHolderDistribution(tokenSymbol) {
  return requestJson(
    `/api/hypurrscan/holders/${encodeURIComponent(tokenSymbol)}/distribution`,
    undefined,
    { cacheTtlMs: TOKEN_ANALYTICS_CACHE_TTL_MS },
  );
}
