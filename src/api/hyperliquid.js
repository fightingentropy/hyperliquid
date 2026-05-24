import { getChartLookbackHours } from "../lib/marketFlow";
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
  "SNDK",
  "MU",
  "HIMS",
  "LLY",
  "LITE",
];

const XYZ_DISPLAY_ALIASES = {
  "XYZ:SP500": "SPX",
  "XYZ:XYZ100": "NDX",
};

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

export async function fetchPerpMetaAndAssetCtxs({ dex = "" } = {}) {
  const cacheKey = dex || "primary";
  const cached = perpMetaAndAssetCtxsCache.get(cacheKey);

  if (cached?.promise && Date.now() - cached.timestamp <= STATIC_CACHE_TTL_MS) {
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

  const promise = requestHyperliquidInfo(requestPayload, { cacheTtlMs: STATIC_CACHE_TTL_MS }).catch(
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
  const benchmarkPins = benchmarkSymbol ? [benchmarkSymbol] : [];
  const pinnedMarkets = explicitSymbols?.length
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

    seen.add(market.symbol);
    selectedMarkets.push(market);
  };

  pinnedMarkets.forEach(appendMarket);

  if (!explicitSymbols?.length) {
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

export async function fetchSpotMetaAndAssetCtxs() {
  if (spotMetaAndAssetCtxsPromise && Date.now() - spotMetaAndAssetCtxsTimestamp > STATIC_CACHE_TTL_MS) {
    spotMetaAndAssetCtxsPromise = null;
  }

  if (!spotMetaAndAssetCtxsPromise) {
    spotMetaAndAssetCtxsTimestamp = Date.now();
    spotMetaAndAssetCtxsPromise = requestHyperliquidInfo({
      type: "spotMetaAndAssetCtxs",
    }, { cacheTtlMs: STATIC_CACHE_TTL_MS }).catch((error) => {
      spotMetaAndAssetCtxsPromise = null;
      throw error;
    });
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
