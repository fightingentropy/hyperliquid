import { formatPrice } from "./formatters";
import { buildHoldingsSnapshot, buildPositionSnapshot, toNumber } from "./wallet";

export const FLOW_WINDOWS = [
  { value: "24h", label: "24h", ms: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  { value: "7d", label: "7d", ms: 7 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000 },
];

export const MAX_FLOW_WINDOW_MS = Math.max(...FLOW_WINDOWS.map((window) => window.ms));

// Spot tokens that wrap a perp-listed asset, so spot and perp flow on the same
// asset land in one row.
const SPOT_ALIASES = { UBTC: "BTC", UETH: "ETH", USOL: "SOL" };

export function spotTokenSymbol(token) {
  const upper = String(token ?? "").toUpperCase();
  return SPOT_ALIASES[upper] ?? upper;
}

// Hyperliquid's system addresses: 0x2000…<token index> bridges a spot token to
// HyperEVM, 0x2222…2222 bridges HYPE.
export function isHyperEvmSystemAddress(address) {
  const value = String(address ?? "").toLowerCase();
  return value === "0x2222222222222222222222222222222222222222" || /^0x2000000000000000000000000000[0-9a-f]{12}$/.test(value);
}

export function buildSpotPairNames(spotMetaAndAssetCtxs) {
  const meta = spotMetaAndAssetCtxs?.[0];
  const tokenNames = new Map((meta?.tokens ?? []).map((token) => [token.index, String(token.name ?? "")]));
  const names = new Map();
  for (const pair of meta?.universe ?? []) {
    const base = tokenNames.get(pair?.tokens?.[0]);
    if (pair?.name && base) {
      names.set(pair.name, base);
    }
  }
  return names;
}

// "BTC" → perp; "@107" / "PURR/USDC" → spot; "xyz:NVDA" → HIP-3 dex market.
export function describeCoin(coin, spotPairNames) {
  const raw = String(coin ?? "");
  if (raw.startsWith("@") || raw.includes("/")) {
    const base = spotPairNames?.get(raw) ?? raw.split("/")[0];
    const upper = base.toUpperCase();
    return { symbol: SPOT_ALIASES[upper] ?? upper, market: "spot" };
  }
  const separator = raw.indexOf(":");
  if (separator > 0) {
    return { symbol: raw.slice(separator + 1).toUpperCase(), market: raw.slice(0, separator) };
  }
  return { symbol: raw.toUpperCase(), market: "perp" };
}

export function walletDisplayName(wallet) {
  if (wallet?.label) {
    return wallet.label;
  }
  const address = String(wallet?.address ?? "");
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function fillNotional(fill) {
  return Math.abs(toNumber(fill?.sz) * toNumber(fill?.px));
}

function windowFills(fills, since) {
  return (fills ?? []).filter((fill) => Number(fill?.time) >= since);
}

// --- Per-wallet snapshot ---------------------------------------------------

export function buildWalletSnapshot({ wallet, clearinghouseEntries, spotState, stakingSummary, spotMetaAndAssetCtxs, hypeMid }) {
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
    : 0;

  return {
    wallet,
    positions: positions.positions,
    perpsUsd: positions.accountValueUsd,
    spotUsd: holdings.totalValueUsd,
    stakedHype,
    stakedUsd: stakedHype * price,
    equityUsd: positions.accountValueUsd + holdings.totalValueUsd + stakedHype * price,
    longUsd: positions.longExposureUsd,
    shortUsd: positions.shortExposureUsd,
    notionalUsd: positions.totalNotionalUsd,
    unrealizedPnlUsd: positions.totalUnrealizedPnlUsd,
    leverage: positions.accountValueUsd > 0 ? positions.totalNotionalUsd / positions.accountValueUsd : null,
  };
}

// --- Positioning -------------------------------------------------------------

export function buildPositioning(snapshots) {
  const bySymbol = new Map();

  for (const snapshot of snapshots) {
    for (const position of snapshot.positions ?? []) {
      const { symbol, market } = describeCoin(position.coin);
      const row = bySymbol.get(symbol) ?? { symbol, markets: new Set(), longUsd: 0, shortUsd: 0, longs: [], shorts: [] };
      const entry = {
        address: snapshot.wallet.address,
        name: walletDisplayName(snapshot.wallet),
        valueUsd: position.positionValueUsd,
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        unrealizedPnlUsd: position.unrealizedPnlUsd,
        leverage: position.leverage,
      };
      row.markets.add(market);
      if (position.side === "LONG") {
        row.longUsd += position.positionValueUsd;
        row.longs.push(entry);
      } else if (position.side === "SHORT") {
        row.shortUsd += position.positionValueUsd;
        row.shorts.push(entry);
      }
      bySymbol.set(symbol, row);
    }
  }

  return Array.from(bySymbol.values())
    .map((row) => ({
      ...row,
      markets: Array.from(row.markets),
      netUsd: row.longUsd - row.shortUsd,
      grossUsd: row.longUsd + row.shortUsd,
      longs: row.longs.sort((a, b) => b.valueUsd - a.valueUsd),
      shorts: row.shorts.sort((a, b) => b.valueUsd - a.valueUsd),
    }))
    .sort((a, b) => b.grossUsd - a.grossUsd);
}

// --- Net buying and selling ------------------------------------------------

export function buildNetFlows(walletFills, { since, spotPairNames }) {
  const byAsset = new Map();
  const byWallet = [];
  const totals = { buyUsd: 0, sellUsd: 0, netUsd: 0, realizedPnlUsd: 0, feesUsd: 0, trades: 0 };

  for (const { wallet, fills } of walletFills) {
    const walletRow = {
      address: wallet.address,
      name: walletDisplayName(wallet),
      buyUsd: 0,
      sellUsd: 0,
      netUsd: 0,
      realizedPnlUsd: 0,
      feesUsd: 0,
      trades: 0,
      netByAsset: {},
    };

    for (const fill of windowFills(fills, since)) {
      const { symbol, market } = describeCoin(fill.coin, spotPairNames);
      const notional = fillNotional(fill);
      const isBuy = fill.side === "B";
      const signed = isBuy ? notional : -notional;
      const pnl = toNumber(fill.closedPnl);
      const fee = toNumber(fill.fee);

      const asset = byAsset.get(symbol) ?? {
        symbol,
        buyUsd: 0,
        sellUsd: 0,
        perpNetUsd: 0,
        spotNetUsd: 0,
        trades: 0,
        byWallet: new Map(),
      };
      asset[isBuy ? "buyUsd" : "sellUsd"] += notional;
      asset[market === "spot" ? "spotNetUsd" : "perpNetUsd"] += signed;
      asset.trades += 1;
      asset.byWallet.set(wallet.address, (asset.byWallet.get(wallet.address) ?? 0) + signed);
      byAsset.set(symbol, asset);

      walletRow[isBuy ? "buyUsd" : "sellUsd"] += notional;
      walletRow.netUsd += signed;
      walletRow.realizedPnlUsd += pnl;
      walletRow.feesUsd += fee;
      walletRow.trades += 1;
      walletRow.netByAsset[symbol] = (walletRow.netByAsset[symbol] ?? 0) + signed;
    }

    totals.buyUsd += walletRow.buyUsd;
    totals.sellUsd += walletRow.sellUsd;
    totals.netUsd += walletRow.netUsd;
    totals.realizedPnlUsd += walletRow.realizedPnlUsd;
    totals.feesUsd += walletRow.feesUsd;
    totals.trades += walletRow.trades;
    byWallet.push(walletRow);
  }

  const names = new Map(walletFills.map(({ wallet }) => [wallet.address, walletDisplayName(wallet)]));
  const assets = Array.from(byAsset.values())
    .map((asset) => ({
      symbol: asset.symbol,
      buyUsd: asset.buyUsd,
      sellUsd: asset.sellUsd,
      netUsd: asset.buyUsd - asset.sellUsd,
      grossUsd: asset.buyUsd + asset.sellUsd,
      perpNetUsd: asset.perpNetUsd,
      spotNetUsd: asset.spotNetUsd,
      trades: asset.trades,
      wallets: Array.from(asset.byWallet.entries())
        .map(([address, netUsd]) => ({ address, name: names.get(address), netUsd }))
        .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd)),
    }))
    .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd));

  return { assets, byWallet, totals };
}

