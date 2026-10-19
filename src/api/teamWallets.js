import { requestJson, withQuery } from "./request";

export function fetchTeamWalletsOverview({ tokenSymbol = "HYPE" } = {}) {
  return requestJson(
    withQuery("/api/team-wallets/overview", { tokenSymbol }),
    undefined,
    { cacheTtlMs: 60_000 },
  );
}

export function fetchTeamWalletMonths() {
  return requestJson("/api/team-wallets/months", undefined, { cacheTtlMs: 60_000 });
}

export function fetchTeamWalletMonth(monthId) {
  return requestJson(`/api/team-wallets/months/${encodeURIComponent(monthId)}`, undefined, {
    cacheTtlMs: 60_000,
  });
}
