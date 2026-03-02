const state = {
  rows: [],
  points: [],
  positionsCache: new Map(),
  scanChecked: 0,
  scanTotal: 0,
  scanLoading: false,
  scanRequestId: 0,
  lastUpdated: null,
  midPrice: null,
  binPercent: 0.005,
  sideFilter: "all",
  accountLimit: 5000,
  leaderboardLimit: 5000,
  settings: {
    showBinSize: false,
  },
};

const ASSET = "HYPE";
const CLUSTER_PRICE_MIN = 1;
const CLUSTER_PRICE_MAX = 100;
const POSITION_SCAN_CONCURRENCY = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const POSITION_CACHE_TTL_MS = DAY_MS;
const SHARED_TOP_WALLETS_CACHE_KEY = "hl-top-wallets:v1";
const SHARED_POSITIONS_CACHE_KEY = "hl-top-wallet-positions:v1";
const SHARED_CACHE_TTL_MS = DAY_MS;
const LIQUIDATION_POINTS_CACHE_KEY = "hl-liquidations-points:v1";
const LIQUIDATION_POINTS_CACHE_TTL_MS = DAY_MS;
const SETTINGS_KEY = "hl-settings:v1";
const DEFAULT_SETTINGS = {
  showBinSize: false,
  binPercent: 0.005,
  accountLimit: 5000,
};

const ui = {
  refreshButton: document.getElementById("refresh-button"),
  accountRange: document.getElementById("account-range"),
  accountRangeValue: document.getElementById("account-range-value"),
  accountsCount: document.getElementById("accounts-count"),
  pointsCount: document.getElementById("points-count"),
  totalNotional: document.getElementById("total-notional"),
  lastUpdated: document.getElementById("last-updated"),
  scanStatus: document.getElementById("scan-status"),
  clusterBars: document.getElementById("cluster-bars"),
  axis: document.getElementById("chart-axis"),
  currentPriceLine: document.getElementById("current-price-line"),
  currentPriceLabel: document.getElementById("current-price-label"),
  priceRange: document.getElementById("price-range"),
  bucketBody: document.getElementById("bucket-body"),
  bucketCount: document.getElementById("bucket-count"),
  binToggle: document.getElementById("bin-toggle"),
  sideToggle: document.getElementById("side-toggle"),
  currentPrice: document.getElementById("current-price"),
  longNotional: document.getElementById("long-notional"),
  shortNotional: document.getElementById("short-notional"),
};

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 2,
});

const SHORT_COLOR = { r: 229, g: 107, b: 59 };
const LONG_COLOR = { r: 31, g: 127, b: 109 };
const LIGHT_COLOR = { r: 255, g: 255, b: 255 };
const DARK_COLOR = { r: 0, g: 0, b: 0 };

let sharedPositionsCache = null;
let sharedPositionsFlushTimer = null;

function setText(element, value) {
  if (!element) return;
  element.textContent = value;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatCompact(value) {
  if (value === null || value === undefined) return "--";
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  if (Math.abs(num) < 1000) {
    return numberFormatter.format(num);
  }
  return compactFormatter.format(num);
}

function formatUsd(value) {
  if (value === null || value === undefined) return "--";
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `$${formatCompact(Math.abs(num))}`;
}

function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined) return "--";
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
  }).format(num);
}

function formatPrice(value) {
  if (value === null || value === undefined) return "--";
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const decimals = num >= 1000 ? 2 : num >= 1 ? 4 : 6;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
  }).format(num);
}

function formatTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "--";
  return new Date(timestamp).toLocaleTimeString();
}

function setTableMessage(tbody, message, colSpan) {
  if (!tbody) return;
  tbody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = colSpan;
  cell.textContent = message;
  cell.className = "muted";
  row.appendChild(cell);
  tbody.appendChild(row);
}

