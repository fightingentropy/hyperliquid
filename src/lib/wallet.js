const STABLE_TOKENS = new Set(["USDC", "USDH", "USDT", "USDT0", "USDE"]);
const SPOT_QUOTE_TOKENS = ["USDC", "USDH", "USDT"];
const PERP_DEX_ORDER = ["", "xyz", "flx", "vntl", "hyna", "km"];

export const WALLET_TABS = [
  { value: "positions", label: "Positions" },
  { value: "orders", label: "Orders" },
  { value: "holdings", label: "Holdings" },
  { value: "trades", label: "Trades" },
  { value: "transactions", label: "Transactions" },
  { value: "performance", label: "Performance" },
  { value: "statistics", label: "Statistics" },
];

export const PINNED_WALLETS = [
  {
    address: "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae",
    label: "Loracle",
  },
  {
    address: "0xaf0FDd39e5D92499B0eD9F68693DA99C0ec1e92e",
    label: "Purple surfer",
  },
];

export const PERFORMANCE_METRIC_OPTIONS = [
  { value: "pnl", label: "PnL" },
  { value: "accountValue", label: "Account value" },
];

export const PERFORMANCE_SCOPE_OPTIONS = [
  { value: "perp", label: "Perp" },
  { value: "total", label: "Perp + Spot" },
];

export const PERFORMANCE_RANGE_OPTIONS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

export const POSITION_VIEW_OPTIONS = [
  { value: "details", label: "Details" },
  { value: "cards", label: "Cards" },
  { value: "table", label: "Table" },
];

export const DELTA_VIEW_OPTIONS = [
  { value: "cards", label: "Cards" },
  { value: "table", label: "Table" },
];

const RANGE_LOOKUPS = {
  "24h": { total: "day", perp: "perpDay" },
  "7d": { total: "week", perp: "perpWeek" },
  "30d": { total: "month", perp: "perpMonth" },
  all: { total: "allTime", perp: "perpAllTime" },
};

const ALL_TIME_START = Date.parse("2023-01-01T00:00:00.000Z");

export function getAllTimeStart() {
  return ALL_TIME_START;
}

export function isValidEvmAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? "").trim());
}

export function toNumber(value) {
  const parsed = Number.parseFloat(`${value ?? ""}`);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizePortfolio(rawPortfolio) {
  if (!Array.isArray(rawPortfolio)) {
    return {};
  }

  return Object.fromEntries(
    rawPortfolio
      .filter((entry) => Array.isArray(entry) && entry.length === 2)
      .map(([key, value]) => [key, value ?? { accountValueHistory: [], pnlHistory: [], vlm: "0" }]),
  );
}

export function getPortfolioKey(scope, range) {
  return RANGE_LOOKUPS[range]?.[scope] ?? RANGE_LOOKUPS.all.perp;
}

export function parseHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return null;
      }

      const timestamp = Number(entry[0]);
      const value = toNumber(entry[1]);

      if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
        return null;
      }

      return { timestamp, value };
    })
    .filter(Boolean)
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function latestValue(series) {
  return series.length ? series[series.length - 1].value : 0;
}

export function computeSeriesDelta(series, lookbackMs) {
  if (!series.length) {
    return {
      latest: 0,
      delta: 0,
      baseValue: 0,
      baseTimestampMs: null,
    };
  }

  const latest = series[series.length - 1];
  const targetTimestamp = latest.timestamp - lookbackMs;
  let basePoint = series[0];

  for (const point of series) {
    if (point.timestamp <= targetTimestamp) {
      basePoint = point;
      continue;
    }

    break;
  }

  return {
    latest: latest.value,
    delta: latest.value - basePoint.value,
    baseValue: basePoint.value,
    baseTimestampMs: basePoint.timestamp,
  };
}

export function computePercentDelta(delta, baseValue) {
  if (!Number.isFinite(delta) || !Number.isFinite(baseValue) || Math.abs(baseValue) < 1e-6) {
    return null;
  }

  return (delta / Math.abs(baseValue)) * 100;
}