export function buildFlowTimeline(walletFills, { since, until, bucketMs, symbol = null, spotPairNames }) {
  const start = Math.floor(since / bucketMs) * bucketMs;
  const buckets = [];
  for (let time = start; time <= until; time += bucketMs) {
    buckets.push({ start: time, buyUsd: 0, sellUsd: 0, netUsd: 0 });
  }

  for (const { fills } of walletFills) {
    for (const fill of windowFills(fills, since)) {
      if (symbol && describeCoin(fill.coin, spotPairNames).symbol !== symbol) {
        continue;
      }
      const index = Math.floor((Number(fill.time) - start) / bucketMs);
      const bucket = buckets[index];
      if (!bucket) {
        continue;
      }
      const notional = fillNotional(fill);
      if (fill.side === "B") {
        bucket.buyUsd += notional;
        bucket.netUsd += notional;
      } else {
        bucket.sellUsd += notional;
        bucket.netUsd -= notional;
      }
    }
  }

  return buckets;
}

export const MOVE_GAP_MS = 2 * 60 * 60 * 1000;

// A "move" is a run of fills on one market in one direction (e.g. Open Long)
// with less than MOVE_GAP_MS between them, so an entry built from many small
// orders or a TWAP reads as one trade. Largest notional first.
export function buildBigMoves(walletFills, { since, spotPairNames, limit = 12, gapMs = MOVE_GAP_MS }) {
  const moves = [];

  for (const { wallet, fills } of walletFills) {
    const open = new Map();
    const sorted = windowFills(fills, since).sort((a, b) => Number(a.time) - Number(b.time));

    for (const fill of sorted) {
      const time = Number(fill.time);
      const runKey = `${fill.coin}:${fill.dir}`;
      let move = open.get(runKey);
      if (!move || time - move.lastAt > gapMs) {
        const { symbol, market } = describeCoin(fill.coin, spotPairNames);
        move = {
          key: `${wallet.address}:${runKey}:${time}`,
          address: wallet.address,
          name: walletDisplayName(wallet),
          symbol,
          market,
          dir: fill.dir,
          side: fill.side,
          isTwap: false,
          size: 0,
          notionalUsd: 0,
          realizedPnlUsd: 0,
          fills: 0,
          firstAt: time,
          lastAt: time,
        };
        open.set(runKey, move);
        moves.push(move);
      }
      move.size += toNumber(fill.sz);
      move.notionalUsd += fillNotional(fill);
      move.realizedPnlUsd += toNumber(fill.closedPnl);
      move.fills += 1;
      move.isTwap = move.isTwap || fill.twapId != null;
      move.lastAt = time;
    }
  }

  return moves
    .map((move) => ({ ...move, avgPrice: move.size > 0 ? move.notionalUsd / move.size : null }))
    .sort((a, b) => b.notionalUsd - a.notionalUsd)
    .slice(0, limit);
}

