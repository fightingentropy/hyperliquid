// Transforms for the Token Analytics page (genesis allocations + current holder
// concentration). The bucketing mirrors qwantify.io/token-analytics so the
// histograms and stat cards line up with the source.

export const DEFAULT_TOKEN_SYMBOL = "KNTQ";

// Up to this many bucket edges are generated before thinning.
const MAX_BUCKETS = 40;
// Adjacent buckets are merged until each holds at least this many entries.
const MIN_BUCKET_COUNT = 5;
// A max/min spread above this switches from linear to 1-2-5 log buckets.
const LOG_SPREAD_THRESHOLD = 50;
const LOG_STEPS = [1, 2, 5];
const MAX_LOG_DECADES = 20;

function formatNumber(value, options) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4, ...options }).format(value);
}

export function formatCompactAmount(value) {
  return formatNumber(value, { notation: "compact", maximumFractionDigits: 1 });
}

// Token amounts: full digits below 1M, compact above, more decimals for dust.
export function formatTokenAmount(value, symbol) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const amount = formatNumber(value, {
    notation: value >= 1e6 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 2 : 6,
  });

  return symbol ? `${amount} ${symbol}` : amount;
}

export function normalizeTokenSymbol(value) {
  return String(value ?? "").trim().toUpperCase();
}

// Every Hyperliquid spot token name (sorted), from /markets/spot-symbol-maps.
export function listSpotTokens(symbolMaps) {
  const names = Object.keys(symbolMaps?.indexByToken ?? {})
    .map(normalizeTokenSymbol)
    .filter(Boolean);

  return [...new Set(names)].sort();
}

export function parseGenesisBalances(payload) {
  const userBalances = payload?.genesis?.userBalances;
  if (!Array.isArray(userBalances)) {
    return [];
  }

  return userBalances
    .map((entry) => Number(Array.isArray(entry) ? entry[1] : NaN))
    .filter((value) => Number.isFinite(value));
}

export function parseHolderBalances(payload) {
  const balances = payload?.balances;
  if (!Array.isArray(balances)) {
    return [];
  }

  return balances.filter((value) => Number.isFinite(value) && value > 0);
}

function sortAscending(values) {
  return Float64Array.from(values).sort();
}

export function computeDistributionStats(values) {
  if (!values.length) {
    return null;
  }

  const sorted = sortAscending(values);
  const count = sorted.length;
  const middle = Math.floor(count / 2);
  const median = count % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    count,
    min: sorted[0],
    max: sorted[count - 1],
    median,
    average: total / count,
  };
}

// Keep every nth edge so at most `maxBuckets` remain, always ending on the
// largest edge.
function thinEdges(edges, maxBuckets) {
  if (edges.length <= maxBuckets) {
    return edges;
  }

  const stride = Math.ceil(edges.length / maxBuckets);
  const thinned = [];

  for (let index = stride - 1; index < edges.length; index += stride) {
    thinned.push(edges[index]);
  }

  if (thinned[thinned.length - 1] < edges[edges.length - 1]) {
    thinned.push(edges[edges.length - 1]);
  }

  return thinned;
}

// Log mode: 1-2-5 steps starting one decade below the smallest value, up to
// the first edge above the largest. Linear mode: a "nice" step of max/40.
function buildBucketEdges(min, max, maxBuckets, isLog) {
  const edges = [];

  if (isLog) {
    let exponent = Math.floor(Math.log10(Math.max(1, min)));
    if (exponent > 0) {
      exponent -= 1;
    }

    for (let decade = 0; decade <= MAX_LOG_DECADES; decade += 1) {
      const scale = 10 ** (exponent + decade);

      for (const step of LOG_STEPS) {
        const edge = step * scale;
        edges.push(edge);

        if (edge > max) {
          return thinEdges(edges, maxBuckets);
        }
      }
    }

    return thinEdges(edges, maxBuckets);
  }

  const rawStep = max / maxBuckets;
  const magnitude = Math.floor(Math.log10(rawStep));
  const normalized = rawStep / 10 ** magnitude;
  const niceStep = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  const step = niceStep * 10 ** magnitude;

  for (let multiple = 1; multiple * step <= max + step; multiple += 1) {
    edges.push(multiple * step);
  }

  return thinEdges(edges, maxBuckets);
}

function labelBucket(bucket, isLast, max) {
  const start = formatCompactAmount(bucket.start);
  const end = formatCompactAmount(bucket.end);

  if (isLast && bucket.end < max) {
    return `${start}+`;
  }

  return bucket.start === 0 ? `0 – ${end}` : `${start} – ${end}`;
}

// Histogram of balances: each bucket covers (start, end], leading empty
// buckets are dropped, and sparse neighbours are merged so every bar has at
// least MIN_BUCKET_COUNT entries. Each bucket also carries the running share
// of entries and of supply up to and including it.
export function buildDistributionBuckets(values) {
  if (!values.length) {
    return { buckets: [], scale: "linear" };
  }

  const sorted = sortAscending(values);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const isLog = max / (min > 0 ? min : 1e-6) > LOG_SPREAD_THRESHOLD;
  // All-zero input has no positive range to divide into buckets.
  const edges = max > 0 ? buildBucketEdges(min, max, MAX_BUCKETS, isLog) : [max];

  const rawBuckets = edges.map((end, index) => ({
    start: index === 0 ? 0 : edges[index - 1],
    end,
    count: 0,
    binTotal: 0,
  }));

  let bucketIndex = 0;
  for (const value of sorted) {
    while (bucketIndex < rawBuckets.length - 1 && value > rawBuckets[bucketIndex].end) {
      bucketIndex += 1;
    }

    rawBuckets[bucketIndex].count += 1;
    rawBuckets[bucketIndex].binTotal += value;
  }

  while (rawBuckets.length > 1 && rawBuckets[0].count === 0) {
    rawBuckets.shift();
  }

  const merged = [];
  let pending = null;

  for (const bucket of rawBuckets) {
    if (pending) {
      pending.end = bucket.end;
      pending.count += bucket.count;
      pending.binTotal += bucket.binTotal;
    } else {
      pending = { ...bucket };
    }

    if (pending.count >= MIN_BUCKET_COUNT) {
      merged.push(pending);
      pending = null;
    }
  }

  if (pending) {
    const last = merged[merged.length - 1];

    if (last) {
      last.end = pending.end;
      last.count += pending.count;
      last.binTotal += pending.binTotal;
    } else {
      merged.push(pending);
    }
  }

  const supply = sorted.reduce((sum, value) => sum + value, 0);
  let runningCount = 0;
  let runningSupply = 0;

  const buckets = merged.map((bucket, index) => {
    runningCount += bucket.count;
    runningSupply += bucket.binTotal;

    return {
      ...bucket,
      label: labelBucket(bucket, index === merged.length - 1, max),
      cumulativeHoldersPct: (runningCount / count) * 100,
      cumulativeSupplyPct: supply > 0 ? (runningSupply / supply) * 100 : 0,
    };
  });

  return { buckets, scale: isLog ? "log" : "linear" };
}
