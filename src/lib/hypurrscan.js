// Transforms for the HypurrScan dashboard widgets (network fees + the active
// TWAP table + HYPE TWAP buy pressure). The math mirrors what
// hypurrscan.io/dashboard does so the numbers line up with the source.

// HypurrScan reports cumulative fees as a fixed-point integer scaled by 1e6.
const FEE_SCALE = 1e6;
const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Hyperliquid asset-id layout: [0, 10000) primary perps (universe index),
// [10000, 100000) spot pairs (10000 + pair index), and >= 100000 HIP-3
// builder-dex perps (100000 + dexIndex * 10000 + universe index).
const SPOT_ASSET_OFFSET = 10_000;
const HIP3_ASSET_OFFSET = 100_000;
const HIP3_DEX_STRIDE = 10_000;

function sortByTimeAsc(points) {
  return [...points].sort((left, right) => left.time - right.time);
}

// Cumulative-fee delta (in dollars) between the first and last snapshot inside a
// [lowSec, highSec] window. Matches one snapshot to another the way HypurrScan
// does, so a window with fewer than two snapshots contributes nothing.
function feeDeltaInWindow(sortedPoints, lowSec, highSec) {
  const inWindow = sortedPoints.filter(
    (point) => point.time >= lowSec && (highSec == null || point.time <= highSec),
  );

  if (inWindow.length < 2) {
    return 0;
  }

  const first = inWindow[0].total_fees;
  const last = inWindow[inWindow.length - 1].total_fees;

  return (last - first) / FEE_SCALE;
}

// 24h fee total, the prior 24h for comparison, the percent change between them,
// and 24 hourly buckets for the mini chart.
export function computeFeeStats(feesRecent) {
  if (!Array.isArray(feesRecent) || feesRecent.length < 2) {
    return { daily: null, previous: null, changePct: null, hourly: [] };
  }

  const sorted = sortByTimeAsc(feesRecent);
  const latest = sorted[sorted.length - 1].time;

  const daily = feeDeltaInWindow(sorted, latest - DAY_SECONDS, null);
  const previous = feeDeltaInWindow(sorted, latest - DAY_SECONDS * 2, latest - DAY_SECONDS);
  const changePct = previous > 0 ? ((daily - previous) / previous) * 100 : null;

  // 24 hourly buckets ending at the latest snapshot's hour.
  const start = Math.floor(latest / HOUR_SECONDS) * HOUR_SECONDS - HOUR_SECONDS * 23;
  const windowed = sorted.filter((point) => point.time >= start);
  const hourly = [];

  for (let index = 0; index < 24; index += 1) {
    const bucketStart = start + index * HOUR_SECONDS;
    const bucketEnd = bucketStart + HOUR_SECONDS;
    const bucket = windowed.filter(
      (point) => point.time >= bucketStart && point.time < bucketEnd,
    );
    const value =
      bucket.length >= 2
        ? (bucket[bucket.length - 1].total_fees - bucket[0].total_fees) / FEE_SCALE
        : 0;

    hourly.push({ startSec: bucketStart, value });
  }

  return { daily, previous, changePct, hourly };
}

// Market segment for a TWAP's asset id, matching hypurrscan's Active TWAPs
// separation: primary perps, spot pairs, and HIP-3 builder-dex perps.
export function twapMarketSegment(marketId) {
  if (!Number.isFinite(marketId) || marketId < 0) {
    return null;
  }
  if (marketId < SPOT_ASSET_OFFSET) {
    return "perp";
  }
  if (marketId < HIP3_ASSET_OFFSET) {
    return "spot";
  }
  return "hip3";
}