// --- Capital flows ---------------------------------------------------------

function usdValue(delta, prices) {
  const usdc = toNumber(delta.usdcValue);
  if (usdc > 0) {
    return usdc;
  }
  const amount = toNumber(delta.amount ?? delta.usdc);
  const token = String(delta.token ?? "USDC").toUpperCase();
  return token === "USDC" ? amount : amount * (prices?.get(token) ?? 0);
}

export function buildCapitalFlows(walletLedgers, { since, prices }) {
  return walletLedgers.map(({ wallet, ledger }) => {
    const self = wallet.address.toLowerCase();
    const row = {
      address: wallet.address,
      name: walletDisplayName(wallet),
      bridgeInUsd: 0,
      bridgeOutUsd: 0,
      evmInUsd: 0,
      evmOutUsd: 0,
      transferInUsd: 0,
      transferOutUsd: 0,
      stakedHype: 0,
      unstakedHype: 0,
      events: 0,
    };
    const counterparties = new Map();

    for (const entry of ledger ?? []) {
      if (Number(entry?.time) < since) {
        continue;
      }
      const delta = entry?.delta ?? {};
      const type = delta.type;

      if (type === "deposit") {
        row.bridgeInUsd += toNumber(delta.usdc);
      } else if (type === "withdraw") {
        row.bridgeOutUsd += toNumber(delta.usdc);
      } else if (type === "cStakingTransfer") {
        row[delta.isDeposit ? "stakedHype" : "unstakedHype"] += toNumber(delta.amount);
      } else if (["send", "spotTransfer", "internalTransfer"].includes(type)) {
        const from = String(delta.user ?? self).toLowerCase();
        const to = String(delta.destination ?? "").toLowerCase();
        if (from === to) {
          continue; // spot ↔ perp shuffle inside one account
        }
        const value = usdValue(delta, prices);
        const incoming = to === self;
        const counterparty = incoming ? from : to;
        if (isHyperEvmSystemAddress(counterparty)) {
          row[incoming ? "evmInUsd" : "evmOutUsd"] += value;
        } else {
          row[incoming ? "transferInUsd" : "transferOutUsd"] += value;
          const totals = counterparties.get(counterparty) ?? { inUsd: 0, outUsd: 0 };
          totals[incoming ? "inUsd" : "outUsd"] += value;
          counterparties.set(counterparty, totals);
        }
      } else {
        continue;
      }
      row.events += 1;
    }

    const inUsd = row.bridgeInUsd + row.evmInUsd + row.transferInUsd;
    const outUsd = row.bridgeOutUsd + row.evmOutUsd + row.transferOutUsd;
    return {
      ...row,
      inUsd,
      outUsd,
      netUsd: inUsd - outUsd,
      counterparties: Array.from(counterparties.entries()).map(([address, totals]) => ({ address, ...totals })),
    };
  });
}

