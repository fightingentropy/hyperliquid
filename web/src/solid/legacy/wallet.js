const SVG_NS = "http://www.w3.org/2000/svg";
const WALLET_PATH_REGEX = /^\/wallets\/(0x[a-fA-F0-9]{40})\/?$/;
const FOLLOWED_WALLETS_KEY = "hl-followed-wallets-v2";
const DEFAULT_CHART_TYPE = "pnl";
const DEFAULT_CHART_SCOPE = "total";
const DEFAULT_CHART_WINDOW = "month";
const DEFAULT_TAB = "positions";
const NOTIONAL_WINDOWS = ["1h", "4h", "12h", "1d", "7d"];
const CHART_WINDOW_LABELS = {
  day: "24h",
  week: "7d",
  month: "30d",
  allTime: "All",
};
const DEFAULT_FOLLOWED_WALLETS = [
  "0xaf0FDd39e5D92499B0eD9F68693DA99C0ec1e92e",
  "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae",
  "0xcb58b8f5ec6d47985f0728465c25a08ef9ad2c7b",
  "0xadD12ADBbD5Db87674b38Af99b6dD34Dd2A45e0d",
  "0x519c721de735f7c9e6146d167852e60d60496a47",
  "0x4cb5f4d145cd16460932bbb9b871bb6fd5db97e3",
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
const PREFERRED_FOLLOWED_WALLET_CASE = Object.freeze(
  Object.fromEntries(
    DEFAULT_FOLLOWED_WALLETS.map((address) => [address.trim().toLowerCase(), address]),
  ),
);

export function mountWalletPage() {
  const ui = {
    addressInput: document.getElementById("address-input"),
    lookupButton: document.getElementById("lookup-button"),
    followWalletButton: document.getElementById("follow-wallet-button"),
    refreshButton: document.getElementById("refresh-button"),
    copyAddressButton: document.getElementById("copy-address-button"),
    openQwantifyLink: document.getElementById("open-qwantify-link"),
    addressError: document.getElementById("address-error"),
    walletStatus: document.getElementById("wallet-status"),
    walletAddressTitle: document.getElementById("wallet-address-title"),
    walletSummaryCaption: document.getElementById("wallet-summary-caption"),
    trackedShell: document.querySelector(".wallet-tracked-shell"),
    followedWalletsList: document.getElementById("followed-wallets-list"),
    metricTotalEquity: document.getElementById("metric-total-equity"),
    metricTotalEquityBar: document.getElementById("metric-total-equity-bar"),
    metricTotalEquitySubtext: document.getElementById("metric-total-equity-subtext"),
    metricRealizedPnl: document.getElementById("metric-realized-pnl"),
    metricRealizedPnlDay: document.getElementById("metric-realized-pnl-day"),
    metricRealizedPnlWeek: document.getElementById("metric-realized-pnl-week"),
    metricMarginUtilization: document.getElementById("metric-margin-utilization"),
    metricMarginUtilizationBar: document.getElementById("metric-margin-utilization-bar"),
    metricMarginUtilizationSubtext: document.getElementById(
      "metric-margin-utilization-subtext",
    ),
    metricRiskProfile: document.getElementById("metric-risk-profile"),
    metricRiskLongBar: document.getElementById("metric-risk-long-bar"),
    metricRiskShortBar: document.getElementById("metric-risk-short-bar"),
    metricRiskProfileSubtext: document.getElementById("metric-risk-profile-subtext"),
    chartTypeToggle: document.getElementById("chart-type-toggle"),
    chartScopeToggle: document.getElementById("chart-scope-toggle"),
    chartWindowToggle: document.getElementById("chart-window-toggle"),
    performanceChart: document.getElementById("wallet-performance-chart"),
    performanceEmpty: document.getElementById("wallet-performance-empty"),
    compositionDonut: document.getElementById("wallet-composition-donut"),
    compositionTotal: document.getElementById("wallet-composition-total"),
    compositionLegend: document.getElementById("wallet-composition-legend"),
    tabbar: document.getElementById("wallet-tabbar"),
    positionsLongTotal: document.getElementById("positions-long-total"),
    positionsShortTotal: document.getElementById("positions-short-total"),
    positionsEquityTotal: document.getElementById("positions-equity-total"),
    positionsNotionalTotal: document.getElementById("positions-notional-total"),
    positionsBody: document.getElementById("positions-body"),
    fillsBody: document.getElementById("fills-body"),
    holdingsBody: document.getElementById("holdings-body"),
    notionalBody: document.getElementById("notional-deltas-body"),
    statAllTimePnl: document.getElementById("stat-all-time-pnl"),
    statMonthPnl: document.getElementById("stat-month-pnl"),
    statRecentFills: document.getElementById("stat-recent-fills"),
    statOpenPositions: document.getElementById("stat-open-positions"),
    statSpotAssets: document.getElementById("stat-spot-assets"),
    statTrackedWallets: document.getElementById("stat-tracked-wallets"),
    tabButtons: Array.from(document.querySelectorAll("[data-tab]")),
    tabPanels: Array.from(document.querySelectorAll("[data-tab-panel]")),
  };

  const state = {
    address: null,
    loadId: 0,
    followedWallets: [],
    chartType: DEFAULT_CHART_TYPE,
    chartScope: DEFAULT_CHART_SCOPE,
    chartWindow: DEFAULT_CHART_WINDOW,
    activeTab: DEFAULT_TAB,
    dashboardPayload: null,
    holdingsPayload: null,
    fillsPayload: null,
    notionalPayload: null,
    dashboardLoading: false,
    holdingsLoading: false,
    fillsLoading: false,
    notionalLoading: false,
    dashboardError: null,
    holdingsError: null,
    fillsError: null,
    notionalError: null,
  };

  function isAddress(value) {
    return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
  }

  function addressKey(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function normalizeAddress(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!isAddress(trimmed)) return null;
    return PREFERRED_FOLLOWED_WALLET_CASE[addressKey(trimmed)] || trimmed;
  }

  function parseNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function setText(element, value) {
    if (!element) return;
    element.textContent = value ?? "";
  }

  function setStatus(message, tone = "neutral") {
    if (!ui.walletStatus) return;
    ui.walletStatus.dataset.tone = tone;
    ui.walletStatus.textContent = message || "";
  }

  function setAddressError(message) {
    setText(ui.addressError, message || "");
  }

  function setButtonsDisabled(disabled) {
    if (ui.lookupButton) ui.lookupButton.disabled = disabled;
    if (ui.refreshButton) ui.refreshButton.disabled = disabled;
    if (ui.addressInput) ui.addressInput.disabled = disabled;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatAddressShort(address) {
    if (!isAddress(address)) return address ?? "—";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  function walletLabel(address) {
    const normalized = normalizeAddress(address);
    if (!normalized) return null;
    return DEFAULT_FOLLOWED_WALLET_LABELS[addressKey(normalized)] ?? null;
  }

  function formatFollowedWalletLabel(address) {
    const label = walletLabel(address);
    const short = formatAddressShort(address);
    return label ? `${label} (${short})` : short;
  }

  function formatUsd(value, options = {}) {
    const number = parseNumber(value);
    const absolute = Math.abs(number);
    const compact = options.compact ?? absolute >= 1000;
    const defaultMin = compact ? 2 : 0;
    const defaultMax = compact ? 2 : 2;
    const maximumFractionDigits = options.maximumFractionDigits ?? defaultMax;
    const minimumFractionDigits =
      options.minimumFractionDigits ?? Math.min(defaultMin, maximumFractionDigits);
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: compact ? "compact" : "standard",
      compactDisplay: "short",
      minimumFractionDigits,
      maximumFractionDigits,
    });
    return formatter.format(number);
  }

  function formatSignedUsd(value, options = {}) {
    const number = parseNumber(value);
    if (number === 0) return "$0";
    const absoluteLabel = formatUsd(Math.abs(number), {
      compact: options.compact,
      minimumFractionDigits: options.minimumFractionDigits,
      maximumFractionDigits: options.maximumFractionDigits,
    });
    return `${number > 0 ? "+" : "-"}${absoluteLabel}`;
  }

  function formatPercent(value, digits = 1) {
    const number = parseNumber(value);
    return `${number.toFixed(digits)}%`;
  }

  function formatSignedPercent(value, digits = 1) {
    const number = parseNumber(value);
    if (number === 0) return `0.${"0".repeat(digits)}%`;
    return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
  }

  function formatNumber(value, digits = 2) {
    const number = parseNumber(value);
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(number);
  }

  function formatDateTime(value) {
    const timestamp = Number(value) || Date.parse(String(value ?? ""));
    if (!Number.isFinite(timestamp)) return "—";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  function formatChartTickTime(value) {
    const timestamp = parseNumber(value);
    if (!timestamp) return "";
    const formatter =
      state.chartWindow === "day"
        ? new Intl.DateTimeFormat(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })
        : new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
          });
    return formatter.format(new Date(timestamp));
  }

  function getToneClass(number) {
    if (number > 0) return "positive";
    if (number < 0) return "negative";
    return "neutral";
  }

  function normalizeWalletList(candidates) {
    const seen = new Set();
    const wallets = [];
    for (const candidate of candidates ?? []) {
      const normalized = normalizeAddress(candidate);
      const key = addressKey(normalized);
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      wallets.push(normalized);
    }
    return wallets;
  }

  function saveFollowedWallets() {
    try {
      localStorage.setItem(FOLLOWED_WALLETS_KEY, JSON.stringify(state.followedWallets));
    } catch {
      // Ignore storage failures.
    }
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
        if (!wallets.some((entry) => addressKey(entry) === addressKey(wallet))) {
          wallets.push(wallet);
        }
      }
      return wallets;
    } catch {
      return defaults.slice();
    }
  }

  function isFollowing(address) {
    return state.followedWallets.some((wallet) => addressKey(wallet) === addressKey(address));
  }

  function addFollowedWallet(address) {
    const normalized = normalizeAddress(address);
    if (!normalized) return false;
    state.followedWallets = [
      normalized,
      ...state.followedWallets.filter((wallet) => addressKey(wallet) !== addressKey(normalized)),
    ];
    saveFollowedWallets();
    renderFollowedWallets();
    renderFollowButton();
    renderStatistics();
    return true;
  }

  function removeFollowedWallet(address) {
    const normalized = normalizeAddress(address);
    if (!normalized) return;
    state.followedWallets = state.followedWallets.filter(
      (wallet) => addressKey(wallet) !== addressKey(normalized),
    );
    saveFollowedWallets();
    renderFollowedWallets();
    renderFollowButton();
    renderStatistics();
  }

  function readAddressFromPath() {
    const match = location.pathname.match(WALLET_PATH_REGEX);
    return match ? normalizeAddress(match[1]) : null;
  }

  function updateHistory(address, replace) {
    const targetPath = address ? `/wallets/${address}` : "/wallets";
    if (location.pathname === targetPath) return;
    const method = replace ? "replaceState" : "pushState";
    history[method]({ address }, "", targetPath);
  }

  function normalizePortfolio(payload) {
    if (Array.isArray(payload)) {
      return Object.fromEntries(
        payload.filter(
          (entry) =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            typeof entry[0] === "string" &&
            entry[1] &&
            typeof entry[1] === "object",
        ),
      );
    }
    return payload && typeof payload === "object" ? payload : {};
  }

  function portfolioBucketKey(scope, windowKey) {
    const totalMap = {
      day: "day",
      week: "week",
      month: "month",
      allTime: "allTime",
    };
    const perpMap = {
      day: "perpDay",
      week: "perpWeek",
      month: "perpMonth",
      allTime: "perpAllTime",
    };
    return (scope === "perp" ? perpMap : totalMap)[windowKey] ?? "month";
  }

  function parseHistory(history) {
    return (Array.isArray(history) ? history : [])
      .map((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) return null;
        const time = parseNumber(entry[0]);
        const value = parseNumber(entry[1]);
        if (!Number.isFinite(time) || !Number.isFinite(value)) return null;
        return { time, value };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
  }

  function latestHistoryValue(history) {
    const parsed = parseHistory(history);
    return parsed.length ? parsed[parsed.length - 1].value : 0;
  }

  function normalizeSymbol(symbol) {
    const raw = String(symbol ?? "").trim();
    if (!raw) return "—";
    const pieces = raw.split(":");
    return pieces[pieces.length - 1];
  }

  function midPriceForCoin(coin, mids) {
    const raw = String(coin ?? "").trim();
    if (!raw) return 0;
    if (raw === "USDC" || raw === "USD" || raw === "USDT") return 1;
    const direct = parseNumber(mids?.[raw]);
    if (direct > 0) return direct;
    const normalized = normalizeSymbol(raw);
    const simple = parseNumber(mids?.[normalized]);
    if (simple > 0) return simple;
    const fallbackKey = Object.keys(mids ?? {}).find((key) => normalizeSymbol(key) === normalized);
    if (fallbackKey) {
      const fallback = parseNumber(mids?.[fallbackKey]);
      if (fallback > 0) return fallback;
    }
    return 0;
  }

  function getDashboardData() {
    return state.dashboardPayload?.data ?? null;
  }

  function getHoldingsData() {
    return state.holdingsPayload?.data ?? null;
  }

  function getPortfolio() {
    return normalizePortfolio(getDashboardData()?.portfolio);
  }

  function getClearinghouse() {
    const clearinghouse = getDashboardData()?.clearinghouse;
    return clearinghouse && typeof clearinghouse === "object" ? clearinghouse : {};
  }

  function getSpotState() {
    const spot = getHoldingsData()?.spot;
    return spot && typeof spot === "object" ? spot : {};
  }

  function getMids() {
    const mids = getHoldingsData()?.mids;
    return mids && typeof mids === "object" ? mids : {};
  }

  function getPositionRows() {
    const clearinghouse = getClearinghouse();
    return (Array.isArray(clearinghouse.assetPositions) ? clearinghouse.assetPositions : [])
      .map((entry) => {
        const position = entry?.position ?? {};
        const size = parseNumber(position.szi);
        const positionValue = parseNumber(position.positionValue);
        const markPrice =
          Math.abs(size) > 0 ? Math.abs(positionValue) / Math.abs(size) : midPriceForCoin(position.coin, getMids());
        return {
          symbol: normalizeSymbol(position.coin),
          rawSymbol: position.coin,
          size,
          entry: parseNumber(position.entryPx),
          mark: markPrice,
          value: positionValue,
          unrealizedPnl: parseNumber(position.unrealizedPnl),
          roe: parseNumber(position.returnOnEquity) * 100,
          funding: parseNumber(position?.cumFunding?.sinceOpen) * -1,
          liqPrice: parseNumber(position.liquidationPx),
          marginUsed: parseNumber(position.marginUsed),
        };
      })
      .filter((row) => Math.abs(row.size) > 0);
  }

  function getHoldingRows() {
    const spot = getSpotState();
    const mids = getMids();
    return (Array.isArray(spot.balances) ? spot.balances : [])
      .map((entry) => {
        const total = parseNumber(entry.total);
        const hold = parseNumber(entry.hold);
        const available = Math.max(0, total - hold);
        const mid = midPriceForCoin(entry.coin, mids);
        const value = mid > 0 ? total * mid : parseNumber(entry.entryNtl);
        const entryNtl = parseNumber(entry.entryNtl);
        const avgEntry = total > 0 ? entryNtl / total : 0;
        return {
          coin: entry.kind === "delegated" ? `${normalizeSymbol(entry.coin)} (Staked)` : normalizeSymbol(entry.coin),
          rawCoin: entry.coin,
          kind: entry.kind ?? "spot",
          total,
          available,
          value,
          avgEntry,
          unrealized: entryNtl > 0 ? value - entryNtl : 0,
        };
      })
      .filter((row) => row.total > 0 || row.available > 0 || row.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  function getCompositionParts() {
    const portfolio = getPortfolio();
    const clearinghouse = getClearinghouse();
    const holdings = getHoldingRows();
    const mids = getMids();

    const perpEquity =
      parseNumber(clearinghouse?.marginSummary?.accountValue) ||
      latestHistoryValue(portfolio.perpAllTime?.accountValueHistory);

    let spotValue = 0;
    let stakedValue = 0;
    for (const holding of holdings) {
      if (holding.kind === "delegated") stakedValue += holding.value;
      else if (holding.rawCoin === "HYPE" && holding.coin.includes("(Staked)")) stakedValue += holding.value;
      else spotValue += holding.value;
    }

    if (stakedValue === 0) {
      const delegated = parseNumber(getSpotState()?.stakingSummary?.delegated);
      if (delegated > 0) {
        stakedValue = delegated * (midPriceForCoin("HYPE", mids) || 0);
      }
    }

    const totalEquity =
      latestHistoryValue(portfolio.allTime?.accountValueHistory) || spotValue + stakedValue + perpEquity;

    return {
      totalEquity,
      spotValue,
      stakedValue,
      perpEquity,
    };
  }

  function getSummaryMetrics() {
    const portfolio = getPortfolio();
    const clearinghouse = getClearinghouse();
    const composition = getCompositionParts();
    const positions = getPositionRows();
    const marginSummary = clearinghouse.marginSummary ?? {};
    const totalMarginUsed = parseNumber(marginSummary.totalMarginUsed);
    const totalNtlPos = parseNumber(marginSummary.totalNtlPos);
    const realizedPnl = latestHistoryValue(portfolio.allTime?.pnlHistory);
    const dayPnl = latestHistoryValue(portfolio.day?.pnlHistory);
    const weekPnl = latestHistoryValue(portfolio.week?.pnlHistory);
    const monthPnl = latestHistoryValue(portfolio.month?.pnlHistory);

    let longNotional = 0;
    let shortNotional = 0;
    for (const row of positions) {
      if (row.size > 0) longNotional += Math.abs(row.value);
      else shortNotional += Math.abs(row.value);
    }

    return {
      totalEquity: composition.totalEquity,
      spotValue: composition.spotValue,
      stakedValue: composition.stakedValue,
      perpEquity: composition.perpEquity,
      realizedPnl,
      dayPnl,
      weekPnl,
      monthPnl,
      totalMarginUsed,
      totalNtlPos,
      marginUtilization: composition.perpEquity > 0 ? (totalMarginUsed / composition.perpEquity) * 100 : 0,
      riskRatio: composition.perpEquity > 0 ? totalNtlPos / composition.perpEquity : 0,
      longNotional,
      shortNotional,
      positionsCount: positions.length,
    };
  }

  function renderFollowButton() {
    if (!ui.followWalletButton) return;
    const tracked = state.address ? isFollowing(state.address) : false;
    ui.followWalletButton.textContent = tracked ? "Tracked" : "Add To My Wallets";
    ui.followWalletButton.disabled = !state.address || tracked;
  }

  function renderTrackedWalletShell() {
    if (!(ui.trackedShell instanceof HTMLElement)) return;
    ui.trackedShell.hidden = Boolean(state.address);
  }

  function renderFollowedWallets() {
    if (!ui.followedWalletsList) return;
    ui.followedWalletsList.replaceChildren();
    if (!state.followedWallets.length) {
      const empty = document.createElement("p");
      empty.className = "followed-wallet-empty";
      empty.textContent = "No tracked wallets yet.";
      ui.followedWalletsList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const wallet of state.followedWallets) {
      const chip = document.createElement("div");
      chip.className = "followed-wallet-chip";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "followed-wallet-open";
      openButton.dataset.role = "open";
      openButton.dataset.address = wallet;
      if (state.address && addressKey(wallet) === addressKey(state.address)) {
        openButton.classList.add("active");
      }
      openButton.textContent = formatFollowedWalletLabel(wallet);
      openButton.title = walletLabel(wallet) ? `${walletLabel(wallet)} • ${wallet}` : wallet;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "followed-wallet-remove";
      removeButton.dataset.role = "remove";
      removeButton.dataset.address = wallet;
      removeButton.setAttribute(
        "aria-label",
        `Remove ${formatFollowedWalletLabel(wallet)} from tracked wallets`,
      );
      removeButton.textContent = "×";

      chip.appendChild(openButton);
      chip.appendChild(removeButton);
      fragment.appendChild(chip);
    }

    ui.followedWalletsList.appendChild(fragment);
  }

  function createEmptyRow(colSpan, message) {
    const row = document.createElement("tr");
    row.className = "wallet-empty-row";
    const cell = document.createElement("td");
    cell.colSpan = colSpan;
    cell.textContent = message;
    row.appendChild(cell);
    return row;
  }

  function setTableEmpty(body, colSpan, message) {
    if (!body) return;
    body.replaceChildren(createEmptyRow(colSpan, message));
  }

  function setValueText(element, value, className = "") {
    if (!element) return;
    element.textContent = value;
    element.classList.remove("positive", "negative", "neutral");
    if (className) element.classList.add(className);
  }

  function updateHeader() {
    setText(ui.walletAddressTitle, state.address || "No wallet loaded");
    if (ui.addressInput) {
      ui.addressInput.value = state.address || "";
    }

    const qwantifyHref = state.address
      ? `https://www.qwantify.io/app/wallets/${state.address}`
      : "https://www.qwantify.io/app/wallets/";
    if (ui.openQwantifyLink instanceof HTMLAnchorElement) {
      ui.openQwantifyLink.href = qwantifyHref;
    }

    const hasDashboard = Boolean(getDashboardData());
    const hasHoldings = Boolean(getHoldingsData());
    const metrics = getSummaryMetrics();
    const updatedAt = state.dashboardPayload?.updatedAt;
    const holdings = getHoldingRows().filter((row) => row.kind !== "delegated");
    const qwantifyState = state.notionalLoading
      ? "Qwantify loading"
      : state.notionalError
        ? "Qwantify unavailable"
        : state.notionalPayload?.resolved === false
          ? "Qwantify pending"
          : state.notionalPayload
            ? "Qwantify linked"
            : "Qwantify —";

    if (!state.address) {
      setText(
        ui.walletSummaryCaption,
        "Account overview powered by Hyperliquid portfolio, positions, spot balances, and Qwantify deltas.",
      );
      return;
    }

    if (!hasDashboard) {
      if (state.dashboardLoading) {
        setText(ui.walletSummaryCaption, "Loading portfolio, positions, holdings, and chart data…");
        return;
      }
      if (state.dashboardError) {
        setText(ui.walletSummaryCaption, "Wallet overview is unavailable right now.");
        return;
      }
      setText(
        ui.walletSummaryCaption,
        "Account overview powered by Hyperliquid portfolio, positions, spot balances, and Qwantify deltas.",
      );
      return;
    }

    const holdingsLabel = hasHoldings
      ? `${holdings.length} spot assets`
      : state.holdingsLoading
        ? "loading spot assets"
        : state.holdingsError
          ? "spot assets unavailable"
          : "spot assets pending";

    setText(
      ui.walletSummaryCaption,
      `Updated ${formatDateTime(updatedAt)} • ${metrics.positionsCount} open positions • ${holdingsLabel} • ${qwantifyState}`,
    );
  }

  function renderOverview() {
    const hasOverviewData = Boolean(getDashboardData()) && Boolean(getHoldingsData());
    if (!hasOverviewData) {
      setText(ui.metricTotalEquity, "—");
      if (ui.metricTotalEquityBar) {
        ui.metricTotalEquityBar.style.width = "0%";
        ui.metricTotalEquityBar.style.background = "";
      }
      setText(ui.metricTotalEquitySubtext, "Spot — • Perps — • Staked —");
      setValueText(ui.metricRealizedPnl, "—");
      setValueText(ui.metricRealizedPnlDay, "—");
      setValueText(ui.metricRealizedPnlWeek, "—");
      setText(ui.metricMarginUtilization, "—");
      if (ui.metricMarginUtilizationBar) ui.metricMarginUtilizationBar.style.width = "0%";
      setText(ui.metricMarginUtilizationSubtext, "Used — / Perp equity —");
      setText(ui.metricRiskProfile, "—");
      if (ui.metricRiskLongBar) ui.metricRiskLongBar.style.width = "0%";
      if (ui.metricRiskShortBar) ui.metricRiskShortBar.style.width = "0%";
      setText(ui.metricRiskProfileSubtext, "Long — • Short —");
      return;
    }

    const metrics = getSummaryMetrics();
    const totalEquity = metrics.totalEquity;
    const spotShare = totalEquity > 0 ? (metrics.spotValue / totalEquity) * 100 : 0;
    const perpShare = totalEquity > 0 ? (metrics.perpEquity / totalEquity) * 100 : 0;
    const stakedShare = totalEquity > 0 ? (metrics.stakedValue / totalEquity) * 100 : 0;
    const totalShare = spotShare + perpShare + stakedShare;
    const spotStop = clamp(spotShare, 0, 100);
    const perpStop = clamp(spotShare + perpShare, 0, 100);
    const stakedStop = clamp(totalShare, 0, 100);

    setText(ui.metricTotalEquity, totalEquity ? formatUsd(totalEquity, { compact: false }) : "—");
    if (ui.metricTotalEquityBar) {
      ui.metricTotalEquityBar.style.width = totalEquity ? "100%" : "0%";
      ui.metricTotalEquityBar.style.background = totalEquity
        ? `linear-gradient(90deg,
            #25d391 0% ${spotStop}%,
            #ff7a1a ${spotStop}% ${perpStop}%,
            #9774ff ${perpStop}% ${stakedStop}%,
            rgba(255,255,255,0.08) ${stakedStop}% 100%)`
        : "";
    }
    setText(
      ui.metricTotalEquitySubtext,
      `Spot ${formatPercent(spotShare)} • Perps ${formatPercent(perpShare)} • Staked ${formatPercent(stakedShare)}`,
    );

    setValueText(
      ui.metricRealizedPnl,
      state.address ? formatSignedUsd(metrics.realizedPnl, { compact: false }) : "—",
      getToneClass(metrics.realizedPnl),
    );
    setValueText(
      ui.metricRealizedPnlDay,
      state.address ? formatSignedUsd(metrics.dayPnl) : "—",
      getToneClass(metrics.dayPnl),
    );
    setValueText(
      ui.metricRealizedPnlWeek,
      state.address ? formatSignedUsd(metrics.weekPnl) : "—",
      getToneClass(metrics.weekPnl),
    );

    setText(
      ui.metricMarginUtilization,
      state.address ? formatPercent(metrics.marginUtilization, 1) : "—",
    );
    if (ui.metricMarginUtilizationBar) {
      ui.metricMarginUtilizationBar.style.width = `${clamp(metrics.marginUtilization, 0, 100)}%`;
    }
    setText(
      ui.metricMarginUtilizationSubtext,
      `Used ${formatUsd(metrics.totalMarginUsed)} / Perp equity ${formatUsd(metrics.perpEquity)}`,
    );

    setText(
      ui.metricRiskProfile,
      state.address ? `${metrics.riskRatio.toFixed(2)}x` : "—",
    );
    const totalDirectionalNotional = metrics.longNotional + metrics.shortNotional;
    const longShare = totalDirectionalNotional > 0 ? (metrics.longNotional / totalDirectionalNotional) * 100 : 0;
    const shortShare =
      totalDirectionalNotional > 0 ? (metrics.shortNotional / totalDirectionalNotional) * 100 : 0;
    if (ui.metricRiskLongBar) ui.metricRiskLongBar.style.width = `${clamp(longShare, 0, 100)}%`;
    if (ui.metricRiskShortBar) ui.metricRiskShortBar.style.width = `${clamp(shortShare, 0, 100)}%`;
    setText(
      ui.metricRiskProfileSubtext,
      `Long ${formatPercent(longShare)} (${formatUsd(metrics.longNotional)}) • Short ${formatPercent(shortShare)} (${formatUsd(metrics.shortNotional)})`,
    );
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function svgNode(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs ?? {})) {
      node.setAttribute(key, String(value));
    }
    return node;
  }

  function renderPerformanceChart() {
    if (!(ui.performanceChart instanceof SVGSVGElement)) return;

    clearSvg(ui.performanceChart);
    const portfolio = getPortfolio();
    const bucketKey = portfolioBucketKey(state.chartScope, state.chartWindow);
    const bucket = portfolio[bucketKey] ?? null;
    const points = parseHistory(
      state.chartType === "accountValue" ? bucket?.accountValueHistory : bucket?.pnlHistory,
    );

    if (!points.length || !bucket) {
      if (ui.performanceEmpty) {
        ui.performanceEmpty.textContent = !state.address
          ? "Load a wallet to see performance."
          : state.dashboardLoading
            ? "Loading performance…"
            : state.dashboardError
              ? "Wallet overview is unavailable."
              : "No performance history available for this wallet yet.";
        ui.performanceEmpty.hidden = false;
      }
      return;
    }

    if (ui.performanceEmpty) ui.performanceEmpty.hidden = true;

    const width = 1200;
    const height = 420;
    const margin = { top: 18, right: 94, bottom: 52, left: 92 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const values = points.map((point) => point.value);
    const includeZero = state.chartType === "pnl";
    let minValue = Math.min(...values, includeZero ? 0 : values[0]);
    let maxValue = Math.max(...values, includeZero ? 0 : values[0]);
    const span = maxValue - minValue;
    const padding = span > 0 ? span * 0.12 : Math.max(Math.abs(maxValue) * 0.12, 1);
    minValue -= padding;
    maxValue += padding;

    const xScale = (time) => {
      const range = points[points.length - 1].time - points[0].time || 1;
      return margin.left + ((time - points[0].time) / range) * innerWidth;
    };
    const yScale = (value) => {
      const range = maxValue - minValue || 1;
      return margin.top + ((maxValue - value) / range) * innerHeight;
    };

    const firstValue = points[0].value;
    const lastValue = points[points.length - 1].value;
    const tone =
      state.chartType === "pnl"
        ? lastValue >= 0
          ? "positive"
          : "negative"
        : lastValue >= firstValue
          ? "positive"
          : "negative";
    const lineColor = tone === "positive" ? "#25d391" : "#ff4d6d";
    const areaColor = tone === "positive" ? "rgba(37,211,145,0.16)" : "rgba(255,77,109,0.18)";
    const zeroY = yScale(0);
    const baselineY = includeZero && minValue <= 0 && maxValue >= 0 ? zeroY : margin.top + innerHeight;

    const grid = svgNode("g");
    const label = svgNode("g");

    const yTicks = 5;
    for (let index = 0; index < yTicks; index += 1) {
      const ratio = index / (yTicks - 1);
      const value = maxValue - ratio * (maxValue - minValue);
      const y = margin.top + ratio * innerHeight;
      grid.appendChild(
        svgNode("line", {
          x1: margin.left,
          y1: y,
          x2: width - margin.right,
          y2: y,
          stroke: "rgba(255,255,255,0.08)",
          "stroke-dasharray": "4 10",
        }),
      );
      const yLabel = svgNode("text", {
        x: margin.left - 18,
        y: y + 5,
        fill: "rgba(231,237,244,0.68)",
        "font-size": "13",
        "font-family": "Geist Mono, ui-monospace, monospace",
        "text-anchor": "end",
      });
      yLabel.textContent = formatUsd(value, { compact: true, maximumFractionDigits: 1 });
      label.appendChild(yLabel);
    }

    if (includeZero && minValue <= 0 && maxValue >= 0) {
      grid.appendChild(
        svgNode("line", {
          x1: margin.left,
          y1: zeroY,
          x2: width - margin.right,
          y2: zeroY,
          stroke: tone === "positive" ? "rgba(37,211,145,0.25)" : "rgba(255,77,109,0.28)",
          "stroke-dasharray": "3 8",
        }),
      );
    }

    const xTicks = Math.min(6, points.length);
    for (let index = 0; index < xTicks; index += 1) {
      const pointIndex = Math.round((index / Math.max(1, xTicks - 1)) * (points.length - 1));
      const point = points[pointIndex];
      const x = xScale(point.time);
      const xLabel = svgNode("text", {
        x,
        y: height - 16,
        fill: "rgba(231,237,244,0.68)",
        "font-size": "13",
        "font-family": "Geist Mono, ui-monospace, monospace",
        "text-anchor": index === 0 ? "start" : index === xTicks - 1 ? "end" : "middle",
      });
      xLabel.textContent = formatChartTickTime(point.time);
      label.appendChild(xLabel);
    }

    const linePath = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${xScale(point.time)} ${yScale(point.value)}`)
      .join(" ");

    const areaPath = `${linePath} L ${xScale(points[points.length - 1].time)} ${baselineY} L ${xScale(
      points[0].time,
    )} ${baselineY} Z`;

    ui.performanceChart.appendChild(grid);
    ui.performanceChart.appendChild(
      svgNode("path", {
        d: areaPath,
        fill: areaColor,
      }),
    );
    ui.performanceChart.appendChild(
      svgNode("path", {
        d: linePath,
        fill: "none",
        stroke: lineColor,
        "stroke-width": 4,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      }),
    );
    ui.performanceChart.appendChild(
      svgNode("circle", {
        cx: xScale(points[points.length - 1].time),
        cy: yScale(points[points.length - 1].value),
        r: 5,
        fill: lineColor,
      }),
    );
    ui.performanceChart.appendChild(label);
  }

  function renderComposition() {
    if (!ui.compositionDonut || !ui.compositionLegend) return;
    const hasCompositionData = Boolean(getDashboardData()) && Boolean(getHoldingsData());
    if (!hasCompositionData) {
      setText(ui.compositionTotal, "—");
      ui.compositionDonut.classList.add("empty");
      ui.compositionDonut.style.background =
        "radial-gradient(circle at center, rgba(255,255,255,0.02) 0 45%, rgba(255,255,255,0.08) 46% 47%, transparent 48% 100%)";
      ui.compositionLegend.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "wallet-composition-empty";
      empty.textContent = !state.address
        ? "Load a wallet to see allocation."
        : state.dashboardLoading || state.holdingsLoading
          ? "Loading allocation…"
          : "Wallet overview is unavailable.";
      ui.compositionLegend.appendChild(empty);
      return;
    }

    const metrics = getSummaryMetrics();
    const parts = [
      { key: "spot", label: "Spot", value: metrics.spotValue, color: "#25d391" },
      { key: "staked", label: "Staked", value: metrics.stakedValue, color: "#9774ff" },
      { key: "perps", label: "Perps", value: metrics.perpEquity, color: "#ff7a1a" },
    ].filter((part) => part.value > 0);

    const total = parts.reduce((sum, part) => sum + part.value, 0);
    setText(ui.compositionTotal, total ? formatUsd(total, { compact: false }) : "—");

    if (!parts.length || total <= 0) {
      ui.compositionDonut.classList.add("empty");
      ui.compositionDonut.style.background =
        "radial-gradient(circle at center, rgba(255,255,255,0.02) 0 45%, rgba(255,255,255,0.08) 46% 47%, transparent 48% 100%)";
      ui.compositionLegend.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "wallet-composition-empty";
      empty.textContent = state.address
        ? "No composition data available."
        : "Load a wallet to see allocation.";
      ui.compositionLegend.appendChild(empty);
      return;
    }

    ui.compositionDonut.classList.remove("empty");
    let cursor = 0;
    const segments = parts.map((part) => {
      const start = cursor;
      cursor += (part.value / total) * 100;
      return `${part.color} ${start}% ${cursor}%`;
    });
    ui.compositionDonut.style.background = `conic-gradient(${segments.join(", ")})`;

    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      const share = (part.value / total) * 100;
      const item = document.createElement("div");
      item.className = "wallet-composition-item";

      const head = document.createElement("div");
      head.className = "wallet-composition-item-head";

      const dot = document.createElement("span");
      dot.className = "wallet-composition-dot";
      dot.style.background = part.color;

      const label = document.createElement("span");
      label.textContent = part.label;

      head.append(dot, label);

      const value = document.createElement("strong");
      value.textContent = formatUsd(part.value, { compact: false });

      const shareLabel = document.createElement("span");
      shareLabel.className = "wallet-composition-share";
      shareLabel.textContent = formatPercent(share);

      item.append(head, value, shareLabel);
      fragment.appendChild(item);
    }

    ui.compositionLegend.replaceChildren(fragment);
  }

  function renderPositions() {
    const hasDashboard = Boolean(getDashboardData());
    if (!hasDashboard) {
      setText(ui.positionsLongTotal, "—");
      setText(ui.positionsShortTotal, "—");
      setText(ui.positionsEquityTotal, "—");
      setText(ui.positionsNotionalTotal, "—");
      setTableEmpty(
        ui.positionsBody,
        9,
        !state.address
          ? "Load a wallet to see current positions."
          : state.dashboardLoading
            ? "Loading positions…"
            : "Wallet overview data is unavailable.",
      );
      return;
    }

    const rows = getPositionRows();
    const metrics = getSummaryMetrics();
    setText(ui.positionsLongTotal, formatUsd(metrics.longNotional, { compact: false }));
    setText(ui.positionsShortTotal, formatUsd(metrics.shortNotional, { compact: false }));
    setText(ui.positionsEquityTotal, formatUsd(metrics.perpEquity, { compact: false }));
    setText(
      ui.positionsNotionalTotal,
      formatUsd(metrics.longNotional + metrics.shortNotional, { compact: false }),
    );

    if (!ui.positionsBody) return;
    if (!rows.length) {
      setTableEmpty(ui.positionsBody, 9, state.address ? "No open perp positions." : "Load a wallet to see current positions.");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.append(
        makeTextCell(row.symbol, "wallet-symbol"),
        makeTextCell(formatNumber(row.size, 2), "mono"),
        makeTextCell(formatUsd(row.entry, { compact: false, maximumFractionDigits: 4 }), "mono"),
        makeTextCell(formatUsd(row.mark, { compact: false, maximumFractionDigits: 4 }), "mono"),
        makeTextCell(formatUsd(row.value, { compact: false }), "mono"),
        makeTextCell(formatSignedUsd(row.unrealizedPnl, { compact: false }), `mono ${getToneClass(row.unrealizedPnl)}`),
        makeTextCell(formatSignedPercent(row.roe, 2), `mono ${getToneClass(row.roe)}`),
        makeTextCell(formatSignedUsd(row.funding, { compact: false }), `mono ${getToneClass(row.funding)}`),
        makeTextCell(row.liqPrice > 0 ? formatUsd(row.liqPrice, { compact: false, maximumFractionDigits: 4 }) : "—", "mono"),
      );
      fragment.appendChild(tr);
    }
    ui.positionsBody.replaceChildren(fragment);
  }

  function renderHoldings() {
    if (!ui.holdingsBody) return;
    const hasHoldings = Boolean(getHoldingsData());
    if (!hasHoldings) {
      setTableEmpty(
        ui.holdingsBody,
        6,
        !state.address
          ? "Load a wallet to see spot and staked holdings."
          : state.holdingsLoading
            ? "Loading holdings…"
            : "Holdings are unavailable right now.",
      );
      return;
    }

    const rows = getHoldingRows();
    if (!rows.length) {
      setTableEmpty(
        ui.holdingsBody,
        6,
        state.address ? "No spot or staked balances for this wallet." : "Load a wallet to see spot and staked holdings.",
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.append(
        makeTextCell(row.coin, "wallet-symbol"),
        makeTextCell(formatNumber(row.total, 6), "mono"),
        makeTextCell(formatNumber(row.available, 6), "mono"),
        makeTextCell(formatUsd(row.value, { compact: false }), "mono"),
        makeTextCell(row.avgEntry > 0 ? formatUsd(row.avgEntry, { compact: false, maximumFractionDigits: 4 }) : "—", "mono"),
        makeTextCell(
          row.avgEntry > 0 ? formatSignedUsd(row.unrealized, { compact: false }) : "—",
          `mono ${getToneClass(row.unrealized)}`,
        ),
      );
      fragment.appendChild(tr);
    }
    ui.holdingsBody.replaceChildren(fragment);
  }

  function renderFills() {
    if (!ui.fillsBody) return;
    if (!state.address) {
      setTableEmpty(ui.fillsBody, 7, "Load a wallet to see recent fills.");
      return;
    }
    if (state.fillsLoading) {
      setTableEmpty(ui.fillsBody, 7, "Loading recent fills…");
      return;
    }
    if (state.fillsError) {
      setTableEmpty(ui.fillsBody, 7, "Recent fills are unavailable right now.");
      return;
    }

    const items = Array.isArray(state.fillsPayload?.items) ? state.fillsPayload.items.slice(0, 80) : [];
    if (!items.length) {
      setTableEmpty(
        ui.fillsBody,
        7,
        "No recent fills in the selected lookback window.",
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const fill of items) {
      const sideLabel = String(fill?.dir || fill?.side || "—");
      const pnl = parseNumber(fill?.closedPnl);
      const fee = parseNumber(fill?.fee) * -1;
      const tr = document.createElement("tr");
      tr.append(
        makeTextCell(formatDateTime(fill?.time), "mono"),
        makeTextCell(normalizeSymbol(fill?.coin), "wallet-symbol"),
        makeTextCell(sideLabel, `mono ${/buy|long/i.test(sideLabel) ? "positive" : /sell|short/i.test(sideLabel) ? "negative" : ""}`),
        makeTextCell(formatNumber(fill?.sz, 4), "mono"),
        makeTextCell(formatUsd(fill?.px, { compact: false, maximumFractionDigits: 4 }), "mono"),
        makeTextCell(formatSignedUsd(pnl, { compact: false }), `mono ${getToneClass(pnl)}`),
        makeTextCell(formatSignedUsd(fee, { compact: false, maximumFractionDigits: 4 }), "mono negative"),
      );
      fragment.appendChild(tr);
    }
    ui.fillsBody.replaceChildren(fragment);
  }

  function renderNotional() {
    if (!ui.notionalBody) return;
    const payload = state.notionalPayload;
    if (!state.address) {
      setTableEmpty(ui.notionalBody, 6, "Load a wallet to see Qwantify net notional deltas.");
      return;
    }

    if (state.notionalLoading) {
      setTableEmpty(ui.notionalBody, 6, "Loading Qwantify deltas…");
      return;
    }

    if (state.notionalError) {
      setTableEmpty(ui.notionalBody, 6, "Qwantify deltas are unavailable right now.");
      return;
    }

    if (payload?.resolved === false) {
      setTableEmpty(ui.notionalBody, 6, payload?.message || "This wallet is not indexed in Qwantify yet.");
      return;
    }

    const deltas = Array.isArray(payload?.deltas) ? payload.deltas : [];
    if (!deltas.length) {
      setTableEmpty(ui.notionalBody, 6, "No notional delta rows were returned for this wallet.");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of deltas) {
      const tr = document.createElement("tr");
      tr.appendChild(makeTextCell(String(entry?.symbol ?? "—"), "wallet-symbol"));
      for (const windowKey of NOTIONAL_WINDOWS) {
        const value = parseNumber(entry?.deltas?.[windowKey]);
        tr.appendChild(
          makeTextCell(formatSignedUsd(value, { compact: false }), `mono ${getToneClass(value)}`),
        );
      }
      fragment.appendChild(tr);
    }
    ui.notionalBody.replaceChildren(fragment);
  }

  function renderStatistics() {
    const hasDashboard = Boolean(getDashboardData());
    const hasHoldings = Boolean(getHoldingsData());
    const metrics = getSummaryMetrics();
    const holdings = getHoldingRows();
    setValueText(
      ui.statAllTimePnl,
      hasDashboard ? formatSignedUsd(metrics.realizedPnl, { compact: false }) : "—",
      hasDashboard ? getToneClass(metrics.realizedPnl) : "",
    );
    setValueText(
      ui.statMonthPnl,
      hasDashboard ? formatSignedUsd(metrics.monthPnl, { compact: false }) : "—",
      hasDashboard ? getToneClass(metrics.monthPnl) : "",
    );
    setText(
      ui.statRecentFills,
      !state.address
        ? "—"
        : state.fillsLoading
          ? "Loading"
          : state.fillsError
            ? "—"
            : String((state.fillsPayload?.items ?? []).length),
    );
    setText(ui.statOpenPositions, hasDashboard ? String(metrics.positionsCount) : "—");
    setText(
      ui.statSpotAssets,
      !state.address
        ? "—"
        : state.holdingsLoading
          ? "Loading"
          : hasHoldings
            ? String(holdings.filter((row) => row.kind !== "delegated").length)
            : "—",
    );
    setText(ui.statTrackedWallets, String(state.followedWallets.length));
  }

  function renderAll() {
    updateHeader();
    renderFollowButton();
    renderTrackedWalletShell();
    renderFollowedWallets();
    renderOverview();
    renderPerformanceChart();
    renderComposition();
    renderPositions();
    renderFills();
    renderHoldings();
    renderNotional();
    renderStatistics();
    syncToggleGroups();
    syncTabs();
  }

  function makeTextCell(text, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className.trim();
    cell.textContent = text;
    return cell;
  }

  function syncToggleGroup(container, attribute, activeValue) {
    if (!(container instanceof HTMLElement)) return;
    const buttons = Array.from(container.querySelectorAll("button"));
    for (const button of buttons) {
      button.classList.toggle("active", button.dataset[attribute] === activeValue);
    }
  }

  function syncToggleGroups() {
    syncToggleGroup(ui.chartTypeToggle, "chartType", state.chartType);
    syncToggleGroup(ui.chartScopeToggle, "chartScope", state.chartScope);
    syncToggleGroup(ui.chartWindowToggle, "chartWindow", state.chartWindow);
  }

  function syncTabs() {
    for (const button of ui.tabButtons) {
      button.classList.toggle("active", button.dataset.tab === state.activeTab);
    }
    for (const panel of ui.tabPanels) {
      panel.classList.toggle("active", panel.dataset.tabPanel === state.activeTab);
    }
  }

  function resetDashboardState() {
    state.dashboardPayload = null;
    state.holdingsPayload = null;
    state.fillsPayload = null;
    state.notionalPayload = null;
    state.dashboardLoading = false;
    state.holdingsLoading = false;
    state.fillsLoading = false;
    state.notionalLoading = false;
    state.dashboardError = null;
    state.holdingsError = null;
    state.fillsError = null;
    state.notionalError = null;
    renderAll();
  }

  function setLoadingState() {
    state.dashboardPayload = null;
    state.holdingsPayload = null;
    state.fillsPayload = null;
    state.notionalPayload = null;
    state.dashboardLoading = true;
    state.holdingsLoading = true;
    state.fillsLoading = true;
    state.notionalLoading = true;
    state.dashboardError = null;
    state.holdingsError = null;
    state.fillsError = null;
    state.notionalError = null;
    renderAll();
  }

  function updateLoadStatus() {
    if (!state.address) {
      setStatus("Enter a wallet address or open a `/wallets/0x...` route.", "neutral");
      return;
    }

    if (state.dashboardLoading) {
      setStatus("Loading wallet overview…", "neutral");
      return;
    }

    if (state.dashboardError) {
      setStatus("Wallet overview could not be loaded.", "error");
      setAddressError(state.dashboardError);
      return;
    }

    const pending = [];
    if (state.holdingsLoading) pending.push("holdings");
    if (state.fillsLoading) pending.push("fills");
    if (state.notionalLoading) pending.push("qwantify deltas");

    const partialFailures = [];
    if (state.holdingsError) partialFailures.push("holdings unavailable");
    if (state.fillsError) partialFailures.push("fills unavailable");
    if (state.notionalError) partialFailures.push("qwantify deltas unavailable");

    setAddressError("");

    if (pending.length) {
      let message = `Wallet overview loaded. Fetching ${pending.join(" and ")}…`;
      if (partialFailures.length) {
        message += ` ${partialFailures.join(", ")}.`;
      }
      setStatus(message, partialFailures.length ? "warning" : "neutral");
      return;
    }

    if (partialFailures.length) {
      setStatus(`Wallet loaded with partial data: ${partialFailures.join(", ")}.`, "warning");
      return;
    }

    setStatus("Wallet loaded.", "success");
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload && typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
      throw new Error(message);
    }
    return payload;
  }

  function withRefresh(url, refresh) {
    if (!refresh) return url;
    const next = new URL(url, location.origin);
    next.searchParams.set("refresh", "1");
    return next.toString();
  }

  async function fetchDashboard(address, refresh) {
    return fetchJson(withRefresh(`/api/wallet-dashboard/${encodeURIComponent(address)}`, refresh));
  }

  async function fetchHoldings(address, refresh) {
    return fetchJson(withRefresh(`/api/wallet-holdings/${encodeURIComponent(address)}`, refresh));
  }

  async function fetchFills(address, refresh) {
    return fetchJson(
      withRefresh(`/api/userFills/${encodeURIComponent(address)}?days=30&includeTwaps=0`, refresh),
    );
  }

  async function fetchNotional(address, refresh) {
    return fetchJson(
      withRefresh(`/api/qwantify/wallet-notional-deltas/${encodeURIComponent(address)}`, refresh),
    );
  }

  async function loadWallet(rawAddress, options = {}) {
    const normalized = normalizeAddress(rawAddress);
    if (!normalized) {
      state.loadId += 1;
      state.address = null;
      setAddressError("Enter a valid EVM wallet address.");
      setStatus("Waiting for a valid wallet address.", "warning");
      setButtonsDisabled(false);
      resetDashboardState();
      updateHistory(null, false);
      return;
    }

    const requestId = ++state.loadId;
    state.address = normalized;
    if (ui.addressInput) ui.addressInput.value = normalized;
    if (!options.skipHistory) updateHistory(normalized, false);
    setAddressError("");
    setButtonsDisabled(true);
    renderFollowButton();
    setLoadingState();
    updateLoadStatus();

    const refresh = Boolean(options.refresh);

    fetchDashboard(normalized, refresh)
      .then((payload) => {
        if (requestId !== state.loadId) return;
        state.dashboardPayload = payload;
        state.dashboardLoading = false;
        state.dashboardError = null;
        renderAll();
        updateLoadStatus();
        updateHistory(normalized, true);
        setButtonsDisabled(false);
      })
      .catch((error) => {
        if (requestId !== state.loadId) return;
        state.dashboardPayload = null;
        state.dashboardLoading = false;
        state.dashboardError = error?.message || "Failed to load wallet overview.";
        renderAll();
        updateLoadStatus();
        setButtonsDisabled(false);
      });

    fetchHoldings(normalized, refresh)
      .then((payload) => {
        if (requestId !== state.loadId) return;
        state.holdingsPayload = payload;
        state.holdingsLoading = false;
        state.holdingsError = null;
        renderAll();
        updateLoadStatus();
      })
      .catch((error) => {
        if (requestId !== state.loadId) return;
        state.holdingsPayload = null;
        state.holdingsLoading = false;
        state.holdingsError = error?.message || "Holdings are unavailable.";
        renderAll();
        updateLoadStatus();
      });

    fetchFills(normalized, refresh)
      .then((payload) => {
        if (requestId !== state.loadId) return;
        state.fillsPayload = payload;
        state.fillsLoading = false;
        state.fillsError = null;
        renderAll();
        updateLoadStatus();
      })
      .catch((error) => {
        if (requestId !== state.loadId) return;
        state.fillsPayload = null;
        state.fillsLoading = false;
        state.fillsError = error?.message || "Recent fills are unavailable.";
        renderAll();
        updateLoadStatus();
      });

    fetchNotional(normalized, refresh)
      .then((payload) => {
        if (requestId !== state.loadId) return;
        state.notionalPayload = payload;
        state.notionalLoading = false;
        state.notionalError = null;
        renderAll();
        updateLoadStatus();
      })
      .catch((error) => {
        if (requestId !== state.loadId) return;
        state.notionalPayload = null;
        state.notionalLoading = false;
        state.notionalError = error?.message || "Qwantify deltas are unavailable.";
        renderAll();
        updateLoadStatus();
      });
  }

  function handleCopyAddress() {
    if (!state.address) return;
    const fallback = () => {
      const previous = ui.copyAddressButton?.textContent || "Copy";
      if (ui.copyAddressButton) ui.copyAddressButton.textContent = "Copied";
      window.setTimeout(() => {
        if (ui.copyAddressButton) ui.copyAddressButton.textContent = previous;
      }, 1200);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(state.address).then(fallback).catch(fallback);
    } else {
      fallback();
    }
  }

  function bindEvents() {
    ui.lookupButton?.addEventListener("click", () => {
      loadWallet(ui.addressInput?.value || "", { skipHistory: false });
    });

    ui.refreshButton?.addEventListener("click", () => {
      if (!state.address) {
        setAddressError("Enter a valid wallet address first.");
        return;
      }
      loadWallet(state.address, { refresh: true, skipHistory: true });
    });

    ui.followWalletButton?.addEventListener("click", () => {
      const candidate = state.address || ui.addressInput?.value || "";
      if (!addFollowedWallet(candidate)) {
        setAddressError("Enter a valid wallet address first.");
        return;
      }
      setAddressError("");
      setStatus("Wallet added to tracked wallets.", "success");
    });

    ui.copyAddressButton?.addEventListener("click", handleCopyAddress);

    ui.addressInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      loadWallet(ui.addressInput?.value || "", { skipHistory: false });
    });

    ui.followedWalletsList?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement)) return;
      const address = button.dataset.address;
      if (!address) return;

      if (button.dataset.role === "remove") {
        removeFollowedWallet(address);
        return;
      }

      if (button.dataset.role === "open") {
        loadWallet(address, { skipHistory: false });
      }
    });

    ui.tabbar?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("button[data-tab]");
      if (!(button instanceof HTMLButtonElement)) return;
      state.activeTab = button.dataset.tab || DEFAULT_TAB;
      syncTabs();
    });

    bindToggleContainer(ui.chartTypeToggle, "chartType", (value) => {
      state.chartType = value === "accountValue" ? "accountValue" : "pnl";
      renderPerformanceChart();
      syncToggleGroups();
    });
    bindToggleContainer(ui.chartScopeToggle, "chartScope", (value) => {
      state.chartScope = value === "perp" ? "perp" : "total";
      renderPerformanceChart();
      syncToggleGroups();
    });
    bindToggleContainer(ui.chartWindowToggle, "chartWindow", (value) => {
      state.chartWindow = CHART_WINDOW_LABELS[value] ? value : DEFAULT_CHART_WINDOW;
      renderPerformanceChart();
      syncToggleGroups();
    });

    const handlePopState = () => {
      const nextAddress = readAddressFromPath();
      if (nextAddress) {
        loadWallet(nextAddress, { skipHistory: true });
        return;
      }
      state.address = null;
      setAddressError("");
      setStatus("Enter a wallet address or open a `/wallets/0x...` route.", "neutral");
      resetDashboardState();
      renderFollowButton();
      updateHeader();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }

  function bindToggleContainer(container, dataKey, onChange) {
    if (!(container instanceof HTMLElement)) return;
    container.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement)) return;
      const value = button.dataset[dataKey];
      if (!value) return;
      onChange(value);
    });
  }

  const cleanupEvents = bindEvents();
  state.followedWallets = loadFollowedWallets();
  saveFollowedWallets();
  renderAll();
  setStatus("Enter a wallet address or open a `/wallets/0x...` route.", "neutral");

  const initialAddress = readAddressFromPath();
  if (initialAddress) {
    loadWallet(initialAddress, { skipHistory: true });
  }

  return () => {
    cleanupEvents?.();
    state.loadId += 1;
  };
}