export function buildPerformanceSeries(portfolio, scope, range, metric) {
  const key = getPortfolioKey(scope, range);
  const historyKey = metric === "accountValue" ? "accountValueHistory" : "pnlHistory";
  const series = parseHistory(portfolio[key]?.[historyKey]);

  return series.map((point) => ({
    ...point,
    axisLabel: formatPerformanceAxisLabel(point.timestamp, range),
    tooltipLabel: formatPerformanceTooltip(point.timestamp),
  }));
}

export function buildPositionSnapshot(entries) {
  const positions = [];
  let accountValueUsd = 0;
  let totalNotionalUsd = 0;
  let withdrawableUsd = 0;
  let longExposureUsd = 0;
  let shortExposureUsd = 0;
  let totalUnrealizedPnlUsd = 0;
  let marginUsedUsd = 0;
  let longCount = 0;
  let shortCount = 0;

  for (const entry of entries ?? []) {
    const state = entry?.state;
    const dex = entry?.dex ?? "";

    accountValueUsd += toNumber(state?.marginSummary?.accountValue);
    totalNotionalUsd += Math.abs(toNumber(state?.marginSummary?.totalNtlPos));
    withdrawableUsd += toNumber(state?.withdrawable);

    for (const assetPosition of state?.assetPositions ?? []) {
      const position = assetPosition?.position;
      if (!position) {
        continue;
      }

      const size = toNumber(position.szi);
      const positionValueUsd = Math.abs(toNumber(position.positionValue));
      const entryPrice = toNumber(position.entryPx);
      const markPrice =
        size !== 0 && Number.isFinite(positionValueUsd)
          ? positionValueUsd / Math.abs(size)
          : entryPrice;
      const unrealizedPnlUsd = toNumber(position.unrealizedPnl);
      const roePct = toNumber(position.returnOnEquity) * 100;
      const fundingUsd = -toNumber(position.cumFunding?.sinceOpen);
      const liquidationPrice = position.liquidationPx === null ? null : toNumber(position.liquidationPx);
      const side = size > 0 ? "LONG" : size < 0 ? "SHORT" : "FLAT";
      const leverage = toNumber(position.leverage?.value);
      const marginUsed = toNumber(position.marginUsed);

      if (size > 0) {
        longExposureUsd += positionValueUsd;
        longCount += 1;
      } else if (size < 0) {
        shortExposureUsd += positionValueUsd;
        shortCount += 1;
      }

      totalUnrealizedPnlUsd += unrealizedPnlUsd;
      marginUsedUsd += Math.abs(marginUsed);

      positions.push({
        id: `${dex || "main"}:${position.coin}:${size}:${entryPrice}`,
        coin: position.coin,
        dex,
        side,
        size,
        absSize: Math.abs(size),
        entryPrice,
        markPrice,
        positionValueUsd,
        unrealizedPnlUsd,
        roePct,
        fundingUsd,
        liquidationPrice,
        leverage,
        marginUsedUsd: marginUsed,
      });
    }
  }

  positions.sort((left, right) => {
    const leftDexIndex = PERP_DEX_ORDER.indexOf(left.dex);
    const rightDexIndex = PERP_DEX_ORDER.indexOf(right.dex);

    if (leftDexIndex !== rightDexIndex) {
      return leftDexIndex - rightDexIndex;
    }

    const leftSideRank = left.side === "LONG" ? 0 : left.side === "SHORT" ? 1 : 2;
    const rightSideRank = right.side === "LONG" ? 0 : right.side === "SHORT" ? 1 : 2;

    if (leftSideRank !== rightSideRank) {
      return leftSideRank - rightSideRank;
    }

    return right.positionValueUsd - left.positionValueUsd;
  });

  return {
    positions,
    accountValueUsd,
    totalNotionalUsd,
    withdrawableUsd,
    longExposureUsd,
    shortExposureUsd,
    netExposureUsd: longExposureUsd - shortExposureUsd,
    totalUnrealizedPnlUsd,
    marginUsedUsd,
    longCount,
    shortCount,
  };
}