// Outside addresses that moved money with two or more tracked wallets, e.g. a
// common funder. Tracked wallets paying each other count too.
export function buildSharedCounterparties(capitalFlows) {
  const byAddress = new Map();
  for (const row of capitalFlows) {
    for (const party of row.counterparties ?? []) {
      const entry = byAddress.get(party.address) ?? { address: party.address, inUsd: 0, outUsd: 0, wallets: [] };
      entry.inUsd += party.inUsd;
      entry.outUsd += party.outUsd;
      entry.wallets.push({ address: row.address, name: row.name, inUsd: party.inUsd, outUsd: party.outUsd });
      byAddress.set(party.address, entry);
    }
  }
  return Array.from(byAddress.values())
    .filter((entry) => entry.wallets.length >= 2)
    .sort((a, b) => b.inUsd + b.outUsd - (a.inUsd + a.outUsd));
}

// --- Risk --------------------------------------------------------------------

// Dust positions (a few dollars) can sit right next to liquidation and say nothing.
export const MIN_LIQUIDATION_VALUE_USD = 100;
export const MIN_RISK_SIGNAL_USD = 10_000;

export function buildLiquidationWatch(snapshots) {
  const rows = [];
  for (const snapshot of snapshots) {
    for (const position of snapshot.positions ?? []) {
      const liq = position.liquidationPrice;
      const mark = position.markPrice;
      if (!(position.positionValueUsd >= MIN_LIQUIDATION_VALUE_USD)) {
        continue;
      }
      if (!Number.isFinite(liq) || liq <= 0 || !Number.isFinite(mark) || mark <= 0) {
        continue;
      }
      const distancePct = position.side === "LONG" ? ((mark - liq) / mark) * 100 : ((liq - mark) / mark) * 100;
      const { symbol, market } = describeCoin(position.coin);
      rows.push({
        key: `${snapshot.wallet.address}:${position.id}`,
        address: snapshot.wallet.address,
        name: walletDisplayName(snapshot.wallet),
        symbol,
        market,
        side: position.side,
        valueUsd: position.positionValueUsd,
        entryPrice: position.entryPrice,
        markPrice: mark,
        liquidationPrice: liq,
        distancePct,
        leverage: position.leverage,
        unrealizedPnlUsd: position.unrealizedPnlUsd,
      });
    }
  }
  return rows.sort((a, b) => a.distancePct - b.distancePct);
}

// --- Signals -----------------------------------------------------------------

