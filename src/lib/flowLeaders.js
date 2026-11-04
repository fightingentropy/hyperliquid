import { formatPrice } from "./formatters";
import { MIN_RISK_SIGNAL_USD, describeCoin, spotTokenSymbol, walletDisplayName } from "./trackedWallets";
import { toNumber } from "./wallet";

export const LEADER_WINDOWS = ["1h", "4h", "24h", "7d", "30d"];
export const LEADER_LIMIT = 25;

const ONE_SIDED_RATIO = 0.8;
const TWO_SIDED_RATIO = 0.3;
const TWO_SIDED_MIN_TRADES = 1000;

// How much of a wallet's volume its net flow is. Near 1: it only bought (or
// only sold). Low with many trades: it trades both sides heavily, like a market
// maker, so its net says little about direction.
export function flowStyle(row) {
  const ratio = row.totalUsd > 0 ? Math.abs(row.netUsd) / row.totalUsd : 1;
  if (ratio >= ONE_SIDED_RATIO) return "one-sided";
  if (ratio < TWO_SIDED_RATIO && row.tradeCount >= TWO_SIDED_MIN_TRADES) return "two-sided";
  return "mixed";
}

// Top net buyers and sellers from a Qwantify market-flow batch, with labels.
export function buildLeaders(batch) {
  const labels = batch?.labels ?? {};
  const leaders = [];
  const seen = new Set();

  for (const [cohort, key] of [
    ["buyer", "topBuys"],
    ["seller", "topSells"],
  ]) {
    (batch?.[key]?.top ?? []).forEach((row, index) => {
      const address = String(row?.wallet ?? "").trim().toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(address) || seen.has(address)) {
        return;
      }
      seen.add(address);
      const netUsd = toNumber(row.netUsd);
      const netSize = toNumber(row.netSize);
      const entry = {
        address,
        label: labels[address]?.name ?? null,
        cohort,
        rank: index + 1,
        netUsd,
        totalUsd: toNumber(row.totalUsd),
        netSize,
        tradeCount: toNumber(row.tradeCount),
        avgEntry: netSize ? Math.abs(netUsd / netSize) : null,
      };
      leaders.push({ ...entry, style: flowStyle(entry) });
    });
  }

  return leaders;
}

// A wallet's current exposure to one asset: perp positions on any dex plus the
// spot balance, in USD. Longs and spot count positive, shorts negative.
export function assetExposure({ snapshot, spotState, prices, symbol }) {
  let perpUsd = 0;
  let unrealizedPnlUsd = 0;
  let entryPrice = null;
  let markPrice = null;
  let leverage = null;
  let liquidationPrice = null;

  for (const position of snapshot?.positions ?? []) {
    if (describeCoin(position.coin).symbol !== symbol) {
      continue;
    }
    const signed = position.side === "SHORT" ? -position.positionValueUsd : position.positionValueUsd;
    perpUsd += signed;
    unrealizedPnlUsd += position.unrealizedPnlUsd;
    entryPrice = entryPrice ?? position.entryPrice;
    markPrice = markPrice ?? position.markPrice;
    leverage = leverage ?? position.leverage;
    liquidationPrice = liquidationPrice ?? position.liquidationPrice;
  }

  let spotUsd = 0;
  for (const balance of spotState?.balances ?? []) {
    if (spotTokenSymbol(balance?.coin) === symbol) {
      spotUsd += toNumber(balance.total) * (prices?.get(String(balance.coin).toUpperCase()) ?? 0);
    }
  }

  const netUsd = perpUsd + spotUsd;
  return {
    perpUsd,
    spotUsd,
    netUsd,
    side: exposureSide(perpUsd, spotUsd),
    entryPrice,
    markPrice,
    leverage,
    liquidationPrice,
    unrealizedPnlUsd,
  };
}