export function buildSpotPriceMap(payload) {
  const meta = payload?.[0];
  const assetContexts = payload?.[1];

  if (!meta || !Array.isArray(assetContexts)) {
    return new Map();
  }

  const universeIndexByPair = new Map();
  for (const pair of meta.universe ?? []) {
    if (!Array.isArray(pair?.tokens) || pair.tokens.length < 2) {
      continue;
    }

    universeIndexByPair.set(`${pair.tokens[0]}-${pair.tokens[1]}`, pair.index);
  }

  const priceByUniverseIndex = new Map();
  for (const item of assetContexts) {
    const match = String(item?.coin ?? "").match(/^@(\d+)$/);
    if (!match) {
      continue;
    }

    const price = toNumber(item.midPx ?? item.markPx ?? item.prevDayPx);
    if (price > 0) {
      priceByUniverseIndex.set(Number(match[1]), price);
    }
  }

  const tokenIndexBySymbol = new Map();
  for (const token of meta.tokens ?? []) {
    tokenIndexBySymbol.set(String(token?.name ?? "").trim().toUpperCase(), token.index);
  }

  const prices = new Map();
  STABLE_TOKENS.forEach((symbol) => prices.set(symbol, 1));

  for (const token of meta.tokens ?? []) {
    const symbol = String(token?.name ?? "").trim().toUpperCase();
    if (!symbol || prices.has(symbol)) {
      continue;
    }

    for (const quoteSymbol of SPOT_QUOTE_TOKENS) {
      const quoteIndex = tokenIndexBySymbol.get(quoteSymbol);
      if (quoteIndex === undefined) {
        continue;
      }

      const universeIndex = universeIndexByPair.get(`${token.index}-${quoteIndex}`);
      const price = universeIndex === undefined ? null : priceByUniverseIndex.get(universeIndex);

      if (price) {
        prices.set(symbol, price);
        break;
      }
    }
  }

  return prices;
}

function accumulateBalances(target, spotState) {
  for (const balance of spotState?.balances ?? []) {
    const coin = String(balance?.coin ?? "").trim().toUpperCase();
    if (!coin) {
      continue;
    }

    const total = toNumber(balance.total);
    const hold = toNumber(balance.hold);
    const entryNotionalUsd = toNumber(balance.entryNtl);

    if (total === 0 && hold === 0 && entryNotionalUsd === 0) {
      continue;
    }

    const existing = target.get(coin) ?? {
      total: 0,
      hold: 0,
      entryNotionalUsd: 0,
    };

    target.set(coin, {
      total: existing.total + total,
      hold: existing.hold + hold,
      entryNotionalUsd: existing.entryNotionalUsd + entryNotionalUsd,
    });
  }
}

export function buildHoldingsSnapshot({ spotState, subAccounts, spotMetaAndAssetCtxs, stakingSummary, hypeMid }) {
  const prices = buildSpotPriceMap(spotMetaAndAssetCtxs);
  const totals = new Map();

  accumulateBalances(totals, spotState);

  if (Array.isArray(subAccounts)) {
    for (const account of subAccounts) {
      accumulateBalances(totals, account?.spotState);
    }
  }

  const holdings = Array.from(totals.entries())
    .map(([coin, balance]) => {
      const midPx = prices.get(coin) ?? null;
      const available = balance.total - balance.hold;
      const valueUsd = midPx === null ? null : balance.total * midPx;
      const avgEntryPxUsd =
        balance.total > 0
          ? (STABLE_TOKENS.has(coin) && balance.entryNotionalUsd === 0
              ? balance.total
              : balance.entryNotionalUsd) / balance.total
          : null;
      const basisUsd = STABLE_TOKENS.has(coin) && balance.entryNotionalUsd === 0
        ? balance.total
        : balance.entryNotionalUsd;
      const returnUsd = valueUsd === null ? null : valueUsd - basisUsd;
      const returnPct =
        valueUsd !== null && basisUsd > 0 ? (returnUsd / basisUsd) * 100 : null;

      return {
        coin,
        total: balance.total,
        hold: balance.hold,
        available,
        entryNotionalUsd: basisUsd,
        midPx,
        valueUsd,
        avgEntryPxUsd,
        returnUsd,
        returnPct,
      };
    })
    .sort((left, right) => (right.valueUsd ?? -Infinity) - (left.valueUsd ?? -Infinity));

  const stakingEntries = [];
  const delegated = toNumber(stakingSummary?.delegated);
  const undelegated = toNumber(stakingSummary?.undelegated);
  const pending = toNumber(stakingSummary?.totalPendingWithdrawal);
  const hypePrice = Number.isFinite(hypeMid) && hypeMid > 0 ? hypeMid : 0;

  if (delegated > 0) {
    stakingEntries.push({
      id: "delegated",
      label: "HYPE",
      badge: "Delegated",
      amount: delegated,
      valueUsd: delegated * hypePrice,
    });
  }

  if (undelegated > 0) {
    stakingEntries.push({
      id: "undelegated",
      label: "HYPE",
      badge: "Undelegated",
      amount: undelegated,
      valueUsd: undelegated * hypePrice,
    });
  }

  if (pending > 0) {
    stakingEntries.push({
      id: "unstaking",
      label: "HYPE",
      badge: "Unstaking",
      amount: pending,
      valueUsd: pending * hypePrice,
    });
  }

  return {
    holdings,
    stakingEntries,
    sourceWalletCount: 1 + (Array.isArray(subAccounts) ? subAccounts.length : 0),
    totalValueUsd: holdings.reduce((sum, holding) => sum + (holding.valueUsd ?? 0), 0),
  };
}