function compactUsd(value) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`;
  return `$${abs.toFixed(0)}`;
}

function listNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const MIN_SIGNAL_USD = 50_000;

// Plain-language findings, most decision-relevant first. Each rule only fires
// when the numbers clear a floor, so quiet weeks produce few signals.
export function buildSignals({ positioning, netFlows, liquidationWatch, snapshots, capitalFlows, windowLabel }) {
  const signals = [];

  const topBuy = netFlows.assets.filter((a) => a.netUsd >= MIN_SIGNAL_USD).sort((a, b) => b.netUsd - a.netUsd)[0];
  if (topBuy) {
    const buyers = topBuy.wallets.filter((w) => w.netUsd > 0).map((w) => w.name);
    signals.push({
      kind: "buy",
      text: `Most net buying in ${windowLabel}: ${compactUsd(topBuy.netUsd)} of ${topBuy.symbol}, led by ${listNames(buyers.slice(0, 2))}.`,
    });
  }

  const topSell = netFlows.assets.filter((a) => a.netUsd <= -MIN_SIGNAL_USD).sort((a, b) => a.netUsd - b.netUsd)[0];
  if (topSell) {
    const sellers = topSell.wallets.filter((w) => w.netUsd < 0).map((w) => w.name);
    signals.push({
      kind: "sell",
      text: `Most net selling in ${windowLabel}: ${compactUsd(topSell.netUsd)} of ${topSell.symbol}, led by ${listNames(sellers.slice(0, 2))}.`,
    });
  }

  const agreed = netFlows.assets.find(
    (a) => a.wallets.length >= 2 && Math.abs(a.netUsd) >= MIN_SIGNAL_USD && a.wallets.every((w) => Math.sign(w.netUsd) === Math.sign(a.netUsd)),
  );
  if (agreed) {
    signals.push({
      kind: agreed.netUsd > 0 ? "buy" : "sell",
      text: `${agreed.wallets.length} wallets all ${agreed.netUsd > 0 ? "bought" : "sold"} ${agreed.symbol} on net in ${windowLabel}, with none on the other side.`,
    });
  }

  const contested = positioning.find((row) => row.longs.length && row.shorts.length && row.grossUsd >= MIN_SIGNAL_USD);
  if (contested) {
    signals.push({
      kind: "info",
      text: `Split on ${contested.symbol}: ${contested.longs.length} long (${compactUsd(contested.longUsd)}) against ${contested.shorts.length} short (${compactUsd(contested.shortUsd)}).`,
    });
  }

  const oneSided = positioning.find((row) => row.longs.length + row.shorts.length >= 2 && (!row.longs.length || !row.shorts.length) && row.grossUsd >= MIN_SIGNAL_USD);
  if (oneSided) {
    const side = oneSided.longs.length ? "long" : "short";
    const count = oneSided.longs.length || oneSided.shorts.length;
    signals.push({
      kind: "info",
      text: `All ${count} wallets holding ${oneSided.symbol} are ${side}, ${compactUsd(oneSided.grossUsd)} in total.`,
    });
  }

  const nearLiq = liquidationWatch.find((row) => row.distancePct < 20 && row.valueUsd >= MIN_RISK_SIGNAL_USD);
  if (nearLiq) {
    signals.push({
      kind: "risk",
      text: `${nearLiq.name}'s ${compactUsd(nearLiq.valueUsd)} ${nearLiq.symbol} ${nearLiq.side.toLowerCase()} is ${nearLiq.distancePct.toFixed(1)}% from liquidation at ${formatPrice(nearLiq.liquidationPrice)}.`,
    });
  }

  const shared = buildSharedCounterparties(capitalFlows)[0];
  if (shared && shared.inUsd + shared.outUsd >= MIN_SIGNAL_USD) {
    const short = `${shared.address.slice(0, 6)}…${shared.address.slice(-4)}`;
    const direction = shared.inUsd >= shared.outUsd ? `sent ${compactUsd(shared.inUsd)} to` : `received ${compactUsd(shared.outUsd)} from`;
    signals.push({
      kind: "info",
      text: `Shared counterparty: ${short} ${direction} ${listNames(shared.wallets.map((wallet) => wallet.name))} in ${windowLabel}.`,
      address: shared.address,
    });
  }

  const bigOut = capitalFlows.filter((row) => row.netUsd <= -MIN_SIGNAL_USD).sort((a, b) => a.netUsd - b.netUsd)[0];
  if (bigOut) {
    signals.push({
      kind: "info",
      text: `${bigOut.name} moved ${compactUsd(bigOut.netUsd)} more out than in over ${windowLabel} (withdrawals, HyperEVM and transfers).`,
    });
  }

  const quiet = netFlows.byWallet.filter((row) => row.trades === 0).map((row) => row.name);
  if (quiet.length && quiet.length < snapshots.length) {
    signals.push({
      kind: "info",
      text: `${listNames(quiet)} ${quiet.length === 1 ? "hasn't" : "haven't"} traded in ${windowLabel}.`,
    });
  }

  return signals;
}
