import { requestJson, withQuery } from "./request";

export function fetchWalletResolve(address) {
  return requestJson(withQuery("/api/wallets/resolve", { address }), undefined, {
    cacheTtlMs: 300_000,
  });
}

export function fetchWalletNotionalDeltas(walletId) {
  return requestJson(`/api/wallets/${walletId}/notional-deltas`, undefined, {
    cacheTtlMs: 30_000,
  });
}
