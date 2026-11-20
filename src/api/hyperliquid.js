import { selectTwapMarketSources } from "../lib/hypurrscan";
import { getChartLookbackHours } from "../lib/marketFlow";
import { isRelativeStrengthAutoExcluded } from "../lib/relativeStrength";
import { requestJson } from "./request";

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const PERP_DEXES = ["", "xyz", "flx", "vntl", "hyna", "km"];
const XYZ_DEX = "xyz";
const LIVE_CACHE_TTL_MS = 15_000;
const CHART_CACHE_TTL_MS = 60_000;
const STATIC_CACHE_TTL_MS = 300_000;

const perpMetaAndAssetCtxsCache = new Map();
let spotMetaAndAssetCtxsPromise = null;
let spotMetaAndAssetCtxsTimestamp = 0;

const RELATIVE_STRENGTH_CRYPTO_PINS = ["HYPE"];
const RELATIVE_STRENGTH_TRADFI_PINS = [
  "SPX",
  "NDX",
  "NVDA",
  "GOOGL",
  "AMZN",
  "TSLA",
  "HOOD",
  "MU",
  "HIMS",
  "LLY",
  "LITE",
];

const XYZ_DISPLAY_ALIASES = {
  "XYZ:SP500": "SPX",
  "XYZ:XYZ100": "NDX",
};

function dexLabel(dex) {
  return dex || "main";
}

function throwIfDexRequestsFailed(results, resourceName) {
  const failedDexes = results
    .map((result, index) => (result.status === "rejected" ? dexLabel(PERP_DEXES[index]) : null))
    .filter(Boolean);

  if (!failedDexes.length) {
    return;
  }

  throw new Error(
    `Failed to load ${resourceName} for ${failedDexes.length}/${PERP_DEXES.length} perp DEXes: ${failedDexes.join(", ")}.`,
  );
}

async function requestHyperliquidInfo(payload, options = {}) {
  return requestJson(
    HYPERLIQUID_INFO_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    options,
  );
}

function parseCandle(item) {
  const timestamp = Number(item?.t);
  const closePrice = Number(item?.c ?? item?.h ?? item?.l);

  if (!Number.isFinite(timestamp) || !Number.isFinite(closePrice)) {
    return null;
  }

  return { timestamp, closePrice };
}

export async function fetchHourlyCandles({ coin, chartWindow }) {
  const startTime = Date.now() - (getChartLookbackHours(chartWindow) + 1) * 60 * 60 * 1000;
  const payload = await requestHyperliquidInfo({
    type: "candleSnapshot",
    req: {
      coin,
      interval: "1h",
      startTime,
    },
  }, { cacheTtlMs: CHART_CACHE_TTL_MS });

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map(parseCandle).filter(Boolean);
}

// `maxAgeMs` lets live views (the TWAP table) demand fresher asset contexts
// than the default; the module cache is the only cache layer so a shorter
// max-age reliably refetches (and the refreshed entry serves everyone).
export async function fetchPerpMetaAndAssetCtxs({ dex = "", maxAgeMs = STATIC_CACHE_TTL_MS } = {}) {
  const cacheKey = dex || "primary";
  const cached = perpMetaAndAssetCtxsCache.get(cacheKey);

  if (cached?.promise && Date.now() - cached.timestamp <= maxAgeMs) {
    return cached.promise;
  }

  const requestPayload = dex
    ? {
        type: "metaAndAssetCtxs",
        dex,
      }
    : {
        type: "metaAndAssetCtxs",
      };

  const promise = requestHyperliquidInfo(requestPayload).catch(
    (error) => {
      if (perpMetaAndAssetCtxsCache.get(cacheKey)?.promise === promise) {
        perpMetaAndAssetCtxsCache.delete(cacheKey);
      }

      throw error;
    },
  );

  perpMetaAndAssetCtxsCache.set(cacheKey, {
    promise,
    timestamp: Date.now(),
  });

  return promise;
}

function getRelativeStrengthLookbackHours(chartWindow) {
  return chartWindow === "7d" ? 24 * 7 : 24;
}

function getXyzDisplaySymbol(symbol) {
  const normalized = String(symbol ?? "").trim();

  if (!normalized) {
    return "";
  }

  return (
    XYZ_DISPLAY_ALIASES[normalized.toUpperCase()] ??
    normalized.replace(/^xyz:/i, "").toUpperCase()
  );
}

