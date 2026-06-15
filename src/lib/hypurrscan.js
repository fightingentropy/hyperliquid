// Transforms for the HypurrScan dashboard widgets (network fees + HYPE TWAP
// buy pressure). The math mirrors what hypurrscan.io/dashboard does so the
// numbers line up with the source.

// HypurrScan reports cumulative fees as a fixed-point integer scaled by 1e6.
const FEE_SCALE = 1e6;
const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HYPE_SPOT_ASSET_OFFSET = 10_000;

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

// Map each HYPE spot market id to its current mid price (in USD), keyed the same
// way TWAP actions reference markets (asset id = 10000 + spot pair index).
export function selectHypeSpotPriceByAssetId(spotMetaAndAssetCtxs) {
  const priceByAssetId = {};

  if (!Array.isArray(spotMetaAndAssetCtxs) || spotMetaAndAssetCtxs.length < 2) {
    return priceByAssetId;
  }

  const [meta, assetCtxs] = spotMetaAndAssetCtxs;
  const hypeToken = (meta?.tokens ?? []).find((token) => token?.name === "HYPE");

  if (!hypeToken) {
    return priceByAssetId;
  }

  (meta?.universe ?? []).forEach((pair) => {
    // Only pairs where HYPE is the base token (tokens[0]) are HYPE TWAP markets;
    // a TWAP's size is denominated in that base token.
    if (pair?.tokens?.[0] !== hypeToken.index) {
      return;
    }

    const midPrice = Number(assetCtxs?.[pair.index]?.midPx);
    if (Number.isFinite(midPrice) && midPrice > 0) {
      priceByAssetId[HYPE_SPOT_ASSET_OFFSET + pair.index] = midPrice;
    }
  });

  return priceByAssetId;
}

// Reduce the raw TWAP feed to the still-running HYPE spot orders, carrying only
// what the pressure projection needs. Notional value = size * current mid price.
export function buildActiveHypeTwaps({ twaps, priceByAssetId, now }) {
  if (!Array.isArray(twaps)) {
    return [];
  }

  const active = [];

  twaps.forEach((entry) => {
    const twap = entry?.action?.twap;
    if (!twap) {
      return;
    }

    const price = priceByAssetId?.[twap.a];
    if (!price) {
      return; // Not a HYPE spot market we track.
    }

    const start = new Date(entry.time).getTime();
    const durationMs = Number(twap.m) * 60 * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(durationMs) || durationMs <= 0) {
      return;
    }

    const end = start + durationMs;
    if (end <= now) {
      return; // Already finished.
    }

    const value = Number(twap.s) * price;
    if (!Number.isFinite(value) || value < 0) {
      return;
    }

    active.push({ start, end, durationMs, isBuy: Boolean(twap.b), value });
  });

  return active;
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