// A perp short mostly offset by spot is a hedge (basis / delta-neutral trade),
// not a bet against the asset. Otherwise the side follows net exposure.
const HEDGE_MAX_NET_SHARE = 0.25;

export function exposureSide(perpUsd, spotUsd) {
  const netUsd = perpUsd + spotUsd;
  if (perpUsd < 0 && spotUsd > 0 && Math.abs(netUsd) <= HEDGE_MAX_NET_SHARE * Math.abs(perpUsd)) {
    return "hedged";
  }
  if (netUsd > 0) return perpUsd > 0 ? "long" : "spot";
  if (netUsd < 0) return "short";
  return "flat";
}

// The amount behind the side: net exposure, or the hedged short's size.
export function exposureAmount(exposure) {
  if (!exposure || exposure.side === "flat") return 0;
  if (exposure.side === "hedged") return Math.abs(exposure.perpUsd);
  return Math.abs(exposure.netUsd);
}

// Prices of $10 and up read best with cents; smaller ones keep formatPrice's precision.
export function formatTradePrice(value) {
  if (!Number.isFinite(value)) return "—";
  return value >= 10
    ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : formatPrice(value);
}

// Volume-weighted price the cohort traded at: net notional over net size.
export function cohortAverageEntry(leaders) {
  const notional = leaders.reduce((sum, leader) => sum + Math.abs(leader.netUsd), 0);
  const size = leaders.reduce((sum, leader) => sum + Math.abs(leader.netSize), 0);
  return size > 0 ? notional / size : null;
}

