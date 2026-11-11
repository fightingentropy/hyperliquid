import { buildHoldingsSnapshot, buildPositionSnapshot, toNumber } from "./wallet";

export { runWithConcurrency } from "./async";

// Dust below this shows as "0 HYPE" at two decimals, so it isn't counted.
export const MIN_DISPLAY_HYPE = 0.01;

export const ENTITY_TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "person", label: "People" },
  { value: "organization", label: "Organizations" },
];

export function normalizeEntity(raw) {
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? "").trim() || "Unnamed",
    type: String(raw?.entityType ?? "").toLowerCase() || "unknown",
    description: String(raw?.description ?? "").trim(),
    twitterHandle: raw?.twitterHandle ? String(raw.twitterHandle) : null,
    twitterUrl: raw?.twitterUrl ? String(raw.twitterUrl) : null,
    isActive: raw?.isActive !== false,
    trackFills: Boolean(raw?.trackingConfig?.trackFills),
  };
}

export function normalizeEntities(payload) {
  return (Array.isArray(payload) ? payload : [])
    .map(normalizeEntity)
    .filter((entity) => entity.id && entity.isActive);
}

export function filterEntities(entities, { query = "", type = "all" } = {}) {
  const needle = String(query ?? "").trim().toLowerCase();

  return entities.filter((entity) => {
    if (type !== "all" && entity.type !== type) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return [entity.name, entity.type, entity.description, entity.twitterHandle]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(needle));
  });
}

export function isLinkText(value) {
  return /^https?:\/\/\S+$/i.test(String(value ?? "").trim());
}

export function normalizeEntityWallets(payload) {
  const seen = new Set();

  return (Array.isArray(payload) ? payload : [])
    .map((link) => ({
      address: String(link?.wallet?.address ?? "").trim(),
      type: link?.wallet?.type ? String(link.wallet.type) : null,
      label: link?.wallet?.globalLabel ? String(link.wallet.globalLabel) : null,
      relation: link?.relationType ? String(link.relationType) : null,
    }))
    .filter((wallet) => {
      const key = wallet.address.toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(key) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

// One wallet's net worth from the same Hyperliquid snapshots the wallet page
// uses. Staking is optional because it loads in a second, slower pass.
export function summarizeWalletBalance({
  clearinghouseEntries,
  spotState,
  stakingSummary,
  spotMetaAndAssetCtxs,
  hypeMid,
}) {
  const positions = buildPositionSnapshot(clearinghouseEntries ?? []);
  const holdings = buildHoldingsSnapshot({
    spotState,
    subAccounts: null,
    spotMetaAndAssetCtxs,
    stakingSummary: null,
    hypeMid,
  });
  const price = Number.isFinite(hypeMid) && hypeMid > 0 ? hypeMid : 0;
  const stakedHype = stakingSummary
    ? toNumber(stakingSummary.delegated) +
      toNumber(stakingSummary.undelegated) +
      toNumber(stakingSummary.totalPendingWithdrawal)
    : null;
  const stakedUsd = stakedHype === null ? null : stakedHype * price;

  return {
    perpsUsd: positions.accountValueUsd,
    spotUsd: holdings.totalValueUsd,
    stakedHype,
    stakedUsd,
    totalUsd: positions.accountValueUsd + holdings.totalValueUsd + (stakedUsd ?? 0),
    openPositions: positions.positions.length,
    notionalUsd: positions.totalNotionalUsd,
    unrealizedPnlUsd: positions.totalUnrealizedPnlUsd,
  };
}

export function summarizeEntityBalances(balances) {
  const loaded = balances.filter(Boolean);
  const sum = (key) => loaded.reduce((total, balance) => total + (balance[key] ?? 0), 0);
  const stakingLoaded = loaded.filter((balance) => balance.stakedHype !== null).length;

  return {
    loadedCount: loaded.length,
    stakingLoadedCount: stakingLoaded,
    perpsUsd: sum("perpsUsd"),
    spotUsd: sum("spotUsd"),
    stakedHype: sum("stakedHype"),
    stakedUsd: sum("stakedUsd"),
    totalUsd: sum("totalUsd"),
    openPositions: sum("openPositions"),
    notionalUsd: sum("notionalUsd"),
    unrealizedPnlUsd: sum("unrealizedPnlUsd"),
    stakingWalletCount: loaded.filter((balance) => (balance.stakedHype ?? 0) >= MIN_DISPLAY_HYPE).length,
  };
}

// Caption for the entity net-worth card. Net worth only includes staked HYPE for
// wallets whose staking lookup finished, so say so while it loads or when some
// lookups failed instead of reading as a complete total.
export function describeNetWorthCoverage({
  walletCount,
  balancesDone,
  stakingLoaded,
  stakingFailed,
  balancesFailed = 0,
}) {
  if (balancesDone < walletCount) {
    return `Loading balances: ${balancesDone} of ${walletCount} wallets`;
  }
  // Wallets whose balances failed have no net worth entry, so staking is not
  // awaited for them; otherwise the caption would stay on "loading" forever.
  const stakingExpected = walletCount - balancesFailed;
  const stakingDone = stakingLoaded + stakingFailed;
  if (stakingDone < stakingExpected) {
    return `Excludes staked HYPE for now · loading staking: ${stakingDone} of ${stakingExpected} wallets`;
  }
  if (stakingFailed > 0) {
    return `Excludes staked HYPE for ${stakingFailed} of ${walletCount} wallet${walletCount === 1 ? "" : "s"} (staking lookup failed)`;
  }
  return `All ${walletCount} wallets`;
}
