(function () {
  const TRADES_PER_PAGE = 20;
  const TRADES_FETCH_DAYS = 90;
  const TRADES_FETCH_LIMIT = 8000; // total fills to accumulate client-side before stopping
  const TRADES_PAGE_SIZE = 2000; // HL `userFills` page size cap
  // Merge adjacent order-groups within a "trade session" window.
  // HL tends to merge sequential orders that build/close a position over hours.
  const AGGREGATE_MERGE_GAP_MS = 24 * 60 * 60 * 1000; // 24 hours
  const AGGREGATE_MERGE_MAX_PX_DIFF = 0.12; // 12% relative difference guardrail
  const FOLLOWED_WALLETS_KEY = "hl-followed-wallets-v1";
  const DEFAULT_FOLLOWED_WALLETS = [
    "0xaf0fdd39e5d92499b0ed9f68693da99c0ec1e92e",
    "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae",
    "0xcb58b8f5ec6d47985f0728465c25a08ef9ad2c7b",
    "0xadd12adbbd5db87674b38af99b6dd34dd2a45e0d",
  ];

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
  };

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

  function formatAddressShort(address) {
    if (!isAddress(address)) return address ?? "—";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  function saveFollowedWallets() {
    try {
      localStorage.setItem(FOLLOWED_WALLETS_KEY, JSON.stringify(state.followedWallets));
    } catch {
      // Ignore storage failures (private mode/quota/etc).
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

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "followed-wallet-open";
      if (wallet === state.address) openButton.classList.add("active");
      openButton.dataset.role = "open";
      openButton.dataset.address = wallet;
      openButton.textContent = formatAddressShort(wallet);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "followed-wallet-remove";
      removeButton.dataset.role = "remove";
      removeButton.dataset.address = wallet;
      removeButton.ariaLabel = `Remove ${wallet} from followed wallets`;
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