function parsePerpMarkets(universe, assetCtxs, { dex = "", marketType = "crypto" } = {}) {
  return universe
    .map((asset, index) => {
      const ctx = assetCtxs[index] ?? {};
      const coin = asset.name;

      return {
        symbol: dex === XYZ_DEX ? getXyzDisplaySymbol(coin) : coin,
        coin,
        marketType,
        dayNotionalVolume: Number(ctx.dayNtlVlm ?? 0),
        openInterest: Number(ctx.openInterest ?? 0),
        midPrice: Number(ctx.midPx ?? ctx.markPx ?? 0),
        isDelisted: Boolean(asset.isDelisted),
      };
    })
    .filter(
      (asset) =>
        asset.symbol &&
        asset.coin &&
        !asset.isDelisted &&
        Number.isFinite(asset.dayNotionalVolume) &&
        asset.dayNotionalVolume > 0,
    );
}

function buildMarketLookup(markets) {
  const lookup = new Map();

  markets.forEach((market) => {
    [market.symbol, market.coin].forEach((key) => {
      if (key) {
        lookup.set(String(key).toUpperCase(), market);
      }
    });
  });

  return lookup;
}

function getRelativeStrengthPinnedCoins(marketScope) {
  if (marketScope === "tradfi") {
    return RELATIVE_STRENGTH_TRADFI_PINS;
  }

  if (marketScope === "combined") {
    return [...RELATIVE_STRENGTH_CRYPTO_PINS, ...RELATIVE_STRENGTH_TRADFI_PINS];
  }

  return RELATIVE_STRENGTH_CRYPTO_PINS;
}

async function loadRelativeStrengthMarkets(marketScope) {
  const includeCrypto = marketScope !== "tradfi";
  const includeTradFi = marketScope !== "crypto";
  const marketGroups = await Promise.all([
    includeCrypto ? fetchPerpMetaAndAssetCtxs() : Promise.resolve(null),
    includeTradFi ? fetchPerpMetaAndAssetCtxs({ dex: XYZ_DEX }) : Promise.resolve(null),
  ]);
  const [cryptoPayload, tradFiPayload] = marketGroups;
  const markets = [
    ...(cryptoPayload
      ? parsePerpMarkets(cryptoPayload[0]?.universe ?? [], cryptoPayload[1] ?? [], {
          marketType: "crypto",
        })
      : []),
    ...(tradFiPayload
      ? parsePerpMarkets(tradFiPayload[0]?.universe ?? [], tradFiPayload[1] ?? [], {
          dex: XYZ_DEX,
          marketType: "tradfi",
        })
      : []),
  ];
  const seen = new Set();

  return markets
    .sort((left, right) => right.dayNotionalVolume - left.dayNotionalVolume)
    .filter((market) => {
      if (seen.has(market.symbol)) {
        return false;
      }

      seen.add(market.symbol);
      return true;
    });
}

export async function fetchRelativeStrengthMarkets({ marketScope = "combined" } = {}) {
  return {
    asOf: Date.now(),
    markets: await loadRelativeStrengthMarkets(marketScope),
  };
}

async function fetchAssetCandles({ coin, startTime }) {
  const payload = await requestHyperliquidInfo({
    type: "candleSnapshot",
    req: {
      coin,
      interval: "1h",
      startTime,
    },
  }, { cacheTtlMs: CHART_CACHE_TTL_MS });

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map(parseCandle).filter(Boolean);
}

