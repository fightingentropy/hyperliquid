const state = {
  rows: [],
  updatedAt: null,
  sortKey: "positionValue",
  sortDir: "desc",
  searchTerm: "",
  selectedRow: null,
  selectedAddress: null,
  selectedPositionsData: null,
  detailRequestId: 0,
  positionsCache: new Map(),
  asset: "HYPE",
  topPositions: [],
  assetScanChecked: 0,
  assetScanTotal: 0,
  assetScanLoading: false,
  assetScanRequestId: 0,
  showOnlyMajorPositions: false,
};

const ASSET_OPTIONS = ["HYPE", "BTC", "ETH"];
const MAJOR_ASSETS = ["BTC", "ETH", "HYPE"];
const POSITION_SCAN_CONCURRENCY = 8;
const HYPE_TOP_LIMIT = 10;
const TOP_POSITIONS_CACHE_KEY = "hl-top-positions:v1";
const TOP_POSITIONS_CACHE_TTL_MS = 15 * 60 * 1000;

const ui = {
  leaderboardBody: document.getElementById("leaderboard-body"),
  leaderboardCount: document.getElementById("leaderboard-count"),
  leaderboardUpdated: document.getElementById("leaderboard-updated"),
  assetLabel: document.getElementById("asset-label"),
  refreshButton: document.getElementById("refresh-button"),
  clearSelection: document.getElementById("clear-selection"),
  assetToggle: document.getElementById("asset-toggle"),
  searchInput: document.getElementById("search-input"),
  explorerLink: document.getElementById("explorer-link"),
  detailName: document.getElementById("detail-name"),
  detailAddress: document.getElementById("detail-address"),
  copyAddress: document.getElementById("copy-address"),
  summaryAccount: document.getElementById("summary-account"),
  summaryMargin: document.getElementById("summary-margin"),
  summaryNotional: document.getElementById("summary-notional"),
  summaryWithdrawable: document.getElementById("summary-withdrawable"),
  positionsFilterToggle: document.getElementById("positions-filter-toggle"),
  positionsBody: document.getElementById("positions-body"),
  liquidationsBody: document.getElementById("liquidations-body"),
  liquidationsCount: document.getElementById("liquidations-count"),
  sortableHeaders: Array.from(document.querySelectorAll("th[data-sort]")),
  assetStatus: document.getElementById("asset-status"),
};

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 2,
});

function setText(element, value) {
  if (!element) return;
  element.textContent = value;
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
  const sign = num < 0 ? "-" : "";
  return `${sign}$${formatCompact(Math.abs(num))}`;
}

function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined) return "--";
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(num);
}

function formatPrice(value) {
  if (value === null || value === undefined) return "--";
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const decimals = num >= 1000 ? 2 : num >= 1 ? 4 : 6;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(num);
}