export function buildWalletMetrics({ portfolio, holdingsSnapshot, stakingSummary, hypeMid, positionSnapshot }) {
  const spotUsd = holdingsSnapshot?.totalValueUsd ?? 0;
  const stakedTokens =
    toNumber(stakingSummary?.delegated) +
    toNumber(stakingSummary?.undelegated) +
    toNumber(stakingSummary?.totalPendingWithdrawal);
  const stakedUsd = stakedTokens * (Number.isFinite(hypeMid) ? hypeMid : 0);

  const perpAccountValueSeries = parseHistory(portfolio.perpAllTime?.accountValueHistory);
  const totalPnlSeries = parseHistory(portfolio.allTime?.pnlHistory);
  const perpsEquityUsd = latestValue(perpAccountValueSeries);
  const realizedAllTimeUsd = latestValue(totalPnlSeries);
  const delta24h = computeSeriesDelta(totalPnlSeries, 24 * 60 * 60 * 1000);
  const delta7d = computeSeriesDelta(totalPnlSeries, 7 * 24 * 60 * 60 * 1000);
  const totalEquityUsd = spotUsd + stakedUsd + perpsEquityUsd;
  const longExposureUsd = positionSnapshot?.longExposureUsd ?? 0;
  const shortExposureUsd = positionSnapshot?.shortExposureUsd ?? 0;
  const totalExposureUsd = longExposureUsd + shortExposureUsd;
  const netExposureUsd = longExposureUsd - shortExposureUsd;
  const magnitudePct = totalExposureUsd > 0 ? (Math.abs(netExposureUsd) / totalExposureUsd) * 100 : 0;

  let biasLabel = "Neutral";
  if (totalExposureUsd > 0) {
    if (netExposureUsd > 0) {
      biasLabel = `Net Long ${magnitudePct.toFixed(1)}%`;
    } else if (netExposureUsd < 0) {
      biasLabel = `Net Short ${magnitudePct.toFixed(1)}%`;
    }
  }

  return {
    totalEquityUsd,
    spotUsd,
    stakedUsd,
    perpsEquityUsd,
    realizedAllTimeUsd,
    realizedDelta24hUsd: delta24h.delta,
    realizedDelta24hPct: computePercentDelta(delta24h.delta, delta24h.baseValue),
    realizedDelta7dUsd: delta7d.delta,
    realizedDelta7dPct: computePercentDelta(delta7d.delta, delta7d.baseValue),
    marginUsedUsd: positionSnapshot?.marginUsedUsd ?? 0,
    marginUsedPct:
      perpsEquityUsd > 0 ? ((positionSnapshot?.marginUsedUsd ?? 0) / perpsEquityUsd) * 100 : null,
    effectiveLeverage:
      perpsEquityUsd > 0 ? (positionSnapshot?.totalNotionalUsd ?? 0) / perpsEquityUsd : null,
    biasLabel,
    longPct: totalExposureUsd > 0 ? (longExposureUsd / totalExposureUsd) * 100 : 0,
    shortPct: totalExposureUsd > 0 ? (shortExposureUsd / totalExposureUsd) * 100 : 0,
    longCount: positionSnapshot?.longCount ?? 0,
    shortCount: positionSnapshot?.shortCount ?? 0,
  };
}

