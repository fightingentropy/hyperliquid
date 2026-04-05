import { requestJson, withQuery } from "./request";

export function fetchWalletResolve(address) {
  return requestJson(withQuery("/api/wallets/resolve", { address }));
}

export function fetchWalletNotionalDeltas(walletId) {
  return requestJson(`/api/wallets/${walletId}/notional-deltas`);
}