function formatAddress(address) {
  if (!address) return "--";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function classForSign(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return "";
  return num > 0 ? "positive" : "negative";
}

function setTableMessage(tbody, message, colSpan) {
  tbody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = colSpan;
  cell.textContent = message;
  cell.className = "muted";
  row.appendChild(cell);
  tbody.appendChild(row);
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
  return getOpenPositions(data).filter((position) => matchesAsset(position, asset));
}

function isExcludedOpenPosition(position) {
  const coin = normalizeCoin(position?.coin);
  if (!coin) return false;
  return MAJOR_ASSETS.some((asset) => coin === asset || coin.startsWith(`${asset}-`));
}

function filterOpenPositions(positions) {
  if (state.showOnlyMajorPositions) {
    return positions.filter((position) => isExcludedOpenPosition(position));
  }
  return positions;
}

function createPositionEntry(row, position) {
  return {
    ethAddress: row?.ethAddress,
    displayName: row?.displayName ?? "",
    accountValue: row?.accountValue ?? 0,
    position,
  };
}

function getPositionValue(position) {
  const value =
    toNumber(position?.positionValue) ??
    toNumber(position?.notional) ??
    toNumber(position?.value);
  return value === null ? 0 : Math.abs(value);
}

function getPositionSize(position) {
  return Math.abs(getSignedPositionSize(position));
}

function getSortValue(entry) {
  const position = entry.position ?? {};
  switch (state.sortKey) {
    case "szi":
      return getPositionSize(position);
    case "entryPx":
      return toNumber(position.entryPx) ?? 0;
    case "positionValue":
      return getPositionValue(position);
    case "unrealizedPnl":
      return toNumber(position.unrealizedPnl) ?? 0;
    default:
      return getPositionValue(position);
  }
}

function sortPositions(entries) {
  const dir = state.sortDir === "asc" ? 1 : -1;
  return entries.slice().sort((a, b) => {
    const aValue = getSortValue(a);
    const bValue = getSortValue(b);
    if (aValue === bValue) {
      const aAccount = a.accountValue ?? 0;
      const bAccount = b.accountValue ?? 0;
      if (aAccount === bAccount) {
        return (a.ethAddress ?? "").localeCompare(b.ethAddress ?? "");
      }
      return bAccount - aAccount;
    }
    return (aValue - bValue) * dir;
  });
}

function matchesSearch(entry, term) {
  if (!term) return true;
  const name = entry.displayName?.toLowerCase() ?? "";
  const address = entry.ethAddress?.toLowerCase() ?? "";
  return name.includes(term) || address.includes(term);
}

function updateAssetStatus() {
  if (!ui.assetStatus) return;
  if (!state.rows.length) {
    setText(ui.assetStatus, "No accounts loaded");
    return;
  }
  const total = state.assetScanTotal || 0;
  const checked = Math.min(state.assetScanChecked, total);
  if (state.assetScanLoading && checked < total) {
    setText(ui.assetStatus, `Scanning ${checked}/${total} accounts`);
    return;
  }
  setText(ui.assetStatus, `Showing ${getDisplayedTopPositionsCount()} positions`);
}

let positionsRenderQueued = false;

function queuePositionsRender() {
  if (positionsRenderQueued) return;
  positionsRenderQueued = true;
  requestAnimationFrame(() => {
    positionsRenderQueued = false;
    renderTopPositions();
  });
}

function readTopPositionsCache() {
  try {
    const raw = localStorage.getItem(TOP_POSITIONS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writeTopPositionsCache(cache) {
  try {
    localStorage.setItem(TOP_POSITIONS_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    // Ignore storage failures (private mode, quota, etc).
  }
}

function clearTopPositionsCache() {
  try {
    localStorage.removeItem(TOP_POSITIONS_CACHE_KEY);
  } catch (error) {
    // Ignore storage failures.
  }
}

function getCachedTopPositions(asset) {
  const cache = readTopPositionsCache();
  const entry = cache?.assets?.[asset];
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > TOP_POSITIONS_CACHE_TTL_MS) return null;
  return Array.isArray(entry.entries) ? entry.entries : null;
}

function setCachedTopPositions(asset, entries) {
  const cache = readTopPositionsCache() ?? { version: 1, assets: {} };
  cache.assets = cache.assets ?? {};
  cache.assets[asset] = { updatedAt: Date.now(), entries };
  writeTopPositionsCache(cache);
}

function applyCachedTopPositions(asset) {
  const entries = getCachedTopPositions(asset);
  if (!entries) return false;
  state.topPositions = entries;
  state.assetScanChecked = state.rows.length;
  state.assetScanTotal = state.rows.length;
  state.assetScanLoading = false;
  updateAssetStatus();
  renderTopPositions();
  return true;
}

function shouldRefreshTopPositions(asset) {
  const cache = readTopPositionsCache();
  const entry = cache?.assets?.[asset];
  if (!entry?.updatedAt) return true;
  return Date.now() - entry.updatedAt > TOP_POSITIONS_CACHE_TTL_MS;
}

function renderTopPositions() {
  if (!ui.leaderboardBody) return;
  if (!state.rows.length) {
    setTableMessage(ui.leaderboardBody, "Loading accounts...", 7);
    setText(ui.leaderboardCount, "0");
    return;
  }

  const term = state.searchTerm.trim().toLowerCase();
  const filtered = state.topPositions.filter((entry) => matchesSearch(entry, term));
  const sorted = sortPositions(filtered);
  const limited = limitTopPositions(sorted);

  ui.leaderboardBody.innerHTML = "";
  if (!limited.length) {
    if (state.assetScanLoading) {
      setTableMessage(ui.leaderboardBody, `Scanning ${state.asset} positions...`, 7);
    } else {
      setTableMessage(ui.leaderboardBody, `No open ${state.asset} positions found.`, 7);
    }
    setText(ui.leaderboardCount, String(limited.length));
    return;
  }

  const fragment = document.createDocumentFragment();
  limited.forEach((entry, index) => {
    const position = entry.position ?? {};
    const size = getSignedPositionSize(position);
    const side = size >= 0 ? "Long" : "Short";
    const tr = document.createElement("tr");
    tr.dataset.address = entry.ethAddress;
    if (entry.ethAddress === state.selectedAddress) {
      tr.classList.add("selected");
    }

    const rank = document.createElement("td");
    rank.textContent = String(index + 1);
    tr.appendChild(rank);

    const accountCell = document.createElement("td");
    const name = entry.displayName?.trim();
    if (name) {
      const nameLine = document.createElement("div");
      nameLine.textContent = name;
      const addressLine = document.createElement("div");
      addressLine.textContent = formatAddress(entry.ethAddress);
      addressLine.className = "mono muted";
      accountCell.appendChild(nameLine);
      accountCell.appendChild(addressLine);
    } else {
      const addressLine = document.createElement("div");
      addressLine.textContent = formatAddress(entry.ethAddress);
      addressLine.className = "mono";
      accountCell.appendChild(addressLine);
    }
    tr.appendChild(accountCell);

    const sideCell = document.createElement("td");
    sideCell.textContent = side;
    tr.appendChild(sideCell);

    const sizeCell = document.createElement("td");
    sizeCell.textContent = formatNumber(Math.abs(size), 4);
    tr.appendChild(sizeCell);

    const entryCell = document.createElement("td");
    entryCell.textContent = formatPrice(position.entryPx);
    tr.appendChild(entryCell);

    const valueCell = document.createElement("td");
    valueCell.textContent = formatUsd(getPositionValue(position));
    tr.appendChild(valueCell);

    const pnlCell = document.createElement("td");
    pnlCell.textContent = formatUsd(position.unrealizedPnl);
    const pnlClass = classForSign(position.unrealizedPnl);
    if (pnlClass) pnlCell.classList.add(pnlClass);
    tr.appendChild(pnlCell);

    fragment.appendChild(tr);
  });

  ui.leaderboardBody.appendChild(fragment);
  setText(ui.leaderboardCount, String(limited.length));
}

function limitTopPositions(entries) {
  if (state.asset !== "HYPE") return entries;
  return entries.slice(0, HYPE_TOP_LIMIT);
}

function getDisplayedTopPositionsCount() {
  if (state.asset !== "HYPE") return state.topPositions.length;
  return Math.min(state.topPositions.length, HYPE_TOP_LIMIT);
}

function setSortState(key) {
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDir = "desc";
  }

  ui.sortableHeaders.forEach((header) => {
    const headerKey = header.dataset.sort;
    if (headerKey === state.sortKey) {
      header.setAttribute("aria-sort", state.sortDir === "asc" ? "ascending" : "descending");
    } else {
      header.removeAttribute("aria-sort");
    }
  });

  renderTopPositions();
}

function setAsset(asset) {
  const normalized = String(asset ?? "").toUpperCase();
  if (!ASSET_OPTIONS.includes(normalized)) return;
  state.asset = normalized;
  ui.assetToggle?.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.asset === normalized);
  });
  setText(ui.assetLabel, normalized);
  if (state.rows.length && applyCachedTopPositions(normalized)) return;
  scanTopPositions();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

async function getPositions(address) {
  if (state.positionsCache.has(address)) {
    return state.positionsCache.get(address);
  }
  const data = await fetchJson(`/api/positions/${address}`);
  state.positionsCache.set(address, data);
  return data;
}

function collectCachedPositions(rows, asset) {
  const entries = [];
  const pending = [];
  let checked = 0;

  rows.forEach((row) => {
    const address = row.ethAddress;
    if (!address) return;
    if (state.positionsCache.has(address)) {
      const data = state.positionsCache.get(address);
      getAssetPositions(data, asset).forEach((position) => {
        entries.push(createPositionEntry(row, position));
      });
      checked += 1;
    } else {
      pending.push(address);
    }
  });

  return { entries, checked, pending };
}

async function scanTopPositions() {
  if (!state.rows.length) {
    state.topPositions = [];
    state.assetScanChecked = 0;
    state.assetScanTotal = 0;
    state.assetScanLoading = false;
    updateAssetStatus();
    renderTopPositions();
    return;
  }

  const requestId = (state.assetScanRequestId += 1);
  const asset = state.asset;

  const { entries, checked, pending } = collectCachedPositions(state.rows, asset);
  state.topPositions = entries;
  state.assetScanChecked = checked;
  state.assetScanTotal = checked + pending.length;
  state.assetScanLoading = pending.length > 0;
  updateAssetStatus();
  renderTopPositions();

  if (!pending.length) return;

  let cursor = 0;
  const rowByAddress = new Map(state.rows.map((row) => [row.ethAddress, row]));
  const workerCount = Math.min(POSITION_SCAN_CONCURRENCY, pending.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= pending.length) return;
        const address = pending[index];
        const row = rowByAddress.get(address);
        try {
          const positions = await getPositions(address);
          if (requestId !== state.assetScanRequestId) return;
          getAssetPositions(positions, asset).forEach((position) => {
            entries.push(createPositionEntry(row, position));
          });
        } catch (error) {
          // Ignore failed accounts for scan progress.
        }

        if (requestId !== state.assetScanRequestId) return;
        state.assetScanChecked += 1;
        state.topPositions = entries.slice();
        updateAssetStatus();
        queuePositionsRender();
      }
    }),
  );

  if (requestId !== state.assetScanRequestId) return;
  state.assetScanLoading = false;
  state.topPositions = entries.slice();
  setCachedTopPositions(asset, state.topPositions);
  updateAssetStatus();
  renderTopPositions();
}

