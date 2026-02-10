(function () {
  const TRADES_PER_PAGE = 20;
  const TRADES_FETCH_DAYS = 90;
  const AGGREGATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

  const ui = {
    addressInput: document.getElementById("address-input"),
    lookupButton: document.getElementById("lookup-button"),
    addressError: document.getElementById("address-error"),
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
  };

  let state = {
    address: null,
    positionsData: null,
    spotData: null,
    tradesData: null,
    tradesPage: 1,
    aggregateFills: false,
    loading: false,
  };

  function isAddress(value) {
    return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
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

  /** Group fills by same coin and within AGGREGATE_WINDOW_MS of the group start. Returns array of { startTime, endTime, fills, coin, dir, totalSz, totalNotional, totalFee, totalPnl, avgPx }. */
  function aggregateFillsByCoinAndTime(items) {
    if (!items.length) return [];
    const sorted = items.slice().sort((a, b) => {
      const c = (a.coin ?? "").localeCompare(b.coin ?? "");
      if (c !== 0) return c;
      return (Number(a.time) || 0) - (Number(b.time) || 0);
    });
    const groups = [];
    let current = null;
    for (const fill of sorted) {
      const t = Number(fill.time) || 0;
      const coin = fill.coin ?? "";
      if (
        current &&
        current.coin === coin &&
        t - current.startTime <= AGGREGATE_WINDOW_MS
      ) {
        current.fills.push(fill);
        current.endTime = t;
        const sz = Number(fill.sz) || 0;
        const px = Number(fill.px) || 0;
        current.totalSz += sz;
        current.totalNotional += px * sz;
        current.totalFee += Number(fill.fee) || 0;
        current.totalPnl += Number(fill.closedPnl) || 0;
      } else {
        current = {
          startTime: t,
          endTime: t,
          coin,
          fills: [fill],
          dir: dirLabel(fill),
          dirClass: dirPillClass(fill),
          totalSz: Number(fill.sz) || 0,
          totalNotional: (Number(fill.px) || 0) * (Number(fill.sz) || 0),
          totalFee: Number(fill.fee) || 0,
          totalPnl: Number(fill.closedPnl) || 0,
        };
        groups.push(current);
      }
    }
    groups.forEach((g) => {
      g.avgPx = g.totalSz > 0 ? g.totalNotional / g.totalSz : 0;
    });
    return groups;
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
      setTableMessage(ui.holdingsBody, "No spot balances.", 4);
      return;
    }

    const withValue = balances
      .map((b) => {
        const total = Number(b?.total ?? b?.hold ?? 0);
        const hold = Number(b?.hold ?? 0);
        const available = total - hold;
        if (total === 0 && hold === 0) return null;
        return {
          coin: b?.coin ?? "—",
          total,
          hold,
          available,
        };
      })
      .filter(Boolean);

    if (!withValue.length) {
      setTableMessage(ui.holdingsBody, "No spot balances.", 4);
      return;
    }

    ui.holdingsBody.innerHTML = "";
    const fragment = document.createDocumentFragment();
    withValue.forEach((b) => {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(b.coin));
      tr.appendChild(createCell(formatNumber(b.total, 6)));
      tr.appendChild(createCell(formatNumber(b.hold, 6)));
      tr.appendChild(createCell(formatNumber(b.available, 6)));
      fragment.appendChild(tr);
    });
    ui.holdingsBody.appendChild(fragment);
  }

  const TRADES_COL_COUNT = 9;

  function renderTrades() {
    state.aggregateFills = ui.aggregateFills?.checked ?? false;
    const items = state.tradesData?.items ?? [];
    const start = state.tradesData?.startTime;
    const end = state.tradesData?.endTime;

    if (state.tradesData && !items.length) {
      setTableMessage(ui.tradesBody, "No trades in the selected period.", TRADES_COL_COUNT);
      if (ui.tradesSummary) ui.tradesSummary.textContent = "Showing 0 trades.";
      if (ui.tradesPagination) ui.tradesPagination.hidden = true;
      return;
    }

    if (!items.length) {
      setTableMessage(ui.tradesBody, "Load an address to see trades.", TRADES_COL_COUNT);
      if (ui.tradesPagination) ui.tradesPagination.hidden = true;
      return;
    }

    const aggregate = state.aggregateFills;
    let displayItems = aggregate ? aggregateFillsByCoinAndTime(items) : items;
    const sortTime = (x) => toTimeMs(x.time ?? x.endTime ?? x.startTime ?? 0) || 0;
    displayItems = displayItems.slice().sort((a, b) => sortTime(b) - sortTime(a));
    const totalItems = displayItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / TRADES_PER_PAGE));
    const page = Math.min(state.tradesPage, totalPages);
    state.tradesPage = page;
    const startIdx = (page - 1) * TRADES_PER_PAGE;
    const slice = displayItems.slice(startIdx, startIdx + TRADES_PER_PAGE);

    if (ui.tradesSummary) {
      const range = start && end ? `${formatTime(start)} – ${formatTime(end)}` : "";
      const from = startIdx + 1;
      const to = Math.min(startIdx + TRADES_PER_PAGE, totalItems);
      if (aggregate) {
        ui.tradesSummary.textContent = `Showing ${from}–${to} of ${totalItems} groups (${items.length} fills). ${range}`;
      } else {
        ui.tradesSummary.textContent = `Showing ${from}–${to} of ${totalItems} trades. ${range}`;
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
        typePill.textContent = "Fill ×" + group.fills.length;
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
        tr.appendChild(createCell(formatNumber(group.totalSz, 4)));
        tr.appendChild(createCell(formatUsd(group.totalNotional)));
        tr.appendChild(createCell(formatUsd(group.totalFee)));
        const pnlCell = createCell(formatUsd(group.totalPnl));
        if (group.totalPnl > 0) pnlCell.classList.add("positive");
        else if (group.totalPnl < 0) pnlCell.classList.add("negative");
        tr.appendChild(pnlCell);
        fragment.appendChild(tr);
      });
    } else {
      slice.forEach((fill) => {
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
    if (!isAddress(address)) {
      showError("Please enter a valid Ethereum address (0x...).");
      return;
    }

    clearError();
    state.address = address.trim();
    state.loading = true;
    if (ui.lookupButton) ui.lookupButton.disabled = true;

    updateWalletUrl(state.address);
    ui.walletMain.hidden = true;
    setText(ui.walletAddressTitle, state.address);
    ui.explorerLink.href = `https://hypurrscan.io/address/${encodeURIComponent(state.address)}`;

    state.tradesPage = 1;

    try {
      const [positionsRes, spotRes, tradesRes] = await Promise.all([
        fetch(`/api/positions/${encodeURIComponent(state.address)}`),
        fetch(`/api/spot/${encodeURIComponent(state.address)}`),
        fetch(`/api/userFills/${encodeURIComponent(state.address)}?days=${TRADES_FETCH_DAYS}`),
      ]);

      if (!positionsRes.ok) throw new Error("Failed to load positions.");
      if (!spotRes.ok) throw new Error("Failed to load spot state.");
      if (!tradesRes.ok) throw new Error("Failed to load trades.");

      state.positionsData = await positionsRes.json();
      state.spotData = await spotRes.json();
      state.tradesData = await tradesRes.json();
    } catch (err) {
      showError(err.message || "Failed to load wallet data.");
      state.positionsData = null;
      state.spotData = null;
      state.tradesData = null;
    } finally {
      state.loading = false;
      if (ui.lookupButton) ui.lookupButton.disabled = false;
    }

    ui.walletMain.hidden = !state.positionsData && !state.spotData && !state.tradesData;
    if (!ui.walletMain.hidden) {
      updateMetrics();
      renderPositions();
      switchTab(ui.tabPositions);
    }
  }

  function initTabs() {
    [ui.tabPositions, ui.tabHoldings, ui.tabTrades].forEach((tab) => {
      if (!tab) return;
      tab.addEventListener("click", () => switchTab(tab));
    });
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
    const address = addressFromPath || (addressFromQuery && isAddress(addressFromQuery) ? addressFromQuery : null);
    if (address && isAddress(address)) {
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
          state.tradesPage = 1;
          fetch(`/api/userFills/${encodeURIComponent(state.address)}?days=${TRADES_FETCH_DAYS}&refresh=1`)
            .then((r) => r.ok ? r.json() : Promise.reject(new Error("Refresh failed")))
            .then((data) => {
              state.tradesData = data;
              renderTrades();
            })
            .catch(() => {});
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
        const items = state.tradesData?.items ?? [];
        const aggregate = ui.aggregateFills?.checked ?? false;
        const displayItems = aggregate ? aggregateFillsByCoinAndTime(items) : items;
        const totalPages = Math.max(1, Math.ceil(displayItems.length / TRADES_PER_PAGE));
        if (state.tradesPage < totalPages) {
          state.tradesPage += 1;
          renderTrades();
        }
      });
    }
    initTabs();
    initFromUrl();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