function readLeaderboardCache() {
  try {
    const raw = localStorage.getItem(SHARED_TOP_WALLETS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writeLeaderboardCache(cache) {
  try {
    localStorage.setItem(SHARED_TOP_WALLETS_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    // Ignore storage failures (private mode, quota, etc).
  }
}

function getCachedLeaderboard(limit) {
  const cache = readLeaderboardCache();
  if (!cache?.updatedAt) return null;
  if (Date.now() - cache.updatedAt > SHARED_CACHE_TTL_MS) return null;
  if (cache.limit !== limit) return null;
  return Array.isArray(cache.rows) ? cache.rows : null;
}

function setCachedLeaderboard(limit, rows) {
  writeLeaderboardCache({
    version: 1,
    updatedAt: Date.now(),
    limit,
    rows,
  });
}

function readSharedPositionsCache() {
  try {
    const raw = localStorage.getItem(SHARED_POSITIONS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function getSharedPositionsCache() {
  if (sharedPositionsCache) return sharedPositionsCache;
  const cache = readSharedPositionsCache();
  sharedPositionsCache =
    cache && typeof cache === "object" && cache.entries
      ? cache
      : { version: 1, entries: {} };
  sharedPositionsCache.entries = sharedPositionsCache.entries ?? {};
  return sharedPositionsCache;
}

function scheduleSharedPositionsFlush() {
  if (sharedPositionsFlushTimer) return;
  sharedPositionsFlushTimer = setTimeout(() => {
    sharedPositionsFlushTimer = null;
    try {
      const cache = getSharedPositionsCache();
      const now = Date.now();
      const topWallets = new Set(
        state.rows
          .slice(0, state.leaderboardLimit)
          .map((row) => row?.ethAddress)
          .filter(Boolean),
      );
      Object.keys(cache.entries).forEach((address) => {
        const entry = cache.entries[address];
        const isExpired =
          !entry?.updatedAt || now - entry.updatedAt > SHARED_CACHE_TTL_MS;
        const isOutsideTop =
          topWallets.size > 0 && !topWallets.has(String(address));
        if (isExpired || isOutsideTop) {
          delete cache.entries[address];
        }
      });
      localStorage.setItem(SHARED_POSITIONS_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      // Ignore storage failures.
    }
  }, 250);
}

function getSharedCachedPosition(address) {
  const cache = getSharedPositionsCache();
  const entry = cache.entries[address];
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > SHARED_CACHE_TTL_MS) {
    delete cache.entries[address];
    scheduleSharedPositionsFlush();
    return null;
  }
  return entry.data ?? null;
}

function setSharedCachedPosition(address, data) {
  const cache = getSharedPositionsCache();
  cache.entries[address] = { updatedAt: Date.now(), data };
  scheduleSharedPositionsFlush();
}

function readPointsCache() {
  try {
    const raw = localStorage.getItem(LIQUIDATION_POINTS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writePointsCache(cache) {
  try {
    localStorage.setItem(LIQUIDATION_POINTS_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    // Ignore storage failures (private mode, quota, etc).
  }
}

function clearPointsCache() {
  try {
    localStorage.removeItem(LIQUIDATION_POINTS_CACHE_KEY);
  } catch (error) {
    // Ignore storage failures.
  }
}

function getCachedPoints(limit) {
  const cache = readPointsCache();
  if (!cache?.updatedAt) return null;
  if (Date.now() - cache.updatedAt > LIQUIDATION_POINTS_CACHE_TTL_MS)
    return null;
  if (cache.limit !== limit) return null;
  if (cache.asset !== ASSET) return null;
  if (cache.leaderboardLimit !== state.leaderboardLimit) return null;
  return Array.isArray(cache.points) ? cache : null;
}

function setCachedPoints(limit, points, scanTotal) {
  writePointsCache({
    version: 1,
    updatedAt: Date.now(),
    limit,
    leaderboardLimit: state.leaderboardLimit,
    asset: ASSET,
    scanTotal,
    points,
  });
}

function normalizePositionEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const { position, ...rest } = entry;
  if (!position || typeof position !== "object") return entry;
  const merged = { ...rest, ...position };
  Object.entries(rest).forEach(([key, value]) => {
    if (merged[key] == null && value != null) {
      merged[key] = value;
    }
  });
  return merged;
}

function getSignedPositionSize(position) {
  return (
    toNumber(position?.szi) ??
    toNumber(position?.sz) ??
    toNumber(position?.size) ??
    toNumber(position?.positionSize) ??
    0
  );
}

function isOpenPosition(position) {
  const size = getSignedPositionSize(position);
  if (size !== 0) return true;
  const value =
    toNumber(position?.positionValue) ??
    toNumber(position?.notional) ??
    toNumber(position?.value);
  return value !== null && value !== 0;
}

function getOpenPositions(data) {
  const assetPositions = Array.isArray(data?.data?.assetPositions)
    ? data.data.assetPositions
    : [];
  return assetPositions
    .map(normalizePositionEntry)
    .filter((position) => position && isOpenPosition(position));
}

function normalizeCoin(value) {
  return String(value ?? "").toUpperCase();
}

function matchesAsset(position, asset) {
  const coin = normalizeCoin(position?.coin);
  if (!coin) return false;
  return coin === asset || coin.startsWith(`${asset}-`);
}

function getAssetPositions(data, asset) {
  return getOpenPositions(data).filter((position) =>
    matchesAsset(position, asset),
  );
}

function getPositionValue(position) {
  const value =
    toNumber(position?.positionValue) ??
    toNumber(position?.notional) ??
    toNumber(position?.value);
  return value === null ? 0 : Math.abs(value);
}

function getLiquidationPrice(position) {
  return (
    toNumber(position?.liquidationPx) ??
    toNumber(position?.liqPx) ??
    toNumber(position?.liquidationPrice) ??
    toNumber(position?.liqPrice) ??
    null
  );
}

function extractPoints(data) {
  const points = [];
  const positions = getAssetPositions(data, ASSET);
  positions.forEach((position) => {
    const liqPx = getLiquidationPrice(position);
    if (!liqPx || liqPx <= 0) return;
    if (liqPx < CLUSTER_PRICE_MIN || liqPx > CLUSTER_PRICE_MAX) return;
    const value = getPositionValue(position);
    if (!value) return;
    const size = getSignedPositionSize(position);
    points.push({
      price: liqPx,
      value,
      side: size >= 0 ? "long" : "short",
    });
  });
  return points;
}

function updateAccountRangeValue() {
  if (ui.accountRangeValue && ui.accountRange) {
    setText(ui.accountRangeValue, formatNumber(ui.accountRange.value, 0));
  }
}

function updateScanStatus() {
  if (!ui.scanStatus) return;
  if (!state.scanTotal) {
    setText(ui.scanStatus, "No accounts loaded");
    return;
  }
  const checked = Math.min(state.scanChecked, state.scanTotal);
  if (state.scanLoading && checked < state.scanTotal) {
    setText(ui.scanStatus, `Scanning ${checked}/${state.scanTotal} accounts`);
    return;
  }
  setText(ui.scanStatus, "Ready");
}

let renderQueued = false;

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderAll();
  });
}

function filterPointsBySide(points) {
  if (state.sideFilter === "long") {
    return points.filter((point) => point.side === "long");
  }
  if (state.sideFilter === "short") {
    return points.filter((point) => point.side === "short");
  }
  return points;
}

function summarizePoints(points) {
  return points.reduce(
    (summary, point) => {
      summary.total += point.value;
      if (point.side === "long") {
        summary.long += point.value;
      } else {
        summary.short += point.value;
      }
      return summary;
    },
    { total: 0, long: 0, short: 0 },
  );
}

function mixColor(a, b, amount) {
  const mix = Math.min(1, Math.max(0, amount));
  return {
    r: Math.round(a.r + (b.r - a.r) * mix),
    g: Math.round(a.g + (b.g - a.g) * mix),
    b: Math.round(a.b + (b.b - a.b) * mix),
  };
}

function toRgb(color) {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function niceStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const fraction = value / base;
  let niceFraction = 1;
  if (fraction < 1.5) {
    niceFraction = 1;
  } else if (fraction < 3) {
    niceFraction = 2;
  } else if (fraction < 7) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * base;
}

function buildClusters(points) {
  if (!points.length) return null;
  const prices = points.map((point) => point.price);
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  let range = max - min;
  const reference = state.midPrice ?? (min + max) / 2;
  let size = reference * state.binPercent;
  if (!Number.isFinite(size) || size <= 0) {
    size = range || Math.max(reference * 0.002, 1);
  }
  size = niceStep(size);

  const maxBins = 80;
  range = range || size;
  while (range / size > maxBins) {
    size = niceStep(size * 1.6);
  }

  const minBin = Math.floor(min / size) * size;
  const maxBin = Math.ceil(max / size) * size;
  const binCount = Math.max(1, Math.ceil((maxBin - minBin) / size));

  const bins = Array.from({ length: binCount }, (_, index) => {
    const from = minBin + index * size;
    return {
      from,
      to: from + size,
      total: 0,
      long: 0,
      short: 0,
      count: 0,
    };
  });

  points.forEach((point) => {
    const index = Math.min(
      binCount - 1,
      Math.max(0, Math.floor((point.price - minBin) / size)),
    );
    const bin = bins[index];
    bin.total += point.value;
    bin.count += 1;
    if (point.side === "long") {
      bin.long += point.value;
    } else {
      bin.short += point.value;
    }
  });

  return { bins, min: minBin, max: minBin + binCount * size, size };
}

function renderEmptyChart(message) {
  if (!ui.clusterBars) return;
  ui.clusterBars.style.setProperty("--bins", 1);
  ui.clusterBars.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "chart-empty";
  empty.textContent = message;
  ui.clusterBars.appendChild(empty);
}

function getAxisTickCount() {
  const width =
    toNumber(ui.clusterBars?.clientWidth) ??
    toNumber(window.innerWidth) ??
    0;

  if (width >= 1800) return 11;
  if (width >= 1400) return 9;
  if (width >= 1000) return 8;
  if (width >= 760) return 7;
  return 5;
}

function renderAxisTicks(min, max, tickCount = 5) {
  if (!ui.axis) return;
  ui.axis.innerHTML = "";
  if (!Number.isFinite(min) || !Number.isFinite(max) || tickCount < 2) {
    for (let index = 0; index < tickCount; index += 1) {
      const tick = document.createElement("span");
      tick.textContent = "--";
      ui.axis.appendChild(tick);
    }
    return;
  }
  const range = max - min;
  for (let index = 0; index < tickCount; index += 1) {
    const fraction = tickCount === 1 ? 0 : index / (tickCount - 1);
    const value = min + range * fraction;
    const tick = document.createElement("span");
    tick.textContent = formatPrice(value);
    ui.axis.appendChild(tick);
  }
}

function renderClusters(clusterData) {
  if (!clusterData || !clusterData.bins.length) {
    renderAxisTicks(null, null, getAxisTickCount());
    setText(ui.priceRange, "--");
    if (ui.currentPriceLine) {
      ui.currentPriceLine.classList.remove("visible");
    }
    renderEmptyChart("No liquidation prices yet.");
    renderBucketTable([]);
    return;
  }

  const { bins, min, max, size } = clusterData;
  const maxTotal = Math.max(...bins.map((bin) => bin.total));

  ui.clusterBars.innerHTML = "";
  ui.clusterBars.style.setProperty("--bins", bins.length);

  bins.forEach((bin) => {
    const bar = document.createElement("div");
    bar.className = "cluster-bar";
    const ratio = maxTotal ? bin.total / maxTotal : 0;
    if (bin.total === 0) {
      bar.style.height = "0%";
      bar.style.minHeight = "0";
      bar.style.opacity = "0.25";
    } else {
      const height = Math.max(2, ratio * 100);
      bar.style.height = `${height}%`;
      bar.style.opacity = "1";
    }

    const longRatio = bin.total ? bin.long / bin.total : 0.5;
    const base = mixColor(SHORT_COLOR, LONG_COLOR, longRatio);
    const top = mixColor(base, LIGHT_COLOR, 0.25);
    const bottom = mixColor(base, DARK_COLOR, 0.15);
    bar.style.background = `linear-gradient(180deg, ${toRgb(top)}, ${toRgb(bottom)})`;
    bar.title = `${formatPrice(bin.from)} - ${formatPrice(bin.to)}\n${formatUsd(
      bin.total,
    )} across ${formatNumber(bin.count, 0)} positions`;

    ui.clusterBars.appendChild(bar);
  });

  renderAxisTicks(min, max, getAxisTickCount());
  let rangeLabel = `${formatPrice(min)} - ${formatPrice(max)}`;
  if (state.settings.showBinSize) {
    rangeLabel += ` | Bin ${formatPrice(size)}`;
  }
  setText(ui.priceRange, rangeLabel);

  if (ui.currentPriceLine) {
    const mid = state.midPrice;
    if (Number.isFinite(mid) && max > min && mid >= min && mid <= max) {
      const left = ((mid - min) / (max - min)) * 100;
      ui.currentPriceLine.style.left = `${left}%`;
      ui.currentPriceLine.classList.add("visible");
      setText(ui.currentPriceLabel, `Mid ${formatPrice(mid)}`);
    } else {
      ui.currentPriceLine.classList.remove("visible");
    }
  }

  renderBucketTable(bins);
}

function renderBucketTable(bins) {
  if (!ui.bucketBody) return;
  if (!bins.length) {
    setText(ui.bucketCount, "0 buckets");
    setTableMessage(ui.bucketBody, "No buckets yet.", 3);
    return;
  }

  setText(ui.bucketCount, `${bins.length} buckets`);
  const sorted = bins
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  ui.bucketBody.innerHTML = "";
  const fragment = document.createDocumentFragment();

  sorted.forEach((bin) => {
    const row = document.createElement("tr");
    row.appendChild(
      createCell(`${formatPrice(bin.from)} - ${formatPrice(bin.to)}`),
    );
    row.appendChild(createCell(formatUsd(bin.total)));
    row.appendChild(createCell(formatNumber(bin.count, 0)));
    fragment.appendChild(row);
  });

  ui.bucketBody.appendChild(fragment);
}

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value ?? "--";
  return cell;
}

function updateMetrics(points, summary) {
  const accountText = state.scanTotal
    ? `${state.scanChecked}/${state.scanTotal}`
    : "0";
  setText(ui.accountsCount, accountText);
  setText(ui.pointsCount, formatNumber(points.length, 0));
  setText(ui.totalNotional, formatUsd(summary.total));
  setText(
    ui.lastUpdated,
    state.lastUpdated ? formatTime(state.lastUpdated) : "--",
  );
  setText(ui.longNotional, formatUsd(summary.long));
  setText(ui.shortNotional, formatUsd(summary.short));
}

function renderAll() {
  const filtered = filterPointsBySide(state.points);
  const summary = summarizePoints(filtered);
  updateMetrics(filtered, summary);
  const clusters = buildClusters(filtered);
  renderClusters(clusters);
}

function withRefresh(url, refresh) {
  if (!refresh) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}refresh=1`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(withRefresh(url, options.refresh === true));
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

function getCachedPositions(address) {
  const entry = state.positionsCache.get(address);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > POSITION_CACHE_TTL_MS) {
    state.positionsCache.delete(address);
    return null;
  }
  return entry.data;
}

function setCachedPositions(address, data) {
  state.positionsCache.set(address, { data, updatedAt: Date.now() });
  setSharedCachedPosition(address, data);
}

async function getPositions(address, options = {}) {
  const refresh = options.refresh === true;
  if (!refresh) {
    const cached = getCachedPositions(address);
    if (cached) return cached;
    const shared = getSharedCachedPosition(address);
    if (shared) {
      state.positionsCache.set(address, { data: shared, updatedAt: Date.now() });
      return shared;
    }
  }
  const data = await fetchJson(`/api/positions/${address}`, { refresh });
  setCachedPositions(address, data);
  return data;
}

async function loadMidPrice(options = {}) {
  try {
    const refresh = options.refresh === true;
    const data = await fetchJson("/api/mids", { refresh });
    const price = toNumber(data?.mids?.[ASSET]);
    if (price) {
      state.midPrice = price;
      setText(ui.currentPrice, formatPrice(price));
      queueRender();
    } else {
      state.midPrice = null;
      setText(ui.currentPrice, "--");
    }
  } catch (error) {
    state.midPrice = null;
    setText(ui.currentPrice, "--");
  }
}

function applyLeaderboardRows(rows, options = {}) {
  state.rows = Array.isArray(rows) ? rows : [];
  if (state.rows.length && state.accountLimit > state.rows.length) {
    state.accountLimit = state.rows.length;
    if (ui.accountRange) {
      ui.accountRange.value = String(state.accountLimit);
      updateAccountRangeValue();
    }
  }
  scanPositions(options);
}

async function loadLeaderboard(options = {}) {
  const refresh = options.refresh === true;
  const force = options.force === true || refresh;
  if (!force) {
    const cachedRows = getCachedLeaderboard(state.leaderboardLimit);
    if (cachedRows) {
      applyLeaderboardRows(cachedRows, options);
      return;
    }
  }

  try {
    const data = await fetchJson(
      `/api/leaderboard?limit=${state.leaderboardLimit}`,
      { refresh },
    );
    const rows = Array.isArray(data.rows) ? data.rows : [];
    setCachedLeaderboard(state.leaderboardLimit, rows);
    applyLeaderboardRows(rows, { refresh });
  } catch (error) {
    state.rows = [];
    state.points = [];
    updateScanStatus();
    renderAll();
  }
}

async function scanPositions(options = {}) {
  const refresh = options.refresh === true;
  const force = options.force === true || refresh;
  if (!state.rows.length) {
    state.points = [];
    state.scanChecked = 0;
    state.scanTotal = 0;
    state.scanLoading = false;
    updateScanStatus();
    renderAll();
    return;
  }

  const requestId = (state.scanRequestId += 1);
  state.scanChecked = 0;
  const limit = Math.min(state.accountLimit, state.rows.length);
  const sample = state.rows.slice(0, limit);
  if (!force) {
    const cached = getCachedPoints(limit);
    if (cached) {
      state.points = cached.points.slice();
      state.scanChecked = limit;
      state.scanTotal = cached.scanTotal ?? limit;
      state.scanLoading = false;
      state.lastUpdated = cached.updatedAt;
      updateScanStatus();
      renderAll();
      return;
    }
  }
  const points = [];
  const pending = [];

  sample.forEach((row) => {
    const address = row.ethAddress;
    if (!address) return;
    const data = getCachedPositions(address);
    const sharedData = !data && !force ? getSharedCachedPosition(address) : null;
    const resolved = data ?? sharedData;
    if (sharedData) {
      state.positionsCache.set(address, {
        data: sharedData,
        updatedAt: Date.now(),
      });
    }
    if (resolved) {
      points.push(...extractPoints(resolved));
      state.scanChecked += 1;
    } else {
      pending.push(address);
    }
  });

  state.points = points.slice();
  state.scanTotal = sample.length;
  state.scanLoading = pending.length > 0;
  updateScanStatus();
  renderAll();

  if (!pending.length) {
    state.scanLoading = false;
    state.lastUpdated = Date.now();
    setCachedPoints(limit, state.points, state.scanTotal);
    updateScanStatus();
    renderAll();
    return;
  }

  let cursor = 0;
  const workerCount = Math.min(POSITION_SCAN_CONCURRENCY, pending.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= pending.length) return;
        const address = pending[index];
        try {
          const positions = await getPositions(address, { refresh });
          if (requestId !== state.scanRequestId) return;
          points.push(...extractPoints(positions));
        } catch (error) {
          // Skip failed accounts.
        }

        if (requestId !== state.scanRequestId) return;
        state.scanChecked += 1;
        state.points = points.slice();
        updateScanStatus();
        queueRender();
      }
    }),
  );

  if (requestId !== state.scanRequestId) return;
  state.scanLoading = false;
  state.points = points.slice();
  state.lastUpdated = Date.now();
  setCachedPoints(limit, state.points, state.scanTotal);
  scheduleSharedPositionsFlush();
  updateScanStatus();
  renderAll();
}

async function refreshAll() {
  state.scanRequestId += 1;
  state.positionsCache.clear();
  clearPointsCache();
  state.points = [];
  state.scanChecked = 0;
  state.scanTotal = 0;
  state.scanLoading = false;
  state.lastUpdated = null;
  updateScanStatus();
  await Promise.all([
    loadMidPrice({ refresh: true }),
    loadLeaderboard({ force: true, refresh: true }),
  ]);
}

function attachEvents() {
  ui.refreshButton?.addEventListener("click", refreshAll);
  ui.accountRange?.addEventListener("input", () => updateAccountRangeValue());
  ui.accountRange?.addEventListener("change", (event) => {
    state.accountLimit = Number(event.target.value);
    state.settings = { ...state.settings, accountLimit: state.accountLimit };
    saveSettings(state.settings);
    updateAccountRangeValue();
    state.scanChecked = 0;
    scanPositions();
  });
  ui.binToggle?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-bin]");
    if (!button) return;
    state.binPercent = Number(button.dataset.bin);
    state.settings = { ...state.settings, binPercent: state.binPercent };
    saveSettings(state.settings);
    ui.binToggle.querySelectorAll("button").forEach((node) => {
      node.classList.toggle("active", node === button);
    });
    renderAll();
  });
  ui.sideToggle?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-side]");
    if (!button) return;
    state.sideFilter = button.dataset.side;
    ui.sideToggle.querySelectorAll("button").forEach((node) => {
      node.classList.toggle("active", node === button);
    });
    renderAll();
  });
}

function init() {
  const settings = loadSettings();
  state.settings = settings;
  state.binPercent = settings.binPercent;
  state.accountLimit = settings.accountLimit;
  if (ui.accountRange) {
    ui.accountRange.value = String(state.accountLimit);
    updateAccountRangeValue();
  }
  updateScanStatus();
  attachEvents();
  loadMidPrice();
  loadLeaderboard();

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderAll(), 120);
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== SETTINGS_KEY) return;
    const next = loadSettings();
    state.settings = next;
    state.binPercent = next.binPercent;
    state.accountLimit = next.accountLimit;
    if (ui.accountRange) {
      ui.accountRange.value = String(state.accountLimit);
      updateAccountRangeValue();
    }
    renderAll();
  });
}

init();