async function loadLeaderboard() {
  setTableMessage(ui.leaderboardBody, "Loading accounts...", 7);
  try {
    const data = await fetchJson("/api/leaderboard?limit=500");
    state.rows = Array.isArray(data.rows) ? data.rows : [];
    state.updatedAt = data.updatedAt ?? Date.now();
    setText(ui.leaderboardUpdated, new Date(state.updatedAt).toLocaleTimeString());
    if (!applyCachedTopPositions(state.asset)) {
      scanTopPositions();
    }
  } catch (error) {
    setTableMessage(ui.leaderboardBody, "Failed to load accounts.", 7);
  }
}

function renderPositions(data) {
  const positions = filterOpenPositions(getOpenPositions(data));

  if (!positions.length) {
    const message = state.showOnlyMajorPositions
      ? "No open BTC/ETH/HYPE positions."
      : "No open positions.";
    setTableMessage(ui.positionsBody, message, 7);
    return;
  }

  ui.positionsBody.innerHTML = "";
  const fragment = document.createDocumentFragment();
  positions.forEach((position) => {
    const size = getSignedPositionSize(position);
    const side = size >= 0 ? "Long" : "Short";
    const row = document.createElement("tr");

    row.appendChild(createCell(position.coin ?? "--"));
    row.appendChild(createCell(side));
    row.appendChild(createCell(formatNumber(Math.abs(size), 4)));
    row.appendChild(createCell(formatPrice(position.entryPx)));
    row.appendChild(createCell(formatUsd(getPositionValue(position))));
    row.appendChild(createCell(position.liquidationPx ? formatPrice(position.liquidationPx) : "--"));

    const pnlCell = createCell(formatUsd(position.unrealizedPnl));
    const pnlClass = classForSign(position.unrealizedPnl);
    if (pnlClass) pnlCell.classList.add(pnlClass);
    row.appendChild(pnlCell);

    fragment.appendChild(row);
  });
  ui.positionsBody.appendChild(fragment);
}