export function buildCompositionSlices(metrics) {
  const spotUsd = Math.max(0, metrics?.spotUsd ?? 0);
  const stakedUsd = Math.max(0, metrics?.stakedUsd ?? 0);
  const perpsUsd = Math.max(0, metrics?.perpsEquityUsd ?? 0);
  const total = spotUsd + stakedUsd + perpsUsd;

  return [
    {
      key: "spot",
      label: "Spot",
      valueUsd: spotUsd,
      percent: total > 0 ? (spotUsd / total) * 100 : 0,
    },
    {
      key: "staked",
      label: "Staked",
      valueUsd: stakedUsd,
      percent: total > 0 ? (stakedUsd / total) * 100 : 0,
    },
    {
      key: "perps",
      label: "Perps",
      valueUsd: perpsUsd,
      percent: total > 0 ? (perpsUsd / total) * 100 : 0,
    },
  ];
}

export function buildAssetPerformanceRows(fills) {
  const groups = new Map();

  for (const fill of fills ?? []) {
    const coin = String(fill?.coin ?? "").trim();
    if (!coin) {
      continue;
    }

    const realizedPnl = toNumber(fill.closedPnl);
    const volume = Math.abs(toNumber(fill.px) * toNumber(fill.sz));
    const fee = Math.abs(toNumber(fill.fee));
    const builderFee = Math.abs(toNumber(fill.builderFee));
    const current = groups.get(coin) ?? {
      coin,
      realizedPnl: 0,
      volume: 0,
      tradeCount: 0,
      winningTrades: 0,
      losingTrades: 0,
      grossWins: 0,
      grossLosses: 0,
      largestWin: 0,
      largestLoss: 0,
      fees: 0,
      builderFees: 0,
    };

    current.realizedPnl += realizedPnl;
    current.volume += volume;
    current.tradeCount += 1;
    current.fees += fee;
    current.builderFees += builderFee;

    if (realizedPnl > 0) {
      current.winningTrades += 1;
      current.grossWins += realizedPnl;
      current.largestWin = Math.max(current.largestWin, realizedPnl);
    } else if (realizedPnl < 0) {
      current.losingTrades += 1;
      current.grossLosses += Math.abs(realizedPnl);
      current.largestLoss = Math.min(current.largestLoss, realizedPnl);
    }

    groups.set(coin, current);
  }

  return Array.from(groups.values()).map((row) => ({
    ...row,
    winRate: row.tradeCount > 0 ? (row.winningTrades / row.tradeCount) * 100 : 0,
    avgWin: row.winningTrades > 0 ? row.grossWins / row.winningTrades : 0,
    avgLoss: row.losingTrades > 0 ? -row.grossLosses / row.losingTrades : 0,
  }));
}

export function buildTradeStatistics(fills) {
  const trades = fills ?? [];
  let winningTrades = 0;
  let losingTrades = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let largestWin = 0;
  let largestLoss = 0;

  for (const fill of trades) {
    const pnl = toNumber(fill.closedPnl);
    if (pnl > 0) {
      winningTrades += 1;
      grossWins += pnl;
      largestWin = Math.max(largestWin, pnl);
    } else if (pnl < 0) {
      losingTrades += 1;
      grossLosses += Math.abs(pnl);
      largestLoss = Math.min(largestLoss, pnl);
    }
  }

  const totalTrades = trades.length;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
    avgWin: winningTrades > 0 ? grossWins / winningTrades : 0,
    avgLoss: losingTrades > 0 ? -grossLosses / losingTrades : 0,
    largestWin,
    largestLoss,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
  };
}

