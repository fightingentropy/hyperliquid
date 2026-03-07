(function () {
  const TRADES_PER_PAGE = 20;
  const TRADES_FETCH_DAYS = 90;
  const TRADES_FETCH_LIMIT = 8000; // total fills to accumulate client-side before stopping
  const TRADES_PAGE_SIZE = 2000; // HL `userFills` page size cap
  const TRACKED_DELTA_MAX_DAYS = 7;
  const TRACKED_DELTA_WINDOWS = Object.freeze([
    { key: "24h", label: "Last 24H", ms: 24 * 60 * 60 * 1000 },
    { key: "7d", label: "Last 7D", ms: 7 * 24 * 60 * 60 * 1000 },
  ]);
  // Merge adjacent order-groups within a "trade session" window.
  // HL tends to merge sequential orders that build/close a position over hours.
  const AGGREGATE_MERGE_GAP_MS = 24 * 60 * 60 * 1000; // 24 hours
  const AGGREGATE_MERGE_MAX_PX_DIFF = 0.12; // 12% relative difference guardrail
  const FOLLOWED_WALLETS_KEY = "hl-followed-wallets-v1";
  const TRACKED_DELTA_CACHE_TTL_MS = 60 * 60 * 1000;
  const TRACKED_DELTA_WALLET_CACHE_KEY = "hl-tracked-delta-wallet-cache:v1";
  const TRACKED_DELTA_PRICE_CACHE_KEY = "hl-tracked-delta-price-cache:v1";
  const DEFAULT_FOLLOWED_WALLETS = [
    "0xaf0fdd39e5d92499b0ed9f68693da99c0ec1e92e",
    "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae",
    "0xcb58b8f5ec6d47985f0728465c25a08ef9ad2c7b",
    "0xadd12adbbd5db87674b38af99b6dd34dd2a45e0d",
    "0x519c721de735f7c9e6146d167852e60d60496a47",
    "0x9c2a2a966ed8e47f0c8b7e2ec2b91424f229f6a8",
  ];
  const DEFAULT_FOLLOWED_WALLET_LABELS = Object.freeze({
    "0xaf0fdd39e5d92499b0ed9f68693da99c0ec1e92e": "purple surfer",
    "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae": "loracle",
    "0xcb58b8f5ec6d47985f0728465c25a08ef9ad2c7b": "CL",
    "0xadd12adbbd5db87674b38af99b6dd34dd2a45e0d": "nexus",
    "0x519c721de735f7c9e6146d167852e60d60496a47": "Hyper Longer",
    "0x9c2a2a966ed8e47f0c8b7e2ec2b91424f229f6a8": "Phantom Yak",
  });

  const ui = {
    addressInput: document.getElementById("address-input"),
    lookupButton: document.getElementById("lookup-button"),
    followWalletButton: document.getElementById("follow-wallet-button"),
    addressError: document.getElementById("address-error"),
    followedWalletsList: document.getElementById("followed-wallets-list"),
    walletMain: document.getElementById("wallet-main"),
    walletAddressTitle: document.getElementById("wallet-address-title"),
    explorerLink: document.getElementById("explorer-link"),
    metricAccountValue: document.getElementById("metric-account-value"),
    metricMargin: document.getElementById("metric-margin"),
    metricWithdrawable: document.getElementById("metric-withdrawable"),
    tabPositions: document.getElementById("tab-positions"),
    tabHoldings: document.getElementById("tab-holdings"),
    tabTrades: document.getElementById("tab-trades"),
    panelPositions: document.getElementById("panel-positions"),
    panelHoldings: document.getElementById("panel-holdings"),
    panelTrades: document.getElementById("panel-trades"),
    positionsBody: document.getElementById("positions-body"),
    holdingsBody: document.getElementById("holdings-body"),
    tradesBody: document.getElementById("trades-body"),
    tradesSummary: document.getElementById("trades-summary"),
    tradesRefresh: document.getElementById("trades-refresh"),
    aggregateFills: document.getElementById("aggregate-fills"),
    tradesPagination: document.getElementById("trades-pagination"),
    tradesPrev: document.getElementById("trades-prev"),
    tradesNext: document.getElementById("trades-next"),
    tradesPageInfo: document.getElementById("trades-page-info"),
    holdingsSortableHeaders: Array.from(
      document.querySelectorAll("#panel-holdings th[data-sort]"),
    ),
    trackedDeltaAsset: document.getElementById("tracked-delta-asset"),
    trackedDeltaRefresh: document.getElementById("tracked-delta-refresh"),
    trackedDeltaStatus: document.getElementById("tracked-delta-status"),
    trackedDeltaFlags: document.getElementById("tracked-delta-flags"),
    trackedDeltaCards: document.getElementById("tracked-delta-cards"),
    trackedDeltaModeToggle: document.getElementById("tracked-delta-mode-toggle"),
    trackedDeltaWindowToggle: document.getElementById("tracked-delta-window-toggle"),
    trackedDeltaChart: document.getElementById("tracked-delta-chart"),
    trackedDeltaChartTitle: document.getElementById("tracked-delta-chart-title"),
    trackedDeltaChartSubtitle: document.getElementById("tracked-delta-chart-subtitle"),
    trackedDeltaBreakdown: document.getElementById("tracked-delta-breakdown"),
  };

  let state = {
    address: null,
    positionsData: null,
    spotData: null,
    midsData: null,
    tradesData: null,
    tradesLoading: false,
    tradesNextCursorEnd: null,
    tradesSeenKeys: new Set(),
    tradesAllTwaps: [],
    tradesLoadId: 0,
    tradesPage: 1,
    aggregateFills: false,
    loading: false,
    holdingsSortKey: "usdValue",
    holdingsSortDir: "desc",
    followedWallets: [],
    trackedDeltaLoading: false,
    trackedDeltaError: "",
    trackedDeltaAsset: null,
    trackedDeltaAssets: [],
    trackedDeltaFills: [],
    trackedDeltaLoadId: 0,
    trackedDeltaUpdatedAt: null,
    trackedDeltaFailedWallets: [],
    trackedDeltaViewMode: "all",
    trackedDeltaChartWindow: "7d",
    trackedDeltaPriceSeriesByAsset: {},
  };

  let trackedDeltaWalletCacheStore = null;
  let trackedDeltaPriceCacheStore = null;

  function isAddress(value) {
    return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
  }

  function normalizeAddress(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return isAddress(normalized) ? normalized : null;
  }

  function setText(el, value) {
    if (!el) return;
    el.textContent = value ?? "";
  }

  function formatUsd(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    const num = Number(value);
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return formatter.format(num);
  }

  function formatNumber(value, decimals = 2) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: decimals,
    }).format(Number(value));
  }

  function formatSignedNumber(value, decimals = 2) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    const num = Number(value);
    const prefix = num > 0 ? "+" : num < 0 ? "-" : "";
    return `${prefix}${formatNumber(Math.abs(num), decimals)}`;
  }

  function formatSignedUsd(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    const num = Number(value);
    const prefix = num > 0 ? "+" : num < 0 ? "-" : "";
    return `${prefix}${formatUsd(Math.abs(num))}`;
  }

  function formatCompactUsd(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 2,
      style: "currency",
      currency: "USD",
    }).format(Number(value));
  }

  function formatSignedCompactUsd(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    const num = Number(value);
    const prefix = num > 0 ? "+" : num < 0 ? "-" : "";
    return `${prefix}${formatCompactUsd(Math.abs(num))}`;
  }

  function formatPrice(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    const num = Number(value);
    const decimals = num >= 1000 ? 2 : num >= 1 ? 4 : 6;
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(num);
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeCoin(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  function usdPriceForCoin(coin) {
    const c = normalizeCoin(coin);
    if (!c) return null;
    if (c === "USDC" || c === "USDT" || c === "DAI") return 1;
    const mids = state.midsData?.mids ?? null;
    return mids ? toNumber(mids[c]) : null;
  }

  function toTimeMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value; // seconds -> ms
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return NaN;
      const asNum = Number(trimmed);
      if (Number.isFinite(asNum)) return asNum < 1e12 ? asNum * 1000 : asNum; // seconds -> ms
      const asDate = Date.parse(trimmed);
      if (Number.isFinite(asDate)) return asDate;
    }
    return NaN;
  }

  function formatTime(ts) {
    const t = toTimeMs(ts);
    if (!Number.isFinite(t)) return "—";
    return new Date(t).toLocaleString();
  }

  function formatShortTime(ts, opts) {
    const t = toTimeMs(ts);
    if (!Number.isFinite(t)) return "—";
    return new Intl.DateTimeFormat("en-US", opts ?? {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
    }).format(new Date(t));
  }

  function formatAddressShort(address) {
    if (!isAddress(address)) return address ?? "—";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  function walletLabel(address) {
    const normalized = normalizeAddress(address);
    if (!normalized) return null;
    return DEFAULT_FOLLOWED_WALLET_LABELS[normalized] ?? null;
  }

  function formatFollowedWalletLabel(address) {
    const short = formatAddressShort(address);
    const label = walletLabel(address);
    if (!label) return short;
    return `${label} (${short})`;
  }

  function saveFollowedWallets() {
    try {
      localStorage.setItem(FOLLOWED_WALLETS_KEY, JSON.stringify(state.followedWallets));
    } catch {
      // Ignore storage failures (private mode/quota/etc).
    }
  }

  function loadTrackedDeltaCacheStore(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveTrackedDeltaCacheStore(storageKey, value) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Ignore storage failures.
    }
  }

  function getTrackedDeltaCacheStore(kind) {
    const storageKey =
      kind === "wallet" ? TRACKED_DELTA_WALLET_CACHE_KEY : TRACKED_DELTA_PRICE_CACHE_KEY;

    if (kind === "wallet" && trackedDeltaWalletCacheStore == null) {
      trackedDeltaWalletCacheStore = loadTrackedDeltaCacheStore(storageKey);
    }
    if (kind === "price" && trackedDeltaPriceCacheStore == null) {
      trackedDeltaPriceCacheStore = loadTrackedDeltaCacheStore(storageKey);
    }

    const store = kind === "wallet" ? trackedDeltaWalletCacheStore : trackedDeltaPriceCacheStore;
    let changed = false;
    const now = Date.now();
    for (const [key, entry] of Object.entries(store ?? {})) {
      const cachedAt = Number(entry?.cachedAt ?? NaN);
      if (!Number.isFinite(cachedAt) || now - cachedAt > TRACKED_DELTA_CACHE_TTL_MS) {
        delete store[key];
        changed = true;
      }
    }
    if (changed) saveTrackedDeltaCacheStore(storageKey, store);
    return store;
  }

  function getTrackedDeltaCacheEntry(kind, entryKey) {
    const store = getTrackedDeltaCacheStore(kind);
    const entry = store?.[entryKey];
    if (!entry || typeof entry !== "object") return null;
    const cachedAt = Number(entry.cachedAt ?? NaN);
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > TRACKED_DELTA_CACHE_TTL_MS) {
      delete store[entryKey];
      const storageKey =
        kind === "wallet" ? TRACKED_DELTA_WALLET_CACHE_KEY : TRACKED_DELTA_PRICE_CACHE_KEY;
      saveTrackedDeltaCacheStore(storageKey, store);
      return null;
    }
    return entry;
  }

  function setTrackedDeltaCacheEntry(kind, entryKey, value) {
    const store = getTrackedDeltaCacheStore(kind);
    store[entryKey] = {
      cachedAt: Date.now(),
      value,
    };
    const storageKey =
      kind === "wallet" ? TRACKED_DELTA_WALLET_CACHE_KEY : TRACKED_DELTA_PRICE_CACHE_KEY;
    saveTrackedDeltaCacheStore(storageKey, store);
  }

  function getTrackedDeltaCachedSnapshot(wallets) {
    const fills = [];
    let cachedWalletCount = 0;
    let latestCachedAt = 0;

    for (const wallet of wallets ?? []) {
      const cacheKey = normalizeAddress(wallet) || wallet;
      const entry = getTrackedDeltaCacheEntry("wallet", cacheKey);
      if (!Array.isArray(entry?.value)) continue;
      cachedWalletCount += 1;
      latestCachedAt = Math.max(latestCachedAt, Number(entry.cachedAt) || 0);
      fills.push(...entry.value);
    }

    fills.sort((a, b) => b.time - a.time);
    const assets = Array.from(new Set(fills.map((fill) => fill.asset))).sort((a, b) =>
      a.localeCompare(b),
    );
    const asset =
      state.trackedDeltaAsset && assets.includes(state.trackedDeltaAsset)
        ? state.trackedDeltaAsset
        : chooseTrackedDeltaDefaultAsset(assets, fills);

    let priceCached = false;
    if (asset) {
      const assetKey = normalizeCoin(asset);
      const priceEntry = getTrackedDeltaCacheEntry("price", assetKey);
      if (Array.isArray(priceEntry?.value)) {
        state.trackedDeltaPriceSeriesByAsset[assetKey] = priceEntry.value;
        latestCachedAt = Math.max(latestCachedAt, Number(priceEntry.cachedAt) || 0);
        priceCached = true;
      }
    }

    return {
      fills,
      assets,
      asset,
      cachedWalletCount,
      updatedAt: latestCachedAt || null,
      priceCached,
    };
  }

  function applyTrackedDeltaSnapshot(snapshot) {
    state.trackedDeltaFills = snapshot?.fills ?? [];
    state.trackedDeltaAssets = snapshot?.assets ?? [];
    state.trackedDeltaAsset = snapshot?.asset ?? null;
    if (snapshot?.updatedAt) {
      state.trackedDeltaUpdatedAt = snapshot.updatedAt;
    }
  }

  function normalizeWalletList(candidates) {
    const seen = new Set();
    const wallets = [];
    for (const candidate of candidates ?? []) {
      const normalized = normalizeAddress(candidate);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      wallets.push(normalized);
    }
    return wallets;
  }

  function loadFollowedWallets() {
    const defaults = normalizeWalletList(DEFAULT_FOLLOWED_WALLETS);
    try {
      const raw = localStorage.getItem(FOLLOWED_WALLETS_KEY);
      if (!raw) return defaults.slice();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return defaults.slice();
      const wallets = normalizeWalletList(parsed);
      if (!wallets.length) return defaults.slice();

      for (const wallet of defaults) {
        if (!wallets.includes(wallet)) wallets.push(wallet);
      }
      return wallets;
    } catch {
      return defaults.slice();
    }
  }

  function renderFollowedWallets() {
    const root = ui.followedWalletsList;
    if (!root) return;

    root.innerHTML = "";

    if (!state.followedWallets.length) {
      const empty = document.createElement("p");
      empty.className = "followed-wallet-empty";
      empty.textContent = "No followed wallets yet.";
      root.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const wallet of state.followedWallets) {
      const chip = document.createElement("div");
      chip.className = "followed-wallet-chip";
      const label = walletLabel(wallet);

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "followed-wallet-open";
      if (wallet === state.address) openButton.classList.add("active");
      openButton.dataset.role = "open";
      openButton.dataset.address = wallet;
      openButton.textContent = formatFollowedWalletLabel(wallet);
      openButton.title = label ? `${label} - ${wallet}` : wallet;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "followed-wallet-remove";
      removeButton.dataset.role = "remove";
      removeButton.dataset.address = wallet;
      removeButton.ariaLabel = `Remove ${formatFollowedWalletLabel(wallet)} from followed wallets`;
      removeButton.textContent = "x";

      chip.appendChild(openButton);
      chip.appendChild(removeButton);
      fragment.appendChild(chip);
    }

    root.appendChild(fragment);
  }

  function addFollowedWallet(value) {
    const normalized = normalizeAddress(value);
    if (!normalized) return false;
    state.followedWallets = [
      normalized,
      ...state.followedWallets.filter((wallet) => wallet !== normalized),
    ];
    saveFollowedWallets();
    renderFollowedWallets();
    return true;
  }

  function removeFollowedWallet(value) {
    const normalized = normalizeAddress(value);
    if (!normalized) return;
    state.followedWallets = state.followedWallets.filter((wallet) => wallet !== normalized);
    saveFollowedWallets();
    renderFollowedWallets();
  }

  function tradeKey(fill) {
    return String(fill?.tid ?? `${fill?.time ?? ""}:${fill?.oid ?? ""}:${fill?.hash ?? ""}`);
  }

  function appendUniqueFills(target, fills) {
    for (const f of fills ?? []) {
      const key = tradeKey(f);
      if (state.tradesSeenKeys.has(key)) continue;
      state.tradesSeenKeys.add(key);
      target.push(f);
    }
  }

  function computeTradesRangeMs(fills, twaps) {
    let min = Infinity;
    let max = -Infinity;
    for (const f of fills ?? []) {
      const t = toTimeMs(f?.time ?? f?.startTime ?? f?.endTime ?? 0);
      if (!Number.isFinite(t) || t <= 0) continue;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    for (const t of twaps ?? []) {
      const tm = toTimeMs(t?.time ?? 0);
      if (!Number.isFinite(tm) || tm <= 0) continue;
      if (tm < min) min = tm;
      if (tm > max) max = tm;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { startTime: min, endTime: max };
  }

  function setTableMessage(tbody, message, colSpan) {
    if (!tbody) return;
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = colSpan;
    td.textContent = message;
    td.className = "muted";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  function createCell(content) {
    const td = document.createElement("td");
    td.textContent = content ?? "—";
    return td;
  }

  function createAssetCell(coin, kind) {
    const td = document.createElement("td");
    td.className = "asset-cell";

    const label = document.createElement("span");
    label.textContent = coin ?? "—";
    td.appendChild(label);

    if (kind) {
      const badge = document.createElement("span");
      badge.className = `asset-badge ${String(kind)}`;
      if (kind === "delegated") badge.textContent = "DELEGATED";
      else badge.textContent = String(kind).toUpperCase();
      td.appendChild(badge);
    }

    return td;
  }

  function getSignedSize(position) {
    const raw =
      position?.szi ?? position?.sz ?? position?.size ?? position?.positionSize;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function isOpenPosition(position) {
    const size = getSignedSize(position);
    if (size !== 0) return true;
    const value =
      Number(position?.positionValue) ??
      Number(position?.notional) ??
      Number(position?.value);
    return value != null && value !== 0;
  }

  function getOpenPositions(data) {
    const list = data?.data?.assetPositions ?? [];
    return list
      .map((entry) => {
        const pos = entry?.position ?? entry;
        return { ...entry, ...pos };
      })
      .filter((p) => p && isOpenPosition(p));
  }

  function getPositionValue(position) {
    const v =
      position?.positionValue ?? position?.notional ?? position?.value;
    const n = Number(v);
    return Number.isFinite(n) ? Math.abs(n) : 0;
  }

  function dirPillClass(fill) {
    const side = (fill?.side ?? "").toLowerCase();
    const dir = (fill?.dir ?? "").toLowerCase();
    if (dir.includes("long") || side === "b") return "long-open";
    if (dir.includes("short") || side === "a") return "short-open";
    if (side === "b") return "buy";
    if (side === "a") return "sell";
    return "neutral";
  }

  function dirLabel(fill) {
    const dir = (fill?.dir ?? "").toLowerCase();
    const side = (fill?.side ?? "").toLowerCase();
    if (dir === "open long" || (side === "b" && dir !== "close long" && dir !== "close short")) return "OPEN LONG";
    if (dir === "close long") return "CLOSE LONG";
    if (dir === "open short" || (side === "a" && dir !== "close long" && dir !== "close short")) return "OPEN SHORT";
    if (dir === "close short") return "CLOSE SHORT";
    if (side === "b") return "Buy";
    if (side === "a") return "Sell";
    return fill?.dir ?? "—";
  }

  function twapDirLabel(twap) {
    const side = String(twap?.side ?? "").toLowerCase();
    if (side === "b") return "BUY";
    if (side === "a") return "SELL";
    return "—";
  }

  function twapDirClass(twap) {
    const side = String(twap?.side ?? "").toLowerCase();
    if (side === "b") return "buy";
    if (side === "a") return "sell";
    return "neutral";
  }

  function twapStatusLabel(status) {
    const s = String(status ?? "").trim();
    if (!s) return "—";
    return s[0].toUpperCase() + s.slice(1);
  }

  /**
   * Aggregate fills similarly to the HL UI: group by order (oid) or TWAP (twapId),
   * not by a time window. This avoids merging unrelated fills that happen to be
   * near each other in time.
   */
  function aggregateFillsByCoinAndTime(items) {
    if (!items.length) return [];

    const sortTime = (x) => toTimeMs(x?.time ?? x?.endTime ?? x?.startTime ?? 0) || 0;
    const sorted = items.slice().sort((a, b) => sortTime(a) - sortTime(b)); // ascending for stable min/max

    const groupsByKey = new Map();
    for (const fill of sorted) {
      const t = sortTime(fill);
      const coin = fill.coin ?? "";
      const isTwap = fill?.twapId != null;
      const side = String(fill?.side ?? "").toLowerCase();
      const dir = isTwap ? (side === "b" ? "BUY" : side === "a" ? "SELL" : dirLabel(fill)) : dirLabel(fill);
      const oid = fill?.oid != null ? String(fill.oid) : "";
      const twapId = fill?.twapId != null ? String(fill.twapId) : "";

      // Prefer grouping by TWAP id, then by order id. Fallback keeps things separate.
      const groupId = twapId ? `twap:${twapId}` : oid ? `oid:${oid}` : `t:${t}:h:${fill?.hash ?? ""}`;
      const key = `${coin}|${dir}|${groupId}`;

      let g = groupsByKey.get(key);
      if (!g) {
        g = {
          startTime: t,
          endTime: t,
          coin,
          fills: [],
          isTwap,
          twapId: twapId || null,
          dir,
          dirClass: dirPillClass(fill),
          totalSz: 0,
          totalNotional: 0,
          totalFee: 0,
          totalPnl: 0,
          avgPx: 0,
        };
        groupsByKey.set(key, g);
      }

      g.fills.push(fill);
      if (t < g.startTime) g.startTime = t;
      if (t > g.endTime) g.endTime = t;
      const sz = Number(fill.sz) || 0;
      const px = Number(fill.px) || 0;
      g.totalSz += sz;
      g.totalNotional += px * sz;
      g.totalFee += Number(fill.fee) || 0;
      g.totalPnl += Number(fill.closedPnl) || 0;
    }

    const groups = Array.from(groupsByKey.values());
    groups.forEach((g) => {
      g.avgPx = g.totalSz > 0 ? g.totalNotional / g.totalSz : 0;
    });

    // Second pass: merge adjacent order-groups that are close in time (typical when
    // a position is built/closed with a few sequential orders).
    groups.sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));
    const merged = [];
    for (const g of groups) {
      const prev = merged[merged.length - 1];
      const pxOk = (() => {
        // If either side doesn't have a meaningful price, allow the merge.
        const a = Number(prev?.avgPx ?? 0);
        const b = Number(g?.avgPx ?? 0);
        if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return true;
        const rel = Math.abs(a - b) / Math.max(a, b);
        return rel <= AGGREGATE_MERGE_MAX_PX_DIFF;
      })();
      if (
        prev &&
        prev.coin === g.coin &&
        prev.dir === g.dir &&
        // Don't merge unrelated TWAPs. Only merge TWAP groups if it's the same TWAP id.
        ((prev.isTwap && g.isTwap && prev.twapId && prev.twapId === g.twapId) ||
          (!prev.isTwap && !g.isTwap)) &&
        pxOk &&
        (Number(g.startTime) || 0) - (Number(prev.endTime) || 0) <= AGGREGATE_MERGE_GAP_MS
      ) {
        prev.fills.push(...g.fills);
        prev.endTime = Math.max(Number(prev.endTime) || 0, Number(g.endTime) || 0);
        prev.startTime = Math.min(Number(prev.startTime) || 0, Number(g.startTime) || 0);
        prev.totalSz += g.totalSz;
        prev.totalNotional += g.totalNotional;
        prev.totalFee += g.totalFee;
        prev.totalPnl += g.totalPnl;
        prev.avgPx = prev.totalSz > 0 ? prev.totalNotional / prev.totalSz : 0;
      } else {
        merged.push(g);
      }
    }

    // Most recent group first.
    merged.sort((a, b) => (Number(b.endTime) || 0) - (Number(a.endTime) || 0));
    return merged;
  }

  function classifyTrackedDeltaFill(fill) {
    const rawSize = Number(fill?.sz ?? 0);
    const size = Math.abs(rawSize);
    if (!Number.isFinite(size) || size <= 0) return null;

    const price = Number(fill?.px ?? 0);
    const notional = Number.isFinite(price) && price > 0 ? size * price : 0;
    const dir = String(fill?.dir ?? "").trim().toLowerCase();
    const side = String(fill?.side ?? "").trim().toLowerCase();

    if (dir === "open long") {
      return { bucket: "longed", signedDelta: size, signedNotional: notional, marketType: "perp" };
    }
    if (dir === "close long") {
      return { bucket: "longClosed", signedDelta: -size, signedNotional: -notional, marketType: "perp" };
    }
    if (dir === "open short") {
      return { bucket: "shorted", signedDelta: -size, signedNotional: -notional, marketType: "perp" };
    }
    if (dir === "close short") {
      return { bucket: "shortCovered", signedDelta: size, signedNotional: notional, marketType: "perp" };
    }
    if (side === "b") {
      return { bucket: "bought", signedDelta: size, signedNotional: notional, marketType: "spot" };
    }
    if (side === "a") {
      return { bucket: "sold", signedDelta: -size, signedNotional: -notional, marketType: "spot" };
    }
    return null;
  }

  function normalizeTrackedDeltaFill(fill, wallet) {
    const time = toTimeMs(fill?.time ?? 0);
    if (!Number.isFinite(time) || time <= 0) return null;

    const asset = normalizeCoin(fill?.coin);
    if (!asset) return null;

    const classification = classifyTrackedDeltaFill(fill);
    if (!classification) return null;

    return {
      wallet,
      asset,
      time,
      bucket: classification.bucket,
      marketType: classification.marketType,
      signedDelta: classification.signedDelta,
      signedNotional: classification.signedNotional,
    };
  }

  function chooseTrackedDeltaDefaultAsset(assets, fills) {
    if (assets.includes("HYPE")) return "HYPE";
    if (!assets.length) return null;

    const scoreByAsset = new Map();
    for (const fill of fills ?? []) {
      if (!fill?.asset) continue;
      const prev = scoreByAsset.get(fill.asset) ?? 0;
      scoreByAsset.set(fill.asset, prev + Math.abs(Number(fill.signedNotional) || 0));
    }

    return assets
      .slice()
      .sort((a, b) => {
        const scoreDiff = (scoreByAsset.get(b) ?? 0) - (scoreByAsset.get(a) ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return a.localeCompare(b);
      })[0];
  }

  function renderTrackedDeltaAssetOptions() {
    const select = ui.trackedDeltaAsset;
    if (!select) return;

    const assets = state.trackedDeltaAssets ?? [];
    select.innerHTML = "";

    if (!assets.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = state.trackedDeltaLoading ? "Loading assets..." : "No assets";
      select.appendChild(option);
      select.disabled = true;
      state.trackedDeltaAsset = null;
      return;
    }

    if (!state.trackedDeltaAsset || !assets.includes(state.trackedDeltaAsset)) {
      state.trackedDeltaAsset = chooseTrackedDeltaDefaultAsset(assets, state.trackedDeltaFills);
    }

    assets.forEach((asset) => {
      const option = document.createElement("option");
      option.value = asset;
      option.textContent = asset;
      option.selected = asset === state.trackedDeltaAsset;
      select.appendChild(option);
    });
    select.disabled = false;
  }

  function trackedDeltaModeLabel(mode, asset) {
    if (mode === "perp") return `${asset} Perp`;
    if (mode === "spot") return `${asset} Spot`;
    return "All Flow";
  }

  function trackedDeltaFillsFor(asset, mode, windowMs = Infinity) {
    const assetKey = normalizeCoin(asset);
    const now = Date.now();
    return (state.trackedDeltaFills ?? []).filter((fill) => {
      if (fill.asset !== assetKey) return false;
      if (windowMs !== Infinity && now - fill.time > windowMs) return false;
      if (mode === "perp") return fill.marketType === "perp";
      if (mode === "spot") return fill.marketType === "spot";
      return true;
    });
  }

  function summarizeTrackedDelta(asset, mode) {
    return TRACKED_DELTA_WINDOWS.map((window) => {
      const summary = {
        ...window,
        netDelta: 0,
        netNotional: 0,
        longed: 0,
        shorted: 0,
        bought: 0,
        sold: 0,
        longClosed: 0,
        shortCovered: 0,
        fills: 0,
        wallets: new Set(),
      };

      for (const fill of trackedDeltaFillsFor(asset, mode, window.ms)) {
        summary.netDelta += Number(fill.signedDelta) || 0;
        summary.netNotional += Number(fill.signedNotional) || 0;
        summary.fills += 1;
        summary.wallets.add(fill.wallet);

        if (fill.bucket === "longed") summary.longed += Number(fill.signedDelta) || 0;
        else if (fill.bucket === "shorted") summary.shorted += Math.abs(Number(fill.signedDelta) || 0);
        else if (fill.bucket === "bought") summary.bought += Number(fill.signedDelta) || 0;
        else if (fill.bucket === "sold") summary.sold += Math.abs(Number(fill.signedDelta) || 0);
        else if (fill.bucket === "longClosed") summary.longClosed += Math.abs(Number(fill.signedDelta) || 0);
        else if (fill.bucket === "shortCovered") summary.shortCovered += Number(fill.signedDelta) || 0;
      }

      return summary;
    });
  }

  function renderTrackedDeltaModeToggle() {
    const root = ui.trackedDeltaModeToggle;
    if (!root) return;
    const asset = state.trackedDeltaAsset || "Asset";
    root.querySelectorAll("button[data-mode]").forEach((button) => {
      const mode = button.dataset.mode || "all";
      const isActive = mode === state.trackedDeltaViewMode;
      button.textContent = trackedDeltaModeLabel(mode, asset);
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
    });
  }

  function renderTrackedDeltaWindowToggle() {
    const root = ui.trackedDeltaWindowToggle;
    if (!root) return;
    root.querySelectorAll("button[data-window]").forEach((button) => {
      const windowKey = button.dataset.window || "7d";
      const isActive = windowKey === state.trackedDeltaChartWindow;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
    });
  }

  function renderTrackedDeltaFlags() {
    const root = ui.trackedDeltaFlags;
    if (!root) return;
    root.innerHTML = "";

    const total = normalizeWalletList(state.followedWallets).length;
    if (!total) return;

    const loaded = Math.max(0, total - state.trackedDeltaFailedWallets.length);
    const loadedFlag = document.createElement("span");
    loadedFlag.className = "tracked-delta-flag";
    loadedFlag.textContent = `${loaded}/${total} wallets loaded`;
    root.appendChild(loadedFlag);

    const cacheFlag = document.createElement("span");
    cacheFlag.className = "tracked-delta-flag";
    cacheFlag.textContent = "1h cache";
    root.appendChild(cacheFlag);

    if (state.trackedDeltaFailedWallets.length) {
      const failedFlag = document.createElement("span");
      failedFlag.className = "tracked-delta-flag warning";
      failedFlag.textContent = `${state.trackedDeltaFailedWallets.length} failed`;
      failedFlag.title = state.trackedDeltaFailedWallets.join(", ");
      root.appendChild(failedFlag);
    }
  }

  function createTrackedDeltaSummaryCard(summary, asset, mode) {
    const card = document.createElement("article");
    card.className = "tracked-delta-card";
    if (summary.netNotional > 0) card.classList.add("positive");
    else if (summary.netNotional < 0) card.classList.add("negative");

    const header = document.createElement("div");
    header.className = "tracked-delta-card-header";

    const title = document.createElement("h4");
    title.className = "tracked-delta-card-title";
    title.textContent = `Net Flow ${String(summary.key || summary.label).toUpperCase()}`;

    const subtitle = document.createElement("span");
    subtitle.className = "tracked-delta-card-subtitle";
    subtitle.textContent = trackedDeltaModeLabel(mode, asset);

    header.appendChild(title);
    header.appendChild(subtitle);

    const netWrap = document.createElement("div");
    netWrap.className = "tracked-delta-card-net";

    const netLabel = document.createElement("span");
    netLabel.className = "tracked-delta-card-net-label";
    netLabel.textContent = "Net notional";

    const netValue = document.createElement("span");
    netValue.className = "tracked-delta-card-net-value";
    netValue.textContent = formatSignedCompactUsd(summary.netNotional);
    if (summary.netNotional > 0) netValue.classList.add("positive");
    else if (summary.netNotional < 0) netValue.classList.add("negative");
    else netValue.classList.add("flat");

    const units = document.createElement("span");
    units.className = "tracked-delta-card-notional muted";
    units.textContent = `Net ${formatSignedNumber(summary.netDelta, 4)} ${asset}`;

    netWrap.appendChild(netLabel);
    netWrap.appendChild(netValue);
    netWrap.appendChild(units);

    const meta = document.createElement("div");
    meta.className = "tracked-delta-card-meta";

    const fills = document.createElement("span");
    fills.textContent = `${summary.fills} fill${summary.fills === 1 ? "" : "s"}`;

    const badge = document.createElement("span");
    badge.className = "tracked-delta-card-badge";
    badge.textContent = `${summary.wallets.size} wallet${summary.wallets.size === 1 ? "" : "s"}`;

    meta.appendChild(fills);
    meta.appendChild(badge);

    card.appendChild(header);
    card.appendChild(netWrap);
    card.appendChild(meta);
    return card;
  }

  function createTrackedDeltaBreakdownItem(label, value, className = "") {
    const item = document.createElement("div");
    item.className = "tracked-delta-breakdown-item";

    const title = document.createElement("span");
    title.className = "tracked-delta-breakdown-label";
    title.textContent = label;

    const amount = document.createElement("span");
    amount.className = `tracked-delta-breakdown-value ${className}`.trim();
    amount.textContent = value;

    item.appendChild(title);
    item.appendChild(amount);
    return item;
  }

  function bucketTrackedDeltaSeries(asset, mode, windowKey) {
    const window = TRACKED_DELTA_WINDOWS.find((entry) => entry.key === windowKey) ?? TRACKED_DELTA_WINDOWS[1];
    const bucketMs = 60 * 60 * 1000;
    const now = Date.now();
    const end = Math.floor(now / bucketMs) * bucketMs;
    const start = end - window.ms + bucketMs;
    const count = Math.max(1, Math.round(window.ms / bucketMs));
    const buckets = Array.from({ length: count }, (_, index) => ({
      time: start + index * bucketMs,
      netNotional: 0,
    }));

    for (const fill of trackedDeltaFillsFor(asset, mode, window.ms)) {
      const idx = Math.floor((fill.time - start) / bucketMs);
      if (idx < 0 || idx >= buckets.length) continue;
      buckets[idx].netNotional += Number(fill.signedNotional) || 0;
    }

    return { window, buckets };
  }

  function chartAxisMax(values) {
    const maxAbs = Math.max(...values.map((value) => Math.abs(Number(value) || 0)), 0);
    if (!Number.isFinite(maxAbs) || maxAbs <= 0) return 1;
    const exponent = Math.floor(Math.log10(maxAbs));
    const scale = 10 ** exponent;
    return Math.ceil(maxAbs / scale) * scale;
  }

  function trackedDeltaChartSvg(buckets, priceSeries) {
    const width = 1120;
    const height = 360;
    const padTop = 18;
    const padBottom = 34;
    const padLeft = 64;
    const padRight = 68;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;
    const zeroY = padTop + chartH / 2;
    const maxAbs = chartAxisMax(buckets.map((bucket) => bucket.netNotional));
    const barWidth = Math.max(3, (chartW / Math.max(1, buckets.length)) * 0.58);

    const gridLines = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs].map((value) => {
      const y = padTop + ((maxAbs - value) / (maxAbs * 2)) * chartH;
      return { y, label: formatCompactUsd(value) };
    });

    const xLabels = [];
    const step = Math.max(1, Math.floor(buckets.length / 6));
    for (let i = 0; i < buckets.length; i += step) {
      const bucket = buckets[i];
      xLabels.push({
        x: padLeft + (i + 0.5) * (chartW / buckets.length),
        label: formatShortTime(
          bucket.time,
          buckets.length <= 24
            ? { hour: "2-digit", minute: "2-digit" }
            : { month: "2-digit", day: "2-digit", hour: "2-digit" },
        ),
      });
    }

    const bars = buckets.map((bucket, index) => {
      const value = Number(bucket.netNotional) || 0;
      const x = padLeft + index * (chartW / buckets.length) + (chartW / buckets.length - barWidth) / 2;
      const y = value >= 0 ? zeroY - (Math.abs(value) / maxAbs) * (chartH / 2) : zeroY;
      const h = Math.max(2, (Math.abs(value) / maxAbs) * (chartH / 2));
      return {
        index,
        x,
        y,
        h,
        cls: value >= 0 ? "tracked-delta-chart-bar-positive" : "tracked-delta-chart-bar-negative",
      };
    });

    let pricePath = "";
    let priceLabels = "";
    if (Array.isArray(priceSeries) && priceSeries.length > 1) {
      const visiblePrices = priceSeries
        .filter((row) => Number.isFinite(Number(row?.time)) && Number.isFinite(Number(row?.close)))
        .slice(-buckets.length)
        .map((row) => ({ time: Number(row.time), close: Number(row.close) }));
      if (visiblePrices.length > 1) {
        const minPrice = Math.min(...visiblePrices.map((row) => row.close));
        const maxPrice = Math.max(...visiblePrices.map((row) => row.close));
        const range = maxPrice - minPrice || Math.max(maxPrice, 1);
        pricePath = visiblePrices
          .map((row, index) => {
            const x = padLeft + (index / Math.max(1, visiblePrices.length - 1)) * chartW;
            const y = padTop + (1 - (row.close - minPrice) / range) * chartH;
            return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
          })
          .join(" ");

        const labels = [maxPrice, (maxPrice + minPrice) / 2, minPrice];
        priceLabels = labels
          .map((value, index) => {
            const y = padTop + (index / Math.max(1, labels.length - 1)) * chartH;
            return `<text class="tracked-delta-chart-axis price" x="${width - 4}" y="${y + 4}" text-anchor="end">${formatPrice(value)}</text>`;
          })
          .join("");
      }
    }

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        ${gridLines
          .map(
            (line) => `<line class="tracked-delta-chart-grid" x1="${padLeft}" x2="${width - padRight}" y1="${line.y}" y2="${line.y}" />
              <text class="tracked-delta-chart-axis" x="8" y="${line.y + 4}">${line.label}</text>`,
          )
          .join("")}
        <line class="tracked-delta-chart-zero" x1="${padLeft}" x2="${width - padRight}" y1="${zeroY}" y2="${zeroY}" />
        ${bars
          .map((bar) => `<rect class="tracked-delta-chart-bar ${bar.cls}" data-bucket-index="${bar.index}" x="${bar.x}" y="${bar.y}" width="${barWidth}" height="${bar.h}" rx="2" />`)
          .join("")}
        ${pricePath ? `<path class="tracked-delta-chart-price" d="${pricePath}" />` : ""}
        ${xLabels
          .map((label) => `<text class="tracked-delta-chart-axis" x="${label.x}" y="${height - 8}" text-anchor="middle">${label.label}</text>`)
          .join("")}
        ${priceLabels}
      </svg>
    `;
  }

  function bucketTrackedDeltaWalletDetails(selectedFills, buckets) {
    const bucketMs = 60 * 60 * 1000;
    const start = Number(buckets?.[0]?.time ?? 0);
    const details = (buckets ?? []).map((bucket) => ({
      time: bucket.time,
      netNotional: Number(bucket.netNotional) || 0,
      fills: 0,
      positiveTotal: 0,
      negativeTotal: 0,
      positiveByWallet: new Map(),
      negativeByWallet: new Map(),
    }));

    for (const fill of selectedFills ?? []) {
      const idx = Math.floor((Number(fill.time) - start) / bucketMs);
      if (!Number.isFinite(idx) || idx < 0 || idx >= details.length) continue;

      const detail = details[idx];
      const wallet = fill.wallet;
      const label = formatFollowedWalletLabel(wallet);
      const signedNotional = Number(fill.signedNotional) || 0;
      detail.fills += 1;

      if (signedNotional > 0) {
        detail.positiveTotal += signedNotional;
        const prev =
          detail.positiveByWallet.get(wallet) ?? { wallet, label, notional: 0 };
        prev.notional += signedNotional;
        detail.positiveByWallet.set(wallet, prev);
      } else if (signedNotional < 0) {
        const abs = Math.abs(signedNotional);
        detail.negativeTotal += abs;
        const prev =
          detail.negativeByWallet.get(wallet) ?? { wallet, label, notional: 0 };
        prev.notional += abs;
        detail.negativeByWallet.set(wallet, prev);
      }
    }

    return details.map((detail) => ({
      ...detail,
      positiveWallets: Array.from(detail.positiveByWallet.values())
        .sort((a, b) => b.notional - a.notional)
        .map((entry) => ({
          ...entry,
          pct: detail.positiveTotal > 0 ? entry.notional / detail.positiveTotal : 0,
        })),
      negativeWallets: Array.from(detail.negativeByWallet.values())
        .sort((a, b) => b.notional - a.notional)
        .map((entry) => ({
          ...entry,
          pct: detail.negativeTotal > 0 ? entry.notional / detail.negativeTotal : 0,
        })),
    }));
  }

  function createTrackedDeltaTooltip(chartRoot) {
    let tooltip = chartRoot.querySelector(".tracked-delta-tooltip");
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.className = "tracked-delta-tooltip";
    tooltip.hidden = true;
    chartRoot.appendChild(tooltip);
    return tooltip;
  }

  function tooltipWalletGroupTitle(mode, positive) {
    if (mode === "spot") return positive ? "Buyers" : "Sellers";
    return positive ? "Buying-style wallets" : "Selling-style wallets";
  }

  function renderTrackedDeltaTooltip(tooltip, detail, mode) {
    const positive = detail.netNotional >= 0;
    const rowsFor = positive ? detail.positiveWallets : detail.negativeWallets;
    const secondaryRows = positive ? detail.negativeWallets : detail.positiveWallets;

    tooltip.innerHTML = "";

    const time = document.createElement("div");
    time.className = "tracked-delta-tooltip-time";
    time.textContent = formatShortTime(detail.time, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const value = document.createElement("div");
    value.className = `tracked-delta-tooltip-value ${positive ? "positive" : "negative"}`;
    value.textContent = `${positive ? "Net inflow" : "Net outflow"} ${formatSignedCompactUsd(
      detail.netNotional,
    )}`;

    tooltip.appendChild(time);
    tooltip.appendChild(value);

    const groups = document.createElement("div");
    groups.className = "tracked-delta-tooltip-groups";

    function appendGroup(titleText, rows) {
      if (!rows.length) return;
      const group = document.createElement("div");
      group.className = "tracked-delta-tooltip-group";
      const title = document.createElement("div");
      title.className = "tracked-delta-tooltip-group-title";
      title.textContent = titleText;
      const list = document.createElement("div");
      list.className = "tracked-delta-tooltip-list";
      rows.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "tracked-delta-tooltip-row";
        const wallet = document.createElement("span");
        wallet.className = "tracked-delta-tooltip-wallet";
        wallet.textContent = entry.label;
        const share = document.createElement("span");
        share.className = "tracked-delta-tooltip-share";
        share.textContent = `${(entry.pct * 100).toFixed(1)}% · ${formatCompactUsd(
          entry.notional,
        )}`;
        row.appendChild(wallet);
        row.appendChild(share);
        list.appendChild(row);
      });
      group.appendChild(title);
      group.appendChild(list);
      groups.appendChild(group);
    }

    appendGroup(tooltipWalletGroupTitle(mode, positive), rowsFor);
    appendGroup(
      positive ? "Offsetting sellers" : "Offsetting buyers",
      secondaryRows,
    );

    if (!groups.childNodes.length) {
      const empty = document.createElement("div");
      empty.className = "tracked-delta-tooltip-group-title";
      empty.textContent = "No contributing wallets";
      groups.appendChild(empty);
    }

    tooltip.appendChild(groups);
  }

  function positionTrackedDeltaTooltip(chartRoot, tooltip, event) {
    const bounds = chartRoot.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const offset = 14;
    let left = event.clientX - bounds.left + offset;
    let top = event.clientY - bounds.top - tooltipRect.height - offset;

    if (left + tooltipRect.width > bounds.width - 8) {
      left = bounds.width - tooltipRect.width - 8;
    }
    if (left < 8) left = 8;
    if (top < 8) {
      top = event.clientY - bounds.top + offset;
    }
    if (top + tooltipRect.height > bounds.height - 8) {
      top = bounds.height - tooltipRect.height - 8;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function bindTrackedDeltaChartHover(chartRoot, bucketDetails, mode) {
    const tooltip = createTrackedDeltaTooltip(chartRoot);

    chartRoot.onmousemove = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const bar = target.closest("rect[data-bucket-index]");
      if (!bar) {
        tooltip.hidden = true;
        return;
      }

      const index = Number(bar.getAttribute("data-bucket-index"));
      if (!Number.isFinite(index) || !bucketDetails[index]) {
        tooltip.hidden = true;
        return;
      }

      renderTrackedDeltaTooltip(tooltip, bucketDetails[index], mode);
      tooltip.hidden = false;
      positionTrackedDeltaTooltip(chartRoot, tooltip, event);
    };

    chartRoot.onmouseleave = () => {
      tooltip.hidden = true;
    };
  }

  function renderTrackedDeltaChart(asset, mode) {
    const chartRoot = ui.trackedDeltaChart;
    const chartTitle = ui.trackedDeltaChartTitle;
    const chartSubtitle = ui.trackedDeltaChartSubtitle;
    const breakdownRoot = ui.trackedDeltaBreakdown;
    if (!chartRoot || !chartTitle || !chartSubtitle || !breakdownRoot) return;

    const windowKey = state.trackedDeltaChartWindow;
    const { window, buckets } = bucketTrackedDeltaSeries(asset, mode, windowKey);
    const selectedFills = trackedDeltaFillsFor(asset, mode, window.ms);
    const summary = summarizeTrackedDelta(asset, mode).find((entry) => entry.key === window.key);
    const priceSeries = state.trackedDeltaPriceSeriesByAsset[asset] ?? [];

    chartTitle.textContent = `Net Flow Per Hour`;
    chartSubtitle.textContent = `${trackedDeltaModeLabel(mode, asset)} · ${window.label} window · orange line = price`;

    if (!selectedFills.length) {
      chartRoot.innerHTML = `<div class="tracked-delta-chart-empty">No ${trackedDeltaModeLabel(mode, asset).toLowerCase()} fills in ${window.label.toLowerCase()}.</div>`;
      breakdownRoot.innerHTML = "";
      chartRoot.onmousemove = null;
      chartRoot.onmouseleave = null;
      return;
    }

    chartRoot.innerHTML = trackedDeltaChartSvg(buckets, priceSeries);
    const bucketDetails = bucketTrackedDeltaWalletDetails(selectedFills, buckets);
    bindTrackedDeltaChartHover(chartRoot, bucketDetails, mode);

    breakdownRoot.innerHTML = "";
    breakdownRoot.appendChild(
      createTrackedDeltaBreakdownItem("Opened Long", formatNumber(summary?.longed ?? 0, 4), "positive"),
    );
    breakdownRoot.appendChild(
      createTrackedDeltaBreakdownItem("Closed Long", formatNumber(summary?.longClosed ?? 0, 4), "negative"),
    );
    breakdownRoot.appendChild(
      createTrackedDeltaBreakdownItem(
        mode === "spot" ? "Spot Buys / Sells" : "Opened Short / Covered Short",
        mode === "spot"
          ? `${formatNumber(summary?.bought ?? 0, 4)} / ${formatNumber(summary?.sold ?? 0, 4)}`
          : `${formatNumber(summary?.shorted ?? 0, 4)} / ${formatNumber(summary?.shortCovered ?? 0, 4)}`,
        mode === "spot" ? "" : "negative",
      ),
    );
  }

  async function loadTrackedDeltaPriceSeries(asset, opts) {
    const assetKey = normalizeCoin(asset);
    if (!assetKey) return;
    if (!opts?.refresh) {
      const cached = getTrackedDeltaCacheEntry("price", assetKey);
      if (Array.isArray(cached?.value)) {
        state.trackedDeltaPriceSeriesByAsset[assetKey] = cached.value;
        return;
      }
    }

    const params = new URLSearchParams({ interval: "1h", limit: "168" });
    if (opts?.refresh) params.set("refresh", "1");

    try {
      const response = await fetch(`/api/klines/${encodeURIComponent(assetKey)}?${params.toString()}`);
      if (!response.ok) throw new Error("price");
      const payload = await response.json();
      const candles = Array.isArray(payload?.candles) ? payload.candles : [];
      state.trackedDeltaPriceSeriesByAsset[assetKey] = candles;
      setTrackedDeltaCacheEntry("price", assetKey, candles);
    } catch {
      state.trackedDeltaPriceSeriesByAsset[assetKey] = [];
    }
  }

  function renderTrackedDelta() {
    renderTrackedDeltaAssetOptions();
    renderTrackedDeltaModeToggle();
    renderTrackedDeltaWindowToggle();
    renderTrackedDeltaFlags();

    const statusEl = ui.trackedDeltaStatus;
    const cardsRoot = ui.trackedDeltaCards;
    const chartRoot = ui.trackedDeltaChart;
    const breakdownRoot = ui.trackedDeltaBreakdown;
    if (!statusEl || !cardsRoot || !chartRoot || !breakdownRoot) return;
    const clearFlowUi = () => {
      cardsRoot.innerHTML = "";
      chartRoot.innerHTML = "";
      breakdownRoot.innerHTML = "";
    };

    if (!state.followedWallets.length) {
      clearFlowUi();
      statusEl.textContent = "Follow wallets to see aggregate asset flow.";
      return;
    }

    const hasRenderableData =
      Boolean(state.trackedDeltaAsset) && Array.isArray(state.trackedDeltaAssets) && state.trackedDeltaAssets.length > 0;

    if (state.trackedDeltaError && !hasRenderableData) {
      clearFlowUi();
      statusEl.textContent = state.trackedDeltaError;
      return;
    }

    if (!state.trackedDeltaAssets.length) {
      clearFlowUi();
      if (state.trackedDeltaLoading) {
        statusEl.textContent = `Loading recent fills across ${state.followedWallets.length} followed wallets...`;
        return;
      }
      statusEl.textContent = `No fills found across followed wallets in the last ${TRACKED_DELTA_MAX_DAYS} days.`;
      return;
    }

    const asset = state.trackedDeltaAsset;
    if (!asset) {
      clearFlowUi();
      statusEl.textContent = "Select an asset to view tracked-wallet flow.";
      return;
    }

    const mode = state.trackedDeltaViewMode;
    const updatedSuffix = state.trackedDeltaUpdatedAt
      ? ` Last updated ${new Date(state.trackedDeltaUpdatedAt).toLocaleTimeString()}.`
      : "";
    statusEl.textContent = state.trackedDeltaLoading
      ? `Showing cached tracked-wallet flow while refreshing.${updatedSuffix}`
      : "Best-effort aggregate from recent followed-wallet fills." + updatedSuffix;

    cardsRoot.innerHTML = "";
    chartRoot.innerHTML = "";
    breakdownRoot.innerHTML = "";
    const summaries = summarizeTrackedDelta(asset, mode);
    summaries.forEach((summary) => {
      cardsRoot.appendChild(createTrackedDeltaSummaryCard(summary, asset, mode));
    });

    renderTrackedDeltaChart(asset, mode);
  }

  async function fetchTrackedDeltaFillsForWallet(wallet, opts) {
    const refresh = opts?.refresh ?? false;
    const cacheKey = normalizeAddress(wallet) || wallet;
    if (!refresh) {
      const cached = getTrackedDeltaCacheEntry("wallet", cacheKey);
      if (Array.isArray(cached?.value)) {
        return cached.value;
      }
    }

    const fills = [];
    const seen = new Set();
    let nextCursorEnd = null;
    let pageCount = 0;

    do {
      const params = new URLSearchParams({
        days: String(TRACKED_DELTA_MAX_DAYS),
        includeTwaps: "0",
      });
      if (nextCursorEnd != null) params.set("cursorEnd", String(nextCursorEnd));
      if (refresh) params.set("refresh", "1");

      const response = await fetch(
        `/api/userFills/${encodeURIComponent(wallet)}?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(`Failed to load tracked fills for ${formatFollowedWalletLabel(wallet)}.`);
      }

      const payload = await response.json();
      for (const fill of payload?.items ?? []) {
        const key = tradeKey(fill);
        if (seen.has(key)) continue;
        seen.add(key);
        const normalized = normalizeTrackedDeltaFill(fill, wallet);
        if (normalized) fills.push(normalized);
      }

      nextCursorEnd = payload?.done ? null : payload?.nextCursorEnd ?? null;
      pageCount += 1;
      if (nextCursorEnd != null && fills.length < TRADES_FETCH_LIMIT) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } while (nextCursorEnd != null && fills.length < TRADES_FETCH_LIMIT && pageCount < 12);

    setTrackedDeltaCacheEntry("wallet", cacheKey, fills);
    return fills;
  }

  async function loadTrackedDelta(opts) {
    const wallets = normalizeWalletList(state.followedWallets);
    const refresh = opts?.refresh ?? false;
    const loadId = ++state.trackedDeltaLoadId;

    if (!wallets.length) {
      state.trackedDeltaLoading = false;
      state.trackedDeltaError = "";
      state.trackedDeltaAssets = [];
      state.trackedDeltaAsset = null;
      state.trackedDeltaFills = [];
      state.trackedDeltaUpdatedAt = Date.now();
      state.trackedDeltaFailedWallets = [];
      renderTrackedDelta();
      return;
    }

    if (!refresh) {
      const cachedSnapshot = getTrackedDeltaCachedSnapshot(wallets);
      if (cachedSnapshot.cachedWalletCount > 0) {
        applyTrackedDeltaSnapshot(cachedSnapshot);
        state.trackedDeltaError = "";
        state.trackedDeltaFailedWallets = [];
        if (cachedSnapshot.cachedWalletCount === wallets.length) {
          state.trackedDeltaLoading = false;
          renderTrackedDelta();
          if (cachedSnapshot.asset && !cachedSnapshot.priceCached) {
            loadTrackedDeltaPriceSeries(cachedSnapshot.asset, { refresh: false })
              .then(() => {
                if (loadId === state.trackedDeltaLoadId) renderTrackedDelta();
              })
              .catch(() => {});
          }
          return;
        }
      }
    }

    state.trackedDeltaLoading = true;
    state.trackedDeltaError = "";
    state.trackedDeltaFailedWallets = [];
    renderTrackedDelta();

    try {
      const results = await Promise.allSettled(
        wallets.map((wallet) => fetchTrackedDeltaFillsForWallet(wallet, { refresh })),
      );
      if (loadId !== state.trackedDeltaLoadId) return;

      const fills = [];
      const failedWallets = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          fills.push(...result.value);
          return;
        }
        failedWallets.push(formatFollowedWalletLabel(wallets[index]));
      });
      fills.sort((a, b) => b.time - a.time);
      const assets = Array.from(new Set(fills.map((fill) => fill.asset))).sort((a, b) =>
        a.localeCompare(b),
      );

      state.trackedDeltaFills = fills;
      state.trackedDeltaAssets = assets;
      state.trackedDeltaFailedWallets = failedWallets;
      if (!state.trackedDeltaAsset || !assets.includes(state.trackedDeltaAsset)) {
        state.trackedDeltaAsset = chooseTrackedDeltaDefaultAsset(assets, fills);
      }
      await loadTrackedDeltaPriceSeries(state.trackedDeltaAsset, { refresh });
      state.trackedDeltaUpdatedAt = Date.now();
    } catch (error) {
      if (loadId !== state.trackedDeltaLoadId) return;
      state.trackedDeltaError =
        error?.message || "Failed to load tracked-wallet delta.";
      state.trackedDeltaFills = [];
      state.trackedDeltaAssets = [];
      state.trackedDeltaAsset = null;
      state.trackedDeltaFailedWallets = [];
    } finally {
      if (loadId === state.trackedDeltaLoadId) {
        state.trackedDeltaLoading = false;
        renderTrackedDelta();
      }
    }
  }

  function renderPositions() {
    const positions = state.positionsData ? getOpenPositions(state.positionsData) : [];

    if (!positions.length) {
      setTableMessage(ui.positionsBody, "No open positions.", 7);
      return;
    }

    ui.positionsBody.innerHTML = "";
    const fragment = document.createDocumentFragment();
    positions.forEach((position) => {
      const size = getSignedSize(position);
      const side = size >= 0 ? "Long" : "Short";
      const tr = document.createElement("tr");
      tr.appendChild(createCell(position.coin ?? "—"));
      tr.appendChild(createCell(side));
      tr.appendChild(createCell(formatNumber(Math.abs(size), 4)));
      tr.appendChild(createCell(formatPrice(position.entryPx)));
      tr.appendChild(createCell(formatUsd(getPositionValue(position))));
      tr.appendChild(createCell(position.liquidationPx ? formatPrice(position.liquidationPx) : "—"));
      const pnlCell = createCell(formatUsd(position.unrealizedPnl));
      const pnl = Number(position.unrealizedPnl);
      if (pnl > 0) pnlCell.classList.add("positive");
      else if (pnl < 0) pnlCell.classList.add("negative");
      tr.appendChild(pnlCell);
      fragment.appendChild(tr);
    });
    ui.positionsBody.appendChild(fragment);
  }

  function renderHoldings() {
    const raw = state.spotData?.data;
    const balances = Array.isArray(raw) ? raw : (raw?.balances ?? []);

    if (!balances.length) {
      setTableMessage(ui.holdingsBody, "No spot balances.", 5);
      return;
    }

    const withValue = balances
      .map((b) => {
        const total = Number(b?.total ?? 0);
        const kind = b?.kind ?? null;
        const hold = kind ? null : Number(b?.hold ?? 0);
        const available = hold == null ? null : total - hold;
        if (total === 0 && hold === 0) return null;
        const usdPx = usdPriceForCoin(b?.coin);
        const usdValue = usdPx == null ? null : usdPx * total;
        return {
          coin: b?.coin ?? "—",
          total,
          hold,
          available,
          kind,
          usdValue,
        };
      })
      .filter(Boolean);

    if (!withValue.length) {
      setTableMessage(ui.holdingsBody, "No spot balances.", 5);
      return;
    }

    const sorted = withValue.slice().sort((a, b) => {
      const dir = state.holdingsSortDir === "asc" ? 1 : -1;
      if (state.holdingsSortKey === "usdValue") {
        const av = a.usdValue;
        const bv = b.usdValue;
        const aOk = av != null && Number.isFinite(av);
        const bOk = bv != null && Number.isFinite(bv);
        if (aOk && bOk) return dir * (av - bv);
        if (aOk && !bOk) return -1;
        if (!aOk && bOk) return 1;
        return normalizeCoin(a.coin).localeCompare(normalizeCoin(b.coin));
      }
      return normalizeCoin(a.coin).localeCompare(normalizeCoin(b.coin));
    });

    ui.holdingsBody.innerHTML = "";
    const fragment = document.createDocumentFragment();
    sorted.forEach((b) => {
      const tr = document.createElement("tr");
      tr.appendChild(createAssetCell(b.coin, b.kind));
      tr.appendChild(createCell(formatNumber(b.total, 6)));
      tr.appendChild(
        createCell(
          b.usdValue == null || !Number.isFinite(Number(b.usdValue))
            ? "—"
            : formatUsd(b.usdValue),
        ),
      );
      tr.appendChild(createCell(b.hold == null ? "—" : formatNumber(b.hold, 6)));
      tr.appendChild(createCell(b.available == null ? "—" : formatNumber(b.available, 6)));
      fragment.appendChild(tr);
    });
    ui.holdingsBody.appendChild(fragment);
  }

  const TRADES_COL_COUNT = 9;

  function renderTrades() {
    state.aggregateFills = ui.aggregateFills?.checked ?? false;
    const fills = state.tradesData?.items ?? [];
    const twaps = state.tradesData?.twaps ?? [];
    const start = state.tradesData?.startTime;
    const end = state.tradesData?.endTime;

    if (state.tradesData && !fills.length && !twaps.length) {
      setTableMessage(ui.tradesBody, "No trades in the selected period.", TRADES_COL_COUNT);
      if (ui.tradesSummary) ui.tradesSummary.textContent = "Showing 0 trades.";
      if (ui.tradesPagination) ui.tradesPagination.hidden = true;
      return;
    }

    if (!fills.length && !twaps.length) {
      setTableMessage(ui.tradesBody, "Load an address to see trades.", TRADES_COL_COUNT);
      if (ui.tradesPagination) ui.tradesPagination.hidden = true;
      return;
    }

    const aggregate = state.aggregateFills;
    const sortTime = (x) =>
      toTimeMs(x?.time ?? x?.endTime ?? x?.startTime ?? 0) || 0;

    let displayItems;
    if (aggregate) {
      const fillGroups = aggregateFillsByCoinAndTime(fills);
      const twapGroups = twaps.map((t) => {
        const tTime = sortTime(t);
        return {
          startTime: tTime,
          endTime: tTime,
          coin: t?.coin ?? "—",
          dir: twapDirLabel(t),
          dirClass: twapDirClass(t),
          isTwap: true,
          twapId: t?.twapId ?? null,
          twapStatus: t?.status ?? null,
          executedSz: Number(t?.executedSz ?? 0),
          totalSzTarget: Number(t?.totalSz ?? 0),
          avgPx: Number(t?.avgPx ?? 0),
          totalSz: Number(t?.executedSz ?? 0),
          totalNotional: Number(t?.executedNtl ?? 0),
          totalFee: null,
          totalPnl: null,
          fills: [],
        };
      });
      displayItems = fillGroups.concat(twapGroups).sort((a, b) => sortTime(b) - sortTime(a));
    } else {
      displayItems = fills
        .map((f) => ({ kind: "fill", ...f }))
        .concat(twaps.map((t) => ({ kind: "twap", ...t })))
        .sort((a, b) => sortTime(b) - sortTime(a));
    }

    const totalItems = displayItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / TRADES_PER_PAGE));
    const page = Math.min(state.tradesPage, totalPages);
    state.tradesPage = page;
    const startIdx = (page - 1) * TRADES_PER_PAGE;
    const slice = displayItems.slice(startIdx, startIdx + TRADES_PER_PAGE);

    if (ui.tradesSummary) {
      const range = start && end ? `${formatTime(start)} – ${formatTime(end)}` : "";
      const status = state.tradesLoading ? " · Loading fills..." : "";
      const fetched = `Fetched ${formatNumber(fills.length, 0)} fills · ${formatNumber(twaps.length, 0)} TWAPs`;
      const perPage = `Showing ${TRADES_PER_PAGE} trades per page (fills + TWAPs).`;
      const from = startIdx + 1;
      const to = Math.min(startIdx + TRADES_PER_PAGE, totalItems);
      if (aggregate) {
        ui.tradesSummary.textContent = `${perPage} · ${fetched}${status}\nShowing ${from}–${to} of ${totalItems} items. ${range}`;
      } else {
        ui.tradesSummary.textContent = `${perPage} · ${fetched}${status}\nShowing ${from}–${to} of ${totalItems} trades. ${range}`;
      }
    }

    if (ui.tradesPagination) {
      ui.tradesPagination.hidden = totalPages <= 1;
      setText(ui.tradesPageInfo, `Page ${page} of ${totalPages}`);
      if (ui.tradesPrev) ui.tradesPrev.disabled = page <= 1;
      if (ui.tradesNext) ui.tradesNext.disabled = page >= totalPages;
    }

    ui.tradesBody.innerHTML = "";
    const fragment = document.createDocumentFragment();

    if (aggregate) {
      slice.forEach((group) => {
        const tr = document.createElement("tr");
        const timeCell = document.createElement("td");
        timeCell.className = "trades-time-cell";
        if (group.startTime === group.endTime) {
          timeCell.textContent = formatTime(group.startTime);
        } else {
          const startLine = document.createElement("div");
          startLine.textContent = formatTime(group.startTime);
          const endLine = document.createElement("div");
          endLine.textContent = formatTime(group.endTime);
          endLine.className = "muted";
          timeCell.appendChild(startLine);
          timeCell.appendChild(endLine);
        }
        tr.appendChild(timeCell);
        const typeCell = document.createElement("td");
        const typePill = document.createElement("span");
        typePill.className = "type-pill";
        typePill.textContent = group.isTwap ? "TWAP" : "Fill ×" + group.fills.length;
        typePill.classList.add(group.isTwap ? "twap" : "fill");
        typeCell.appendChild(typePill);
        tr.appendChild(typeCell);
        tr.appendChild(createCell(group.coin || "—"));
        const dirCell = document.createElement("td");
        const pill = document.createElement("span");
        pill.className = "dir-pill " + group.dirClass;
        pill.textContent = group.dir;
        dirCell.appendChild(pill);
        tr.appendChild(dirCell);
        tr.appendChild(createCell(formatPrice(group.avgPx)));
        if (group.isTwap) {
          tr.appendChild(
            createCell(
              `${formatNumber(group.executedSz, 2)}/${formatNumber(group.totalSzTarget, 2)}`,
            ),
          );
        } else {
          tr.appendChild(createCell(formatNumber(group.totalSz, 4)));
        }
        tr.appendChild(createCell(formatUsd(group.totalNotional)));
        tr.appendChild(createCell(group.isTwap ? "—" : formatUsd(group.totalFee)));
        if (group.isTwap) {
          const statusCell = createCell(twapStatusLabel(group.twapStatus));
          statusCell.classList.add("muted");
          tr.appendChild(statusCell);
        } else {
          const pnlCell = createCell(formatUsd(group.totalPnl));
          if (group.totalPnl > 0) pnlCell.classList.add("positive");
          else if (group.totalPnl < 0) pnlCell.classList.add("negative");
          tr.appendChild(pnlCell);
        }
        fragment.appendChild(tr);
      });
    } else {
      slice.forEach((item) => {
        if (item.kind === "twap") {
          const tr = document.createElement("tr");
          tr.appendChild(createCell(formatTime(item.time)));
          const typeCell = document.createElement("td");
          const typePill = document.createElement("span");
          typePill.className = "type-pill";
          typePill.textContent = "TWAP";
          typePill.classList.add("twap");
          typeCell.appendChild(typePill);
          tr.appendChild(typeCell);
          tr.appendChild(createCell(item.coin ?? "—"));
          const dirCell = document.createElement("td");
          const pill = document.createElement("span");
          pill.className = "dir-pill " + twapDirClass(item);
          pill.textContent = twapDirLabel(item);
          dirCell.appendChild(pill);
          tr.appendChild(dirCell);
          tr.appendChild(createCell(formatPrice(item.avgPx)));
          tr.appendChild(
            createCell(
              `${formatNumber(item.executedSz, 2)}/${formatNumber(item.totalSz, 2)}`,
            ),
          );
          tr.appendChild(createCell(formatUsd(item.executedNtl)));
          tr.appendChild(createCell("—"));
          const statusCell = createCell(twapStatusLabel(item.status));
          statusCell.classList.add("muted");
          tr.appendChild(statusCell);
          fragment.appendChild(tr);
          return;
        }

        const fill = item;
        const px = Number(fill.px);
        const sz = Number(fill.sz);
        const notional = Number.isFinite(px) && Number.isFinite(sz) ? px * sz : null;
        const fee = fill.fee != null ? Number(fill.fee) : null;
        const closedPnl = fill.closedPnl != null ? Number(fill.closedPnl) : null;

        const tr = document.createElement("tr");
        tr.appendChild(createCell(formatTime(fill.time)));
        tr.appendChild(createCell("Fill"));
        tr.appendChild(createCell(fill.coin ?? "—"));
        const dirCell = document.createElement("td");
        const pill = document.createElement("span");
        pill.className = "dir-pill " + dirPillClass(fill);
        pill.textContent = dirLabel(fill);
        dirCell.appendChild(pill);
        tr.appendChild(dirCell);
        tr.appendChild(createCell(formatPrice(px)));
        tr.appendChild(createCell(formatNumber(sz, 4)));
        tr.appendChild(createCell(notional != null ? formatUsd(notional) : "—"));
        tr.appendChild(createCell(fee != null ? formatUsd(fee) : "—"));
        const pnlCell = createCell(closedPnl != null ? formatUsd(closedPnl) : "—");
        if (closedPnl != null) {
          if (closedPnl > 0) pnlCell.classList.add("positive");
          else if (closedPnl < 0) pnlCell.classList.add("negative");
        }
        tr.appendChild(pnlCell);
        fragment.appendChild(tr);
      });
    }
    ui.tradesBody.appendChild(fragment);
  }

  function updateMetrics() {
    const data = state.positionsData?.data;
    const margin = data?.marginSummary ?? data?.crossMarginSummary;
    setText(ui.metricAccountValue, formatUsd(margin?.accountValue));
    setText(ui.metricMargin, formatUsd(margin?.totalMarginUsed));
    setText(ui.metricWithdrawable, formatUsd(state.positionsData?.data?.withdrawable));
  }

  function switchTab(activeTab) {
    [ui.tabPositions, ui.tabHoldings, ui.tabTrades].forEach((tab) => {
      if (!tab) return;
      const isSelected = tab === activeTab;
      tab.setAttribute("aria-selected", isSelected);
    });
    const panels = [ui.panelPositions, ui.panelHoldings, ui.panelTrades];
    const ids = ["tab-positions", "tab-holdings", "tab-trades"];
    const activeId = activeTab?.id ?? "tab-positions";
    panels.forEach((panel, i) => {
      if (!panel) return;
      panel.hidden = ids[i] !== activeId;
    });
    if (activeTab === ui.tabHoldings) renderHoldings();
    if (activeTab === ui.tabTrades) renderTrades();
  }

  function showError(message) {
    setText(ui.addressError, message);
  }

  function clearError() {
    setText(ui.addressError, "");
  }

  async function loadWallet(address) {
    const normalized = normalizeAddress(address);
    if (!normalized) {
      showError("Please enter a valid Ethereum address (0x...).");
      return;
    }

    clearError();
    state.address = normalized;
    state.loading = true;
    if (ui.lookupButton) ui.lookupButton.disabled = true;
    if (ui.addressInput) ui.addressInput.value = state.address;

    updateWalletUrl(state.address);
    renderFollowedWallets();
    ui.walletMain.hidden = true;
    setText(ui.walletAddressTitle, state.address);
    ui.explorerLink.href = `https://hypurrscan.io/address/${encodeURIComponent(state.address)}`;

    state.tradesPage = 1;
    state.tradesData = { items: [], twaps: [], startTime: null, endTime: null };
    state.tradesLoading = false;
    state.tradesNextCursorEnd = null;
    state.tradesSeenKeys = new Set();
    state.tradesAllTwaps = [];

    try {
      const [positionsRes, spotRes, midsRes] = await Promise.all([
        fetch(`/api/positions/${encodeURIComponent(state.address)}`),
        fetch(`/api/spot/${encodeURIComponent(state.address)}`),
        fetch(`/api/mids`).catch(() => null),
      ]);

      if (!positionsRes.ok) throw new Error("Failed to load positions.");
      if (!spotRes.ok) throw new Error("Failed to load spot state.");

      state.positionsData = await positionsRes.json();
      state.spotData = await spotRes.json();
      if (midsRes && midsRes.ok) state.midsData = await midsRes.json();
      else state.midsData = null;
    } catch (err) {
      showError(err.message || "Failed to load wallet data.");
      state.positionsData = null;
      state.spotData = null;
      state.midsData = null;
    } finally {
      state.loading = false;
      if (ui.lookupButton) ui.lookupButton.disabled = false;
    }

    ui.walletMain.hidden = !state.positionsData && !state.spotData;
    if (!ui.walletMain.hidden) {
      updateMetrics();
      renderPositions();
      renderTrackedDelta();
      switchTab(ui.tabPositions);
    }

    if (state.address) {
      loadTrades(state.address, { refresh: false });
    }
  }

  async function loadTrades(address, opts) {
    const refresh = opts?.refresh ?? false;
    const loadId = ++state.tradesLoadId;

    state.tradesPage = 1;
    state.tradesSeenKeys = new Set();
    state.tradesAllTwaps = [];
    state.tradesLoading = true;
    state.tradesNextCursorEnd = null;
    state.tradesData = { items: [], twaps: [], startTime: null, endTime: null };

    const base = `/api/userFills/${encodeURIComponent(address)}?days=${TRADES_FETCH_DAYS}&includeTwaps=1`;
    const firstUrl = refresh ? `${base}&refresh=1` : base;

    try {
      const firstRes = await fetch(firstUrl);
      if (!firstRes.ok) throw new Error("Failed to load trades.");
      const first = await firstRes.json();
      if (loadId !== state.tradesLoadId) return;

      const fills = [];
      appendUniqueFills(fills, first.items ?? []);

      const allTwaps = Array.isArray(first.twaps) ? first.twaps : [];
      state.tradesAllTwaps = allTwaps;
      state.tradesNextCursorEnd = first.nextCursorEnd ?? null;
      state.tradesData = { items: fills, twaps: [], startTime: null, endTime: null };

      const fillRange = computeTradesRangeMs(fills, []);
      const visibleTwaps = fillRange
        ? allTwaps.filter((t) => {
          const tt = toTimeMs(t?.time ?? 0);
          return Number.isFinite(tt) && tt >= fillRange.startTime && tt <= fillRange.endTime;
        })
        : allTwaps.slice();
      state.tradesData.twaps = visibleTwaps;

      const range = computeTradesRangeMs(fills, visibleTwaps);
      if (range) {
        state.tradesData.startTime = range.startTime;
        state.tradesData.endTime = range.endTime;
      }

      renderTrades();

      // Backfill older pages in the background.
      while (
        loadId === state.tradesLoadId &&
        state.tradesLoading &&
        state.tradesNextCursorEnd != null &&
        fills.length < TRADES_FETCH_LIMIT
      ) {
        const cursor = state.tradesNextCursorEnd;
        const pageUrl =
          `/api/userFills/${encodeURIComponent(address)}?days=${TRADES_FETCH_DAYS}` +
          `&cursorEnd=${encodeURIComponent(String(cursor))}&includeTwaps=0` +
          (refresh ? `&refresh=1` : ``);

        const pageRes = await fetch(pageUrl);
        if (!pageRes.ok) break;
        const page = await pageRes.json();
        if (loadId !== state.tradesLoadId) return;

        appendUniqueFills(fills, page.items ?? []);
        state.tradesNextCursorEnd = page.nextCursorEnd ?? null;
        if (page.done) state.tradesNextCursorEnd = null;

        const fillRange2 = computeTradesRangeMs(fills, []);
        const visibleTwaps2 = fillRange2
          ? state.tradesAllTwaps.filter((t) => {
            const tt = toTimeMs(t?.time ?? 0);
            return Number.isFinite(tt) && tt >= fillRange2.startTime && tt <= fillRange2.endTime;
          })
          : state.tradesAllTwaps.slice();

        const r = computeTradesRangeMs(fills, visibleTwaps2);
        if (r) {
          state.tradesData.startTime = r.startTime;
          state.tradesData.endTime = r.endTime;
        }
        state.tradesData.items = fills;
        state.tradesData.twaps = visibleTwaps2;

        // Update UI while we're loading if Trades tab is active.
        if (ui.panelTrades && !ui.panelTrades.hidden) {
          renderTrades();
        }

        // Small pause to reduce rate limiting.
        await new Promise((r2) => setTimeout(r2, 250));

        if (state.tradesNextCursorEnd == null) break;
      }
    } catch (_) {
      // Keep whatever we already loaded.
    } finally {
      if (loadId === state.tradesLoadId) {
        state.tradesLoading = false;
        renderTrades();
      }
    }
  }

  function initTabs() {
    [ui.tabPositions, ui.tabHoldings, ui.tabTrades].forEach((tab) => {
      if (!tab) return;
      tab.addEventListener("click", () => switchTab(tab));
    });
  }

  function setHoldingsSortState(key) {
    if (state.holdingsSortKey === key) {
      state.holdingsSortDir = state.holdingsSortDir === "asc" ? "desc" : "asc";
    } else {
      state.holdingsSortKey = key;
      state.holdingsSortDir = "desc";
    }

    ui.holdingsSortableHeaders.forEach((header) => {
      const headerKey = header.dataset.sort;
      if (headerKey === state.holdingsSortKey) {
        header.setAttribute(
          "aria-sort",
          state.holdingsSortDir === "asc" ? "ascending" : "descending",
        );
      } else {
        header.removeAttribute("aria-sort");
      }
    });

    if (ui.panelHoldings && !ui.panelHoldings.hidden) renderHoldings();
  }

  function initHoldingsSort() {
    ui.holdingsSortableHeaders.forEach((header) => {
      header.addEventListener("click", () => {
        const key = header.dataset.sort;
        if (key) setHoldingsSortState(key);
      });
    });

    // Show a default direction arrow even before the first click.
    if (ui.holdingsSortableHeaders.length) {
      ui.holdingsSortableHeaders.forEach((h) => h.removeAttribute("aria-sort"));
      const header = ui.holdingsSortableHeaders.find((h) => h.dataset.sort === "usdValue");
      if (header) header.setAttribute("aria-sort", "descending");
    }
  }

  function initFollowedWallets() {
    state.followedWallets = loadFollowedWallets();
    saveFollowedWallets();
    renderFollowedWallets();
    loadTrackedDelta({ refresh: false });
  }

  function initFollowedWalletsInteractions() {
    if (ui.followWalletButton) {
      ui.followWalletButton.addEventListener("click", () => {
        const candidate = ui.addressInput?.value?.trim() || state.address;
        if (!addFollowedWallet(candidate)) {
          showError("Enter a valid wallet address first, then click Follow.");
          return;
        }
        clearError();
        loadTrackedDelta({ refresh: false });
      });
    }

    if (ui.followedWalletsList) {
      ui.followedWalletsList.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("button");
        if (!button) return;

        const address = button.dataset.address;
        if (!address) return;

        if (button.dataset.role === "remove") {
          removeFollowedWallet(address);
          loadTrackedDelta({ refresh: false });
          return;
        }

        if (button.dataset.role === "open") {
          if (ui.addressInput) ui.addressInput.value = address;
          loadWallet(address);
        }
      });
    }
  }

  function getAddressFromPath() {
    const match = location.pathname.match(/^\/wallets\/(0x[a-fA-F0-9]{40})\/?$/);
    return match ? match[1] : null;
  }

  function updateWalletUrl(address) {
    if (!address || !isAddress(address)) return;
    const path = "/wallets/" + address;
    if (location.pathname !== path) {
      history.replaceState(null, "", path);
    }
  }

  function initFromUrl() {
    const addressFromPath = getAddressFromPath();
    const addressFromQuery = new URLSearchParams(location.search).get("address")?.trim();
    const address = normalizeAddress(addressFromPath) || normalizeAddress(addressFromQuery);
    if (address) {
      if (ui.addressInput) ui.addressInput.value = address;
      loadWallet(address);
    }
  }

  function initSegmentedToggleKeyboard(root, selector, onSelect) {
    if (!root) return;
    root.addEventListener("keydown", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const current = target.closest(selector);
      if (!(current instanceof HTMLButtonElement)) return;

      const buttons = Array.from(root.querySelectorAll(selector)).filter(
        (button) => button instanceof HTMLButtonElement,
      );
      if (!buttons.length) return;

      const index = buttons.indexOf(current);
      if (index === -1) return;

      let nextIndex = index;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (index + 1) % buttons.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (index - 1 + buttons.length) % buttons.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = buttons.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      const next = buttons[nextIndex];
      next.focus();
      onSelect(next);
    });
  }

  function init() {
    if (ui.addressInput && ui.lookupButton) {
      ui.lookupButton.addEventListener("click", () => {
        loadWallet(ui.addressInput.value);
      });
      ui.addressInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") loadWallet(ui.addressInput.value);
      });
    }
    if (ui.tradesRefresh) {
      ui.tradesRefresh.addEventListener("click", () => {
        if (state.address) {
          loadTrades(state.address, { refresh: true });
        }
      });
    }
    if (ui.aggregateFills) {
      ui.aggregateFills.addEventListener("change", () => {
        state.aggregateFills = ui.aggregateFills.checked;
        state.tradesPage = 1;
        renderTrades();
      });
    }
    if (ui.tradesPrev) {
      ui.tradesPrev.addEventListener("click", () => {
        if (state.tradesPage > 1) {
          state.tradesPage -= 1;
          renderTrades();
        }
      });
    }
    if (ui.tradesNext) {
      ui.tradesNext.addEventListener("click", () => {
        const fills = state.tradesData?.items ?? [];
        const twaps = state.tradesData?.twaps ?? [];
        const aggregate = ui.aggregateFills?.checked ?? false;
        const sortTime = (x) =>
          toTimeMs(x?.time ?? x?.endTime ?? x?.startTime ?? 0) || 0;

        const displayItems = aggregate
          ? aggregateFillsByCoinAndTime(fills).concat(
            twaps.map((t) => {
              const tTime = sortTime(t);
              return {
                startTime: tTime,
                endTime: tTime,
                coin: t?.coin ?? "—",
                dir: twapDirLabel(t),
                dirClass: twapDirClass(t),
                isTwap: true,
                twapId: t?.twapId ?? null,
                twapStatus: t?.status ?? null,
                executedSz: Number(t?.executedSz ?? 0),
                totalSzTarget: Number(t?.totalSz ?? 0),
                avgPx: Number(t?.avgPx ?? 0),
                totalSz: Number(t?.executedSz ?? 0),
                totalNotional: Number(t?.executedNtl ?? 0),
                totalFee: null,
                totalPnl: null,
                fills: [],
              };
            }),
          )
          : fills
            .map((f) => ({ kind: "fill", ...f }))
            .concat(twaps.map((t) => ({ kind: "twap", ...t })));
        const totalPages = Math.max(1, Math.ceil(displayItems.length / TRADES_PER_PAGE));
        if (state.tradesPage < totalPages) {
          state.tradesPage += 1;
          renderTrades();
        }
      });
    }
    if (ui.trackedDeltaAsset) {
      ui.trackedDeltaAsset.addEventListener("change", async () => {
        state.trackedDeltaAsset = normalizeCoin(ui.trackedDeltaAsset.value) || null;
        await loadTrackedDeltaPriceSeries(state.trackedDeltaAsset, { refresh: false });
        renderTrackedDelta();
      });
    }
    if (ui.trackedDeltaRefresh) {
      ui.trackedDeltaRefresh.addEventListener("click", () => {
        loadTrackedDelta({ refresh: true });
      });
    }
    if (ui.trackedDeltaModeToggle) {
      const applyModeSelection = (button) => {
        state.trackedDeltaViewMode = button?.dataset.mode || "all";
        renderTrackedDelta();
      };
      ui.trackedDeltaModeToggle.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("button[data-mode]");
        if (!button) return;
        applyModeSelection(button);
      });
      initSegmentedToggleKeyboard(
        ui.trackedDeltaModeToggle,
        "button[data-mode]",
        applyModeSelection,
      );
    }
    if (ui.trackedDeltaWindowToggle) {
      const applyWindowSelection = (button) => {
        state.trackedDeltaChartWindow = button?.dataset.window || "7d";
        renderTrackedDelta();
      };
      ui.trackedDeltaWindowToggle.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("button[data-window]");
        if (!button) return;
        applyWindowSelection(button);
      });
      initSegmentedToggleKeyboard(
        ui.trackedDeltaWindowToggle,
        "button[data-window]",
        applyWindowSelection,
      );
    }
    initTabs();
    initHoldingsSort();
    initFollowedWallets();
    initFollowedWalletsInteractions();
    initFromUrl();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