function extractLiquidationMeta(fill) {
  const liq = fill?.liquidation;
  if (!liq) {
    return { role: "--", method: "--", markPx: fill?.px };
  }

  if (typeof liq === "string") {
    return { role: "Liquidation", method: liq, markPx: fill?.px };
  }

  const role =
    liq.role ??
    (liq.liquidator ? "Liquidator" : liq.liquidated ? "Liquidated" : "Liquidation");
  const method = liq.method ?? liq.type ?? liq.liquidationType ?? liq.reason ?? "--";
  const markPx = liq.markPx ?? liq.liqPx ?? liq.liquidationPx ?? fill?.px;

  return { role, method, markPx };
}

function renderLiquidations(items) {
  const liquidations = Array.isArray(items) ? items : [];
  setText(ui.liquidationsCount, `${liquidations.length} events`);
  if (!liquidations.length) {
    setTableMessage(ui.liquidationsBody, "No liquidations found.", 6);
    return;
  }

  ui.liquidationsBody.innerHTML = "";
  const fragment = document.createDocumentFragment();

  liquidations.forEach((fill) => {
    const row = document.createElement("tr");
    const meta = extractLiquidationMeta(fill);

    row.appendChild(createCell(formatTime(fill.time)));
    row.appendChild(createCell(fill.coin ?? "--"));
    row.appendChild(createCell(meta.role));
    row.appendChild(createCell(meta.method));
    row.appendChild(createCell(meta.markPx ? formatPrice(meta.markPx) : "--"));
    row.appendChild(createCell(formatNumber(fill.sz, 4)));
    fragment.appendChild(row);
  });

  ui.liquidationsBody.appendChild(fragment);
}

function formatTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "--";
  return new Date(timestamp).toLocaleString();
}

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value ?? "--";
  return cell;
}

function updateSummaryFromPositions(data) {
  const summary = data?.data?.marginSummary ?? {};
  setText(ui.summaryMargin, formatUsd(summary.totalMarginUsed));
  setText(ui.summaryNotional, formatUsd(summary.totalNtlPos));
  setText(ui.summaryWithdrawable, formatUsd(data?.data?.withdrawable));
}