// Which market-data sources a set of TWAP asset ids needs: the primary perp
// universe, the spot universe, and/or specific HIP-3 dexes (by perpDexs index).
export function selectTwapMarketSources(marketIds) {
  const ids = Array.isArray(marketIds) ? marketIds.filter(Number.isFinite) : [];

  return {
    needsPerp: ids.some((id) => id >= 0 && id < SPOT_ASSET_OFFSET),
    needsSpot: ids.some((id) => id >= SPOT_ASSET_OFFSET && id < HIP3_ASSET_OFFSET),
    hip3DexIndexes: [
      ...new Set(
        ids
          .filter((id) => id >= HIP3_ASSET_OFFSET)
          .map((id) => Math.floor((id - HIP3_ASSET_OFFSET) / HIP3_DEX_STRIDE)),
      ),
    ].sort((left, right) => left - right),
  };
}

function contextPrice(ctx) {
  const mid = Number(ctx?.midPx);
  if (Number.isFinite(mid) && mid > 0) {
    return mid;
  }

  const mark = Number(ctx?.markPx);
  return Number.isFinite(mark) && mark > 0 ? mark : null;
}

// Build the market-id -> { displayName, price, segment, isHypeSpot } directory
// used to label and value TWAP orders. `perpsByDexIndex` maps a perpDexs index
// to its metaAndAssetCtxs payload (0 = the primary universe). Display names
// follow hypurrscan: perps as "BTC-USD", spot as the base token ("HYPE"), and
// HIP-3 assets under their dex prefix ("xyz:SP500").
export function buildTwapMarketDirectory({ perpsByDexIndex, spotMetaAndAssetCtxs }) {
  const directory = new Map();

  Object.entries(perpsByDexIndex ?? {}).forEach(([dexIndexKey, payload]) => {
    const dexIndex = Number(dexIndexKey);
    if (!Number.isFinite(dexIndex) || dexIndex < 0 || !Array.isArray(payload)) {
      return;
    }

    const [meta, assetCtxs] = payload;
    (meta?.universe ?? []).forEach((asset, index) => {
      const name = asset?.name;
      if (!name) {
        return;
      }

      const marketId =
        dexIndex === 0 ? index : HIP3_ASSET_OFFSET + dexIndex * HIP3_DEX_STRIDE + index;

      directory.set(marketId, {
        marketId,
        displayName: dexIndex === 0 ? `${name}-USD` : name,
        iconCoin: name,
        segment: dexIndex === 0 ? "perp" : "hip3",
        price: contextPrice(assetCtxs?.[index]),
        isHypeSpot: false,
      });
    });
  });

  if (Array.isArray(spotMetaAndAssetCtxs) && spotMetaAndAssetCtxs.length >= 2) {
    const [meta, assetCtxs] = spotMetaAndAssetCtxs;
    const tokenByIndex = new Map((meta?.tokens ?? []).map((token) => [token?.index, token]));
    // The spot ctx list can be longer than the universe, so match by pair name
    // rather than array position.
    const ctxByCoin = new Map();
    (Array.isArray(assetCtxs) ? assetCtxs : []).forEach((ctx) => {
      if (ctx?.coin) {
        ctxByCoin.set(ctx.coin, ctx);
      }
    });

    (meta?.universe ?? []).forEach((pair) => {
      const pairIndex = Number(pair?.index);
      if (!Number.isFinite(pairIndex)) {
        return;
      }

      // A TWAP's size is denominated in the pair's base token (tokens[0]).
      const baseToken = tokenByIndex.get(pair?.tokens?.[0]);
      const marketId = SPOT_ASSET_OFFSET + pairIndex;
      const displayName = baseToken?.name || pair?.name || `@${pairIndex}`;

      directory.set(marketId, {
        marketId,
        displayName,
        iconCoin: displayName,
        segment: "spot",
        price: contextPrice(ctxByCoin.get(pair?.name)),
        isHypeSpot: baseToken?.name === "HYPE",
      });
    });
  }

  return directory;
}

export function createTwapTrackerState() {
  return { activeByHash: new Map(), endedHashes: new Set() };
}