export async function fetchRelativeStrengthUniverse({
  chartWindow = "24h",
  limit = 24,
  marketScope = "crypto",
  benchmarkSymbol = "HYPE",
  includedSymbols,
  pinnedCoins,
} = {}) {
  const rankedMarkets = await loadRelativeStrengthMarkets(marketScope);
  const marketLookup = buildMarketLookup(rankedMarkets);
  const selectedMarkets = [];
  const seen = new Set();
  const explicitSymbols = Array.isArray(includedSymbols)
    ? includedSymbols.filter(Boolean)
    : null;
  const isCustomSelection = Boolean(explicitSymbols?.length);
  const benchmarkPins = benchmarkSymbol ? [benchmarkSymbol] : [];
  const pinnedMarkets = isCustomSelection
    ? [...benchmarkPins, ...explicitSymbols]
    : [...benchmarkPins, ...(pinnedCoins ?? getRelativeStrengthPinnedCoins(marketScope))];

  const appendMarket = (symbol) => {
    if (!symbol) {
      return;
    }

    const market = marketLookup.get(String(symbol).toUpperCase());

    if (!market || seen.has(market.symbol)) {
      return;
    }

    if (!isCustomSelection && isRelativeStrengthAutoExcluded(market.symbol)) {
      return;
    }

    seen.add(market.symbol);
    selectedMarkets.push(market);
  };

  pinnedMarkets.forEach(appendMarket);

  if (!isCustomSelection) {
    rankedMarkets.forEach((market) => {
      if (selectedMarkets.length < limit) {
        appendMarket(market.symbol);
      }
    });
  }

  const startTime =
    Date.now() - (getRelativeStrengthLookbackHours(chartWindow) + 1) * 60 * 60 * 1000;

  const results = await Promise.allSettled(
    selectedMarkets.map(async (market) => ({
      ...market,
      points: await fetchAssetCandles({
        coin: market.coin,
        startTime,
      }),
    })),
  );

  return {
    asOf: Date.now(),
    markets: rankedMarkets,
    assets: results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((asset) => asset.points.length >= 4),
  };
}