function compactUsd(value) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`;
  return `$${abs.toFixed(0)}`;
}

function listNames(names, max = 3) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  const head = shown.length <= 1 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return extra > 0 ? `${shown.join(", ")} and ${extra} more` : head;
}

function sumExposure(rows) {
  return rows.reduce((sum, row) => sum + exposureAmount(row), 0);
}

// Plain-language read on what the top buyers and sellers are doing, from their
// flow in this market plus their live positions.
export function buildLeaderSignals({ leaders, exposures, symbol, windowLabel, markPrice, positioningByCohort, myAddresses = new Set(), liquidationWatch = [] }) {
  const signals = [];
  const loaded = leaders.filter((leader) => exposures.has(leader.address));
  const buyers = loaded.filter((leader) => leader.cohort === "buyer");
  const sellers = loaded.filter((leader) => leader.cohort === "seller");

  const hedgedNote = (exp) => {
    const hedged = exp.filter((e) => e.side === "hedged");
    return hedged.length
      ? ` ${hedged.length} ${hedged.length === 1 ? "is" : "are"} hedged (a ${compactUsd(sumExposure(hedged))} perp short against spot), not a directional bet.`
      : "";
  };

  if (buyers.length) {
    const exp = buyers.map((leader) => exposures.get(leader.address));
    const longs = exp.filter((e) => e.side === "long" || e.side === "spot");
    const shorts = exp.filter((e) => e.side === "short");
    const tail = shorts.length
      ? ` ${shorts.length} ${shorts.length === 1 ? "is" : "are"} still net short (${compactUsd(sumExposure(shorts))}), so part of the buying was covering.`
      : "";
    signals.push({
      kind: "buy",
      text: `${longs.length} of ${buyers.length} top ${symbol} buyers (${windowLabel}) are net long ${symbol} now, ${compactUsd(sumExposure(longs))} in total.${tail}${hedgedNote(exp)}`,
    });
  }

  if (sellers.length) {
    const exp = sellers.map((leader) => exposures.get(leader.address));
    const shorts = exp.filter((e) => e.side === "short");
    const longs = exp.filter((e) => e.side === "long" || e.side === "spot");
    const flat = exp.filter((e) => e.side === "flat");
    const tail = longs.length
      ? ` ${longs.length} still hold ${symbol} net long (${compactUsd(sumExposure(longs))}), which reads as trimming or profit-taking.`
      : "";
    signals.push({
      kind: "sell",
      text: `${shorts.length} of ${sellers.length} top ${symbol} sellers are net short now (${compactUsd(sumExposure(shorts))}); ${flat.length} have no ${symbol} left.${tail}${hedgedNote(exp)}`,
    });
  }

  if (Number.isFinite(markPrice) && markPrice > 0) {
    const buyEntry = cohortAverageEntry(leaders.filter((leader) => leader.cohort === "buyer"));
    const sellEntry = cohortAverageEntry(leaders.filter((leader) => leader.cohort === "seller"));
    const parts = [];
    if (buyEntry) {
      const change = ((markPrice - buyEntry) / buyEntry) * 100;
      parts.push(`top buyers paid ${formatTradePrice(buyEntry)} on average (${change >= 0 ? "+" : ""}${change.toFixed(1)}% since)`);
    }
    if (sellEntry) {
      const change = ((markPrice - sellEntry) / sellEntry) * 100;
      parts.push(`top sellers sold at ${formatTradePrice(sellEntry)} (${change >= 0 ? "+" : ""}${change.toFixed(1)}% since)`);
    }
    if (parts.length) {
      const sentence = parts.join("; ");
      signals.push({ kind: "info", text: `${symbol} is ${formatTradePrice(markPrice)}: ${sentence}.` });
    }
  }

  const twoSided = leaders.filter((leader) => leader.style === "two-sided");
  if (twoSided.length) {
    const named = twoSided.filter((leader) => leader.label).map((leader) => leader.label);
    signals.push({
      kind: "info",
      text: `${twoSided.length} of the ${leaders.length} trade both sides heavily (net under 30% of their volume), likely market makers${named.length ? `, including ${listNames(named)}` : ""}. Their net says less about direction.`,
    });
  }

  const namedBuyers = leaders.filter((leader) => leader.cohort === "buyer" && leader.label && leader.style !== "two-sided").map((leader) => leader.label);
  const namedSellers = leaders.filter((leader) => leader.cohort === "seller" && leader.label && leader.style !== "two-sided").map((leader) => leader.label);
  if (namedBuyers.length || namedSellers.length) {
    const parts = [];
    if (namedBuyers.length) parts.push(`buying: ${listNames(namedBuyers)}`);
    if (namedSellers.length) parts.push(`selling: ${listNames(namedSellers)}`);
    signals.push({ kind: "info", text: `Known names ${parts.join("; ")}.` });
  }

  for (const [cohort, label] of [
    ["buyer", "Top buyers"],
    ["seller", "Top sellers"],
  ]) {
    const other = (positioningByCohort?.[cohort] ?? []).find((row) => row.symbol !== symbol && row.grossUsd >= 100_000);
    if (other) {
      const net = other.longUsd - other.shortUsd;
      signals.push({
        kind: "info",
        text: `${label}' biggest other bet is ${other.symbol}: net ${net >= 0 ? "long" : "short"} ${compactUsd(net)} across ${other.longs.length + other.shorts.length} wallets.`,
      });
    }
  }

  const nearLiq = liquidationWatch.find((row) => row.distancePct < 15 && row.valueUsd >= MIN_RISK_SIGNAL_USD);
  if (nearLiq) {
    signals.push({
      kind: "risk",
      text: `${nearLiq.name}'s ${compactUsd(nearLiq.valueUsd)} ${nearLiq.symbol} ${nearLiq.side.toLowerCase()} is ${nearLiq.distancePct.toFixed(1)}% from liquidation at ${formatTradePrice(nearLiq.liquidationPrice)}.`,
    });
  }

  const mine = leaders.filter((leader) => myAddresses.has(leader.address));
  if (mine.length) {
    signals.push({
      kind: "info",
      text: `Also on your tracked list: ${listNames(mine.map((leader) => `${walletDisplayName(leader)} (${leader.cohort === "buyer" ? "buying" : "selling"})`))}.`,
    });
  }

  return signals;
}