function updateDetailBase(row) {
  state.selectedRow = row;
  state.selectedAddress = row?.ethAddress ?? null;
  const address = state.selectedAddress;
  const name = row?.displayName?.trim() || (address ? formatAddress(address) : "None");

  setText(ui.detailName, name);
  setText(ui.detailAddress, address ?? "--");
  setText(ui.summaryAccount, row ? formatUsd(row.accountValue) : "--");
  setText(ui.summaryMargin, "--");
  setText(ui.summaryNotional, "--");
  setText(ui.summaryWithdrawable, "--");
  setText(ui.liquidationsCount, "0 events");

  ui.copyAddress.disabled = !address;
  ui.explorerLink.href = address
    ? `https://hypurrscan.io/address/${address}`
    : "https://hypurrscan.io";
}

async function selectAccount(row) {
  if (!row) {
    clearSelection();
    return;
  }

  state.detailRequestId += 1;
  const requestId = state.detailRequestId;
  updateDetailBase(row);
  state.selectedPositionsData = null;
  renderTopPositions();

  setTableMessage(ui.positionsBody, "Loading positions...", 7);
  setTableMessage(ui.liquidationsBody, "Loading liquidations...", 6);

  try {
    const [positions, fills] = await Promise.all([
      getPositions(row.ethAddress),
      fetchJson(`/api/fills/${row.ethAddress}?days=30`),
    ]);

    if (requestId !== state.detailRequestId) return;
    state.selectedPositionsData = positions;
    renderPositions(positions);
    updateSummaryFromPositions(positions);
    renderLiquidations(fills?.items ?? fills);
  } catch (error) {
    if (requestId !== state.detailRequestId) return;
    setTableMessage(ui.positionsBody, "Failed to load positions.", 7);
    setTableMessage(ui.liquidationsBody, "Failed to load liquidations.", 6);
  }
}

function clearSelection() {
  state.selectedRow = null;
  state.selectedAddress = null;
  state.selectedPositionsData = null;
  updateDetailBase(null);
  setTableMessage(ui.positionsBody, "Select an account to see positions.", 7);
  setTableMessage(ui.liquidationsBody, "Select an account to see liquidations.", 6);
  renderTopPositions();
}

function handleCopy() {
  const address = state.selectedAddress;
  if (!address || !navigator.clipboard) return;
  navigator.clipboard.writeText(address).then(() => {
    ui.copyAddress.textContent = "Copied";
    setTimeout(() => {
      ui.copyAddress.textContent = "Copy";
    }, 1200);
  });
}

function refreshAll() {
  state.assetScanRequestId += 1;
  state.positionsCache.clear();
  state.topPositions = [];
  state.assetScanChecked = 0;
  state.assetScanTotal = 0;
  state.assetScanLoading = false;
  clearTopPositionsCache();
  loadLeaderboard();
}

function attachEvents() {
  ui.refreshButton?.addEventListener("click", () => refreshAll());
  ui.clearSelection?.addEventListener("click", () => clearSelection());
  ui.copyAddress?.addEventListener("click", handleCopy);
  ui.positionsFilterToggle?.addEventListener("change", (event) => {
    state.showOnlyMajorPositions = Boolean(event.target.checked);
    if (state.selectedPositionsData) {
      renderPositions(state.selectedPositionsData);
    } else if (state.selectedAddress) {
      setTableMessage(ui.positionsBody, "Loading positions...", 7);
    }
  });
  ui.assetToggle?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-asset]");
    if (!button) return;
    setAsset(button.dataset.asset);
  });
  ui.searchInput?.addEventListener("input", (event) => {
    state.searchTerm = event.target.value ?? "";
    renderTopPositions();
  });
  ui.sortableHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort;
      if (key) setSortState(key);
    });
  });
  ui.leaderboardBody?.addEventListener("click", (event) => {
    const row = event.target.closest("tr");
    if (!row) return;
    const address = row.dataset.address;
    const selected = state.rows.find((item) => item.ethAddress === address);
    if (selected) selectAccount(selected);
  });
}

function init() {
  if (ui.positionsFilterToggle) {
    ui.positionsFilterToggle.checked = state.showOnlyMajorPositions;
  }
  setAsset(state.asset);
  clearSelection();
  attachEvents();
  updateAssetStatus();
  loadLeaderboard();
  setInterval(() => {
    if (!state.rows.length || state.assetScanLoading) return;
    if (shouldRefreshTopPositions(state.asset)) {
      scanTopPositions();
    }
  }, 60_000);
}

init();