export async function fetchPortfolio({ user }) {
  return requestHyperliquidInfo({
    type: "portfolio",
    user,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

export async function fetchClearinghouseState({ user, dex = "" }) {
  return requestHyperliquidInfo({
    type: "clearinghouseState",
    user,
    dex,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

export async function fetchAllClearinghouseStates({ user }) {
  const results = await Promise.allSettled(
    PERP_DEXES.map(async (dex) => {
      const state = await fetchClearinghouseState({ user, dex });
      return { dex, state };
    }),
  );

  throwIfDexRequestsFailed(results, "clearinghouse state");

  return results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}

export async function fetchOpenOrders({ user, dex = "" }) {
  return requestHyperliquidInfo({
    type: "openOrders",
    user,
    dex,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

export async function fetchAllOpenOrders({ user }) {
  const results = await Promise.allSettled(
    PERP_DEXES.map(async (dex) => {
      const orders = await fetchOpenOrders({ user, dex });
      return {
        dex,
        orders: Array.isArray(orders) ? orders : [],
      };
    }),
  );

  throwIfDexRequestsFailed(results, "open orders");

  return results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) =>
      result.value.orders.map((order) => ({
        ...order,
        dex: result.value.dex,
      })),
    );
}

export async function fetchSpotClearinghouseState({ user }) {
  return requestHyperliquidInfo({
    type: "spotClearinghouseState",
    user,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

export async function fetchSpotMetaAndAssetCtxs({ maxAgeMs = STATIC_CACHE_TTL_MS } = {}) {
  if (spotMetaAndAssetCtxsPromise && Date.now() - spotMetaAndAssetCtxsTimestamp > maxAgeMs) {
    spotMetaAndAssetCtxsPromise = null;
  }

  if (!spotMetaAndAssetCtxsPromise) {
    spotMetaAndAssetCtxsTimestamp = Date.now();
    const promise = requestHyperliquidInfo({
      type: "spotMetaAndAssetCtxs",
    }).catch((error) => {
      if (spotMetaAndAssetCtxsPromise === promise) {
        spotMetaAndAssetCtxsPromise = null;
      }
      throw error;
    });
    spotMetaAndAssetCtxsPromise = promise;
  }

  return spotMetaAndAssetCtxsPromise;
}

export async function fetchSubAccounts({ user }) {
  return requestHyperliquidInfo({
    type: "subAccounts",
    user,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

export async function fetchDelegatorSummary({ user }) {
  return requestHyperliquidInfo({
    type: "delegatorSummary",
    user,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

export async function fetchUserFills({ user, aggregateByTime = true }) {
  return requestHyperliquidInfo({
    type: "userFills",
    user,
    aggregateByTime,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

export async function fetchUserFillsByTime({ user, startTime = 0, endTime, aggregateByTime = true }) {
  return requestHyperliquidInfo({
    type: "userFillsByTime",
    user,
    startTime,
    endTime,
    aggregateByTime,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

const USER_FILLS_PAGE_SIZE = 2000;
const USER_FILLS_MAX_PAGES = 10;

// Hyperliquid serves at most ~2000 fills per `userFillsByTime` request
// (oldest-first) and retains roughly the most recent 10k fills. Page forward by
// time to assemble the full retained history client-side — the same approach
// qwantify uses, which has no fills API of its own: both read this endpoint.
export async function fetchAllUserFills({
  user,
  startTime: initialStartTime = 0,
  maxPages = USER_FILLS_MAX_PAGES,
  fetchPage = fetchUserFillsByTime,
}) {
  const byKey = new Map();
  let startTime = initialStartTime;

  for (let page = 0; page < maxPages; page += 1) {
    const batch = await fetchPage({ user, startTime });
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    let maxTime = startTime;
    let added = 0;
    for (const fill of batch) {
      const key = fill?.tid ?? `${fill?.hash}:${fill?.time}`;
      if (!byKey.has(key)) {
        byKey.set(key, fill);
        added += 1;
      }
      const time = Number(fill?.time);
      if (Number.isFinite(time) && time > maxTime) {
        maxTime = time;
      }
    }

    // Stop on the last (partial) page, or when a page adds nothing new. The next
    // page restarts AT the last millisecond seen (not +1) so fills sharing that
    // millisecond that were cut off at the page boundary are fetched; the
    // already-seen ones are removed by the dedupe above.
    if (batch.length < USER_FILLS_PAGE_SIZE || added === 0) {
      break;
    }
    startTime = maxTime;
  }

  return Array.from(byKey.values());
}

const RECENT_FILLS_MAX_PAGES = 4;
// Skip paging outright when the latest page's pace puts the window this many
// times over the page budget; trading is bursty, so a nearer miss still tries.
const RECENT_FILLS_HOPELESS_FACTOR = 3;

// A wallet's fills since `startTime` for at most `maxPages` requests, newest
// first: the latest page, then pages forward from `startTime` to meet it. A
// wallet that trades too fast for that budget (a market maker fills thousands
// of times an hour, and each page costs ~120 request weight) keeps only the
// latest page, and `fillsFrom` says when that coverage starts.
export async function fetchRecentUserFills({
  user,
  startTime = 0,
  maxPages = RECENT_FILLS_MAX_PAGES,
  fetchLatest = fetchUserFills,
  fetchPage = fetchUserFillsByTime,
}) {
  const keyOf = (fill) => fill?.tid ?? `${fill?.hash}:${fill?.time}`;
  const byTime = (a, b) => Number(a.time) - Number(b.time);
  const latestPage = await fetchLatest({ user });
  const latest = (Array.isArray(latestPage) ? latestPage : []).filter((fill) => Number.isFinite(Number(fill?.time)));
  const inWindow = latest.filter((fill) => Number(fill.time) >= startTime).sort(byTime);
  const oldest = latest.reduce((min, fill) => Math.min(min, Number(fill.time)), Infinity);
  const newest = latest.reduce((max, fill) => Math.max(max, Number(fill.time)), -Infinity);
  if (latest.length < USER_FILLS_PAGE_SIZE || oldest <= startTime) {
    return { fills: inWindow, fillsFrom: null };
  }

  // The latest page stops short of `startTime`: page forward across the gap,
  // giving up as soon as the pages left can't plausibly close it.
  const partial = { fills: inWindow, fillsFrom: oldest };
  const forwardPages = maxPages - 1;
  if ((oldest - startTime) / Math.max(newest - oldest, 1) > forwardPages * RECENT_FILLS_HOPELESS_FACTOR) {
    return partial;
  }

  const byKey = new Map();
  let from = startTime;
  let firstTime = Infinity;
  for (let page = 1; page <= forwardPages; page += 1) {
    const batch = await fetchPage({ user, startTime: from, endTime: oldest });
    const list = Array.isArray(batch) ? batch : [];
    let added = 0;
    let maxTime = from;
    for (const fill of list) {
      if (!byKey.has(keyOf(fill))) {
        byKey.set(keyOf(fill), fill);
        added += 1;
      }
      const time = Number(fill?.time) || 0;
      maxTime = Math.max(maxTime, time);
      firstTime = Math.min(firstTime, time);
    }
    if (list.length < USER_FILLS_PAGE_SIZE || added === 0) {
      for (const fill of inWindow) {
        byKey.set(keyOf(fill), fill);
      }
      return { fills: Array.from(byKey.values()).sort(byTime), fillsFrom: null };
    }
    // Measured from the first fill seen, not `startTime`: Hyperliquid may hold
    // nothing for the start of the window.
    const perPage = Math.max(maxTime - firstTime, 1) / page;
    if ((oldest - maxTime) / perPage > forwardPages - page) {
      break;
    }
    from = maxTime;
  }

  return partial;
}

export const TWAP_SLICE_FILLS_LIMIT = 2000;

// TWAP child fills. `userFills` and `userFillsByTime` leave these out entirely;
// this endpoint is the only source, and it serves just the most recent 2000
// slices with no time filter.
export async function fetchUserTwapSliceFills({ user }) {
  return requestHyperliquidInfo({
    type: "userTwapSliceFills",
    user,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

// Adds TWAP slice fills (`[{ fill, twapId }]`) to regular fills, oldest first.
// `twapFillsFrom` is set when the slice feed hit its cap inside the window: TWAP
// fills before that time are missing, so flows before it are undercounted.
export function mergeTwapSliceFills(fills, slices, { since = 0 } = {}) {
  const byKey = new Map();
  const keyOf = (fill) => fill?.tid ?? `${fill?.hash}:${fill?.time}`;
  for (const fill of Array.isArray(fills) ? fills : []) {
    byKey.set(keyOf(fill), fill);
  }

  const sliceList = Array.isArray(slices) ? slices : [];
  let oldestSliceAt = Infinity;
  for (const slice of sliceList) {
    const fill = slice?.fill;
    const time = Number(fill?.time);
    if (!fill || !Number.isFinite(time)) {
      continue;
    }
    oldestSliceAt = Math.min(oldestSliceAt, time);
    if (time >= since && !byKey.has(keyOf(fill))) {
      byKey.set(keyOf(fill), { ...fill, twapId: slice.twapId ?? fill.twapId ?? null });
    }
  }

  const capped = sliceList.length >= TWAP_SLICE_FILLS_LIMIT && oldestSliceAt > since;
  return {
    fills: Array.from(byKey.values()).sort((a, b) => Number(a.time) - Number(b.time)),
    twapFillsFrom: capped ? oldestSliceAt : null,
  };
}

// A wallet's fills since `startTime`, TWAP slices included. `fillsFrom` is set
// when the wallet trades too fast to cover the whole window (see
// `fetchRecentUserFills`); TWAP slices are then cut to the same start.
export async function fetchAllUserFillsWithTwap({ user, startTime = 0 }) {
  const [{ fills, fillsFrom }, slices] = await Promise.all([
    fetchRecentUserFills({ user, startTime }),
    fetchUserTwapSliceFills({ user }),
  ]);
  return { ...mergeTwapSliceFills(fills, slices, { since: fillsFrom ?? startTime }), fillsFrom };
}

// Ordered list of perp dexes; entry 0 is the primary universe (null name).
// HIP-3 asset ids encode a dex by its index in this list.
// Mid price per coin, keyed by perp name ("HYPE") or spot index ("@107").
export async function fetchAllMids() {
  return requestHyperliquidInfo({
    type: "allMids",
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

// Every validator with its name, stake and status.
export async function fetchValidatorSummaries() {
  return requestHyperliquidInfo({
    type: "validatorSummaries",
  }, { cacheTtlMs: STATIC_CACHE_TTL_MS });
}

export async function fetchPerpDexs() {
  return requestHyperliquidInfo({
    type: "perpDexs",
  }, { cacheTtlMs: STATIC_CACHE_TTL_MS });
}

const TWAP_MARKET_DATA_MAX_AGE_MS = 60_000;

// Market data needed to label and price a set of TWAP asset ids: only the
// sources the feed actually references (primary perps, spot, and the HIP-3
// dexes in use). Sources fail independently — a missing one just leaves its
// orders unpriced until the next poll.
export async function fetchTwapMarketData(marketIds) {
  const { needsPerp, needsSpot, hip3DexIndexes } = selectTwapMarketSources(marketIds);
  const perpDexs = hip3DexIndexes.length ? await fetchPerpDexs().catch(() => null) : null;

  const hip3Requests = hip3DexIndexes
    .map((dexIndex) => ({ dexIndex, dex: perpDexs?.[dexIndex]?.name }))
    .filter((request) => Boolean(request.dex));

  const [primary, spot, ...hip3] = await Promise.allSettled([
    needsPerp
      ? fetchPerpMetaAndAssetCtxs({ maxAgeMs: TWAP_MARKET_DATA_MAX_AGE_MS })
      : Promise.resolve(null),
    needsSpot
      ? fetchSpotMetaAndAssetCtxs({ maxAgeMs: TWAP_MARKET_DATA_MAX_AGE_MS })
      : Promise.resolve(null),
    ...hip3Requests.map((request) =>
      fetchPerpMetaAndAssetCtxs({ dex: request.dex, maxAgeMs: TWAP_MARKET_DATA_MAX_AGE_MS }),
    ),
  ]);

  const perpsByDexIndex = {};
  if (primary.status === "fulfilled" && primary.value) {
    perpsByDexIndex[0] = primary.value;
  }
  hip3.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) {
      perpsByDexIndex[hip3Requests[index].dexIndex] = result.value;
    }
  });

  return {
    perpsByDexIndex,
    spotMetaAndAssetCtxs: spot.status === "fulfilled" ? spot.value : null,
  };
}

export async function fetchTwapHistory({ user }) {
  return requestHyperliquidInfo({
    type: "twapHistory",
    user,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

export async function fetchUserNonFundingLedgerUpdates({ user, startTime, endTime }) {
  return requestHyperliquidInfo({
    type: "userNonFundingLedgerUpdates",
    user,
    startTime,
    endTime,
  }, { cacheTtlMs: LIVE_CACHE_TTL_MS });
}

function parseWatchMarket(universe, assetCtxs, { dex = "", marketType = "crypto" } = {}) {
  return universe
    .map((asset, index) => {
      const ctx = assetCtxs[index] ?? {};
      const coin = asset.name;

      return {
        symbol: dex === XYZ_DEX ? getXyzDisplaySymbol(coin) : coin,
        coin,
        marketType,
        markPx: Number(ctx.markPx ?? 0),
        midPx: Number(ctx.midPx ?? ctx.markPx ?? 0),
        prevDayPx: Number(ctx.prevDayPx ?? 0),
        dayNtlVlm: Number(ctx.dayNtlVlm ?? 0),
        openInterest: Number(ctx.openInterest ?? 0),
        fundingRate: Number(ctx.funding ?? 0),
        isDelisted: Boolean(asset.isDelisted),
      };
    })
    .filter(
      (market) =>
        market.symbol &&
        market.coin &&
        !market.isDelisted &&
        Number.isFinite(market.markPx) &&
        market.markPx > 0,
    );
}

// Watchlist snapshot: one row per tradable market with everything the watch
// table shows (price, previous-day price for 24h change, volume, open
// interest, funding). Primary perps take priority when a symbol exists on
// both the main dex and a HIP-3 or xyz dex.
export async function fetchWatchMarkets() {
  const [primary, xyz] = await Promise.all([
    fetchPerpMetaAndAssetCtxs(),
    fetchPerpMetaAndAssetCtxs({ dex: XYZ_DEX }).catch(() => null),
  ]);

  const markets = [
    ...parseWatchMarket(primary?.[0]?.universe ?? [], primary?.[1] ?? []),
    ...(xyz
      ? parseWatchMarket(xyz[0]?.universe ?? [], xyz[1] ?? [], {
          dex: XYZ_DEX,
          marketType: "tradfi",
        })
      : []),
  ];

  const seen = new Set();
  const uniqueMarkets = markets.filter((market) => {
    const key = market.symbol.toUpperCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return {
    asOf: Date.now(),
    markets: uniqueMarkets,
  };
}

const WATCH_SPARKLINE_LOOKBACK_HOURS = 25;

// 24 hourly closes per coin for the watch table's sparklines. One request per
// coin, served through the shared request cache so several lists or tabs
// polling the same coins stay cheap.
export async function fetchWatchSparklines(coins) {
  const symbols = Array.isArray(coins) ? coins.filter(Boolean) : [];
  const startTime = Date.now() - WATCH_SPARKLINE_LOOKBACK_HOURS * 60 * 60 * 1000;

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const payload = await requestHyperliquidInfo({
        type: "candleSnapshot",
        req: {
          coin: symbol,
          interval: "1h",
          startTime,
        },
      }, { cacheTtlMs: CHART_CACHE_TTL_MS });

      if (!Array.isArray(payload)) {
        return [];
      }

      return payload.map(parseCandle).filter(Boolean);
    }),
  );

  const sparklines = {};
  symbols.forEach((symbol, index) => {
    const result = results[index];
    sparklines[symbol] = result.status === "fulfilled" ? result.value : [];
  });

  return sparklines;
}