export function buildOpenOrderGroups(orders) {
  const groups = new Map();

  for (const order of orders ?? []) {
    const coin = String(order?.coin ?? "").trim();
    const side = String(order?.side ?? "").trim().toUpperCase();
    const key = `${coin}:${side}`;
    const limitPrice = toNumber(order?.limitPx);
    const size = toNumber(order?.sz);
    const current = groups.get(key) ?? {
      id: key,
      coin,
      side,
      ordersCount: 0,
      totalSize: 0,
      totalNotionalUsd: 0,
      minLimitPrice: Number.POSITIVE_INFINITY,
      maxLimitPrice: 0,
      dexes: new Set(),
      orders: [],
    };

    current.ordersCount += 1;
    current.totalSize += size;
    current.totalNotionalUsd += Math.abs(limitPrice * size);
    current.minLimitPrice = Math.min(current.minLimitPrice, limitPrice);
    current.maxLimitPrice = Math.max(current.maxLimitPrice, limitPrice);
    if (order?.dex !== undefined) {
      current.dexes.add(order.dex || "main");
    }
    current.orders.push(order);
    groups.set(key, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      dexes: Array.from(group.dexes),
    }))
    .sort((left, right) => right.totalNotionalUsd - left.totalNotionalUsd);
}

export function buildTradeRows(fills) {
  return [...(fills ?? [])]
    .map((fill) => ({
      ...fill,
      parsedTime: Number(fill?.time),
      price: toNumber(fill?.px),
      size: toNumber(fill?.sz),
      feeUsd: toNumber(fill?.fee),
      closedPnlUsd: toNumber(fill?.closedPnl),
      notionalUsd: Math.abs(toNumber(fill?.px) * toNumber(fill?.sz)),
      direction: formatTradeDirection(fill),
    }))
    .filter((fill) => Number.isFinite(fill.parsedTime))
    .sort((left, right) => right.parsedTime - left.parsedTime);
}

export function buildTransactionRows(entries, currentWalletAddress) {
  return [...(entries ?? [])]
    .map((entry) => {
      const delta = entry?.delta ?? {};
      const from = delta.user ?? delta.from ?? delta.source ?? delta.sourceUser ?? delta.sender ?? null;
      const to = delta.destination ?? delta.to ?? delta.target ?? delta.recipient ?? null;
      const token = delta.token ?? delta.coin ?? delta.asset ?? delta.feeToken ?? "—";
      const amount = toNumber(delta.amount ?? delta.sz ?? delta.delta ?? delta.usdcValue);
      const usdValue = toNumber(delta.usdcValue);

      return {
        id: `${entry?.hash ?? "tx"}:${entry?.time ?? 0}`,
        time: Number(entry?.time),
        hash: entry?.hash ?? "",
        type: delta.type ?? "unknown",
        from,
        to,
        token,
        amount,
        usdValue: Number.isFinite(usdValue) ? usdValue : null,
        currentWalletAddress,
      };
    })
    .filter((entry) => Number.isFinite(entry.time))
    .sort((left, right) => right.time - left.time);
}

export function buildNotionalDeltaRows(payload) {
  return [...(payload?.deltas ?? [])].map((entry) => ({
    symbol: entry.symbol,
    deltas: {
      "1h": toNumber(entry?.deltas?.["1h"]),
      "4h": toNumber(entry?.deltas?.["4h"]),
      "12h": toNumber(entry?.deltas?.["12h"]),
      "1d": toNumber(entry?.deltas?.["1d"]),
      "7d": toNumber(entry?.deltas?.["7d"]),
    },
  }));
}

export function formatTradeDirection(fill) {
  const explicitDirection = String(fill?.dir ?? "").trim();
  if (explicitDirection) {
    return explicitDirection.toUpperCase();
  }

  return String(fill?.side ?? "").trim().toUpperCase() === "B" ? "BUY" : "SELL";
}

export function formatPerformanceAxisLabel(timestamp, range) {
  const date = new Date(timestamp);

  if (range === "24h") {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (range === "7d") {
    return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${date.getHours()}h`;
  }

  if (range === "30d") {
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    year: "2-digit",
  });
}

export function formatPerformanceTooltip(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateDay(timestamp) {
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
