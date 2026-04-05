import { getChartLookbackHours } from "../lib/marketFlow";

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const PERP_DEXES = ["", "xyz", "flx", "vntl", "hyna", "km"];

let perpMetaAndAssetCtxsPromise = null;
let spotMetaAndAssetCtxsPromise = null;

async function requestHyperliquidInfo(payload) {
  const response = await fetch(HYPERLIQUID_INFO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Hyperliquid request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
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
  });

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map(parseCandle).filter(Boolean);
}

export async function fetchPerpMetaAndAssetCtxs() {
  if (!perpMetaAndAssetCtxsPromise) {
    perpMetaAndAssetCtxsPromise = requestHyperliquidInfo({
      type: "metaAndAssetCtxs",
    }).catch((error) => {
      perpMetaAndAssetCtxsPromise = null;
      throw error;
    });
  }

  return perpMetaAndAssetCtxsPromise;
}

function getRelativeStrengthLookbackHours(chartWindow) {
  return chartWindow === "7d" ? 24 * 7 : 24;
}

function parsePerpMarkets(universe, assetCtxs) {
  return universe
    .map((asset, index) => {
      const ctx = assetCtxs[index] ?? {};

      return {
        symbol: asset.name,
        dayNotionalVolume: Number(ctx.dayNtlVlm ?? 0),
        openInterest: Number(ctx.openInterest ?? 0),
        midPrice: Number(ctx.midPx ?? ctx.markPx ?? 0),
        isDelisted: Boolean(asset.isDelisted),
      };
    })
    .filter(
      (asset) =>
        asset.symbol &&
        !asset.isDelisted &&
        Number.isFinite(asset.dayNotionalVolume) &&
        asset.dayNotionalVolume > 0,
    );
}

async function fetchAssetCandles({ coin, startTime }) {
  const payload = await requestHyperliquidInfo({
    type: "candleSnapshot",
    req: {
      coin,
      interval: "1h",
      startTime,
    },
  });

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map(parseCandle).filter(Boolean);
}

export async function fetchRelativeStrengthUniverse({
  chartWindow = "24h",
  limit = 24,
  pinnedCoins = ["HYPE"],
} = {}) {
  const [meta, assetCtxs] = await fetchPerpMetaAndAssetCtxs();
  const allMarkets = parsePerpMarkets(meta?.universe ?? [], assetCtxs ?? []);
  const rankedMarkets = [...allMarkets].sort(
    (left, right) => right.dayNotionalVolume - left.dayNotionalVolume,
  );
  const selectedMarkets = [];
  const seen = new Set();

  const appendMarket = (symbol) => {
    if (!symbol || seen.has(symbol)) {
      return;
    }

    const market = rankedMarkets.find((item) => item.symbol === symbol);

    if (!market) {
      return;
    }

    seen.add(symbol);
    selectedMarkets.push(market);
  };

  pinnedCoins.forEach(appendMarket);
  rankedMarkets.forEach((market) => {
    if (selectedMarkets.length < limit) {
      appendMarket(market.symbol);
    }
  });

  const startTime =
    Date.now() - (getRelativeStrengthLookbackHours(chartWindow) + 1) * 60 * 60 * 1000;

  const results = await Promise.allSettled(
    selectedMarkets.map(async (market) => ({
      ...market,
      points: await fetchAssetCandles({
        coin: market.symbol,
        startTime,
      }),
    })),
  );

  return {
    asOf: Date.now(),
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
  });
}

export async function fetchClearinghouseState({ user, dex = "" }) {
  return requestHyperliquidInfo({
    type: "clearinghouseState",
    user,
    dex,
  });
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
  });
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
  });
}

export async function fetchSpotMetaAndAssetCtxs() {
  if (!spotMetaAndAssetCtxsPromise) {
    spotMetaAndAssetCtxsPromise = requestHyperliquidInfo({
      type: "spotMetaAndAssetCtxs",
    }).catch((error) => {
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
  });
}

export async function fetchDelegatorSummary({ user }) {
  return requestHyperliquidInfo({
    type: "delegatorSummary",
    user,
  });
}

export async function fetchUserFills({ user, aggregateByTime = true }) {
  return requestHyperliquidInfo({
    type: "userFills",
    user,
    aggregateByTime,
  });
}

export async function fetchTwapHistory({ user }) {
  return requestHyperliquidInfo({
    type: "twapHistory",
    user,
  });
}

export async function fetchUserNonFundingLedgerUpdates({ user, startTime, endTime }) {
  return requestHyperliquidInfo({
    type: "userNonFundingLedgerUpdates",
    user,
    startTime,
    endTime,
  });
}