// Merge a fresh `twap/*` snapshot into the running active-set state, mirroring
// hypurrscan's stateful poller: add newly-seen orders across every market,
// honor the `ended` flag (any truthy value — the feed reports both `true` and
// strings like "error"), retain orders that scroll out of the feed's rolling
// window, and prune ended or naturally-expired orders.
export function reconcileActiveTwaps(state, twaps, now) {
  const nextActive = new Map(state?.activeByHash ?? []);
  const nextEnded = new Set(state?.endedHashes ?? []);
  const entries = Array.isArray(twaps) ? twaps : [];

  for (const entry of entries) {
    const twap = entry?.action?.twap;
    const hash = entry?.hash;
    if (!twap || !hash) {
      continue;
    }

    if (entry.ended) {
      nextEnded.add(hash);
      nextActive.delete(hash);
      continue;
    }

    if (nextEnded.has(hash) || nextActive.has(hash)) {
      continue;
    }

    const marketId = Number(twap.a);
    const start = new Date(entry.time).getTime();
    const durationMs = Number(twap.m) * 60 * 1000;
    const amount = Number(twap.s);
    if (
      !Number.isFinite(marketId) ||
      !Number.isFinite(start) ||
      !(durationMs > 0) ||
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      continue;
    }

    nextActive.set(hash, {
      hash,
      user: typeof entry.user === "string" ? entry.user : "",
      marketId,
      segment: twapMarketSegment(marketId),
      isBuy: Boolean(twap.b),
      amount,
      start,
      end: start + durationMs,
      durationMs,
    });
  }

  // Prune orders that have run past their natural end.
  for (const [hash, record] of nextActive) {
    if (record.end <= now) {
      nextActive.delete(hash);
      nextEnded.add(hash);
    }
  }

  return { activeByHash: nextActive, endedHashes: nextEnded };
}

// Join the tracked active set with the market directory into display rows.
// Values are amount x current price (recomputed every poll, as hypurrscan
// does); unknown markets keep a null value so the UI can render a placeholder.
export function buildActiveTwapRows(state, directory) {
  const rows = [];

  for (const record of state?.activeByHash?.values() ?? []) {
    const market = directory?.get(record.marketId);
    const price = Number.isFinite(market?.price) ? market.price : null;

    rows.push({
      ...record,
      token: market?.displayName ?? `#${record.marketId}`,
      iconCoin: market?.iconCoin ?? "",
      value: price === null ? null : record.amount * price,
      isHypeSpot: Boolean(market?.isHypeSpot),
    });
  }

  return rows;
}

// Fraction of the order still left to execute at `now` (linear schedule).
// hypurrscan's Value column shows this remaining share of the notional.
export function twapRemainingFraction(record, now) {
  if (!record || !(record.durationMs > 0)) {
    return 0;
  }

  return Math.min(1, Math.max(0, (record.end - now) / record.durationMs));
}

// Net signed notional (buys positive, sells negative) that the active TWAPs will
// execute within the next `windowMs`, assuming each order executes linearly over
// its duration.
export function projectTwapPressure(activeTwaps, now, windowMs) {
  if (!Array.isArray(activeTwaps)) {
    return 0;
  }

  return activeTwaps.reduce((sum, twap) => {
    if (twap.end <= now) {
      return sum;
    }

    const segmentEnd = Math.min(twap.end, now + windowMs);
    const overlapMs = Math.max(0, segmentEnd - now);
    const notional = (twap.value / twap.durationMs) * overlapMs;

    return sum + (twap.isBuy ? notional : -notional);
  }, 0);
}

// Projected net flow over the next hour and next day.
export function summarizeTwapPressure(activeTwaps, now) {
  return {
    next1h: projectTwapPressure(activeTwaps, now, HOUR_MS),
    next24h: projectTwapPressure(activeTwaps, now, DAY_MS),
    activeCount: Array.isArray(activeTwaps) ? activeTwaps.length : 0,
  };
}

export const TWAP_PRESSURE_WINDOWS = { HOUR_MS, DAY_MS };
