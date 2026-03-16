export function mountMarketFlowPage() {
  const PARTICIPANT_WINDOWS = ["1h", "4h", "24h", "7d", "30d"];
  const CHART_WINDOWS = ["24h", "7d", "30d"];
  const LIMIT_OPTIONS = [10, 25, 50, 100];
  const CHART_MODES = ["interval", "cumulative"];
  const DELTA_WINDOWS = ["1h", "4h", "24h", "7d", "30d"];
  const HERO_LABELS = {
    "1h": "Net Delta 1H",
    "4h": "Net Delta 4H",
    "24h": "Net Delta 1D",
    "7d": "Net Delta 7D",
    "30d": "Net Delta 30D",
  };
  const ASSETS = [
    {
      id: "HYPE",
      label: "HYPE",
      markets: [
        { id: "HYPE-PERP", label: "HYPE Perp" },
        { id: "HYPE-SPOT", label: "HYPE Spot" },
      ],
    },
    {
      id: "LIT",
      label: "LIT",
      markets: [{ id: "LIT-PERP", label: "LIT" }],
    },
    {
      id: "XYZ100",
      label: "XYZ100",
      markets: [{ id: "XYZ100-PERP", label: "XYZ100" }],
    },
    {
      id: "US500",
      label: "US500",
      markets: [{ id: "US500-PERP", label: "US500" }],
    },
    {
      id: "USTECH",
      label: "USTECH",
      markets: [{ id: "USTECH-PERP", label: "USTECH" }],
    },
  ];
  const MARKET_MAP = new Map(
    ASSETS.flatMap((asset) => asset.markets.map((market) => [market.id, { asset, market }])),
  );
  const DEFAULT_STATE = Object.freeze({
    marketId: "HYPE-PERP",
    chartWindow: "7d",
    participantsWindow: "24h",
    limit: 25,
    view: "net",
    chartMode: "interval",
  });

  const ui = {
    assetToggle: document.getElementById("asset-toggle"),
    marketToggleWrap: document.getElementById("market-toggle-wrap"),
    marketToggle: document.getElementById("market-toggle"),
    heroDeltas: document.getElementById("hero-deltas"),
    chartTitle: document.getElementById("chart-title"),
    chartSubtitle: document.getElementById("chart-subtitle"),
    chartModeToggle: document.getElementById("chart-mode-toggle"),
    chartWindowToggle: document.getElementById("chart-window-toggle"),
    chartSvg: document.getElementById("market-flow-chart"),
    chartEmpty: document.getElementById("chart-empty"),
    chartStatus: document.getElementById("chart-status"),
    windowToggle: document.getElementById("window-toggle"),
    limitToggle: document.getElementById("limit-toggle"),
    tabNet: document.getElementById("tab-net"),
    tabTotal: document.getElementById("tab-total"),
    marketId: document.getElementById("market-id"),
    marketUpdated: document.getElementById("market-updated"),
    marketWindow: document.getElementById("market-window"),
    marketFlowDescription: document.getElementById("market-flow-description"),
    marketFlowRefresh: document.getElementById("market-flow-refresh"),
    marketFlowStatus: document.getElementById("market-flow-status"),
    marketFlowGrid: document.getElementById("market-flow-grid"),
    buyersCard: document.getElementById("buyers-card"),
    sellersCard: document.getElementById("sellers-card"),
    buyersTitle: document.getElementById("buyers-title"),
    sellersTitle: document.getElementById("sellers-title"),
    buyersList: document.getElementById("buyers-list"),
    sellersList: document.getElementById("sellers-list"),
  };

  const state = {
    marketId: DEFAULT_STATE.marketId,
    chartWindow: DEFAULT_STATE.chartWindow,
    participantsWindow: DEFAULT_STATE.participantsWindow,
    limit: DEFAULT_STATE.limit,
    view: DEFAULT_STATE.view,
    chartMode: DEFAULT_STATE.chartMode,
    loading: false,
    payload: null,
    candles: null,
  };

  function setText(element, value) {
    if (element) element.textContent = value ?? "";
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getCurrentSelection() {
    return MARKET_MAP.get(state.marketId) || MARKET_MAP.get(DEFAULT_STATE.marketId);
  }

  function getCurrentAsset() {
    return getCurrentSelection()?.asset || ASSETS[0];
  }

  function getCurrentMarket() {
    return getCurrentSelection()?.market || ASSETS[0].markets[0];
  }

  function formatWindowLabel(value) {
    return String(value || "").toUpperCase();
  }

  function formatDeltaLabel(windowKey) {
    return HERO_LABELS[windowKey] || `Net Delta ${formatWindowLabel(windowKey)}`;
  }

  function formatMoney(value, opts) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: opts?.minimumFractionDigits ?? 2,
      maximumFractionDigits: opts?.maximumFractionDigits ?? 2,
    }).format(amount);
  }

  function formatSignedMoney(value, opts) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    if (amount === 0) return formatMoney(0, opts);
    return `${amount > 0 ? "+" : "-"}${formatMoney(Math.abs(amount), opts)}`;
  }

  function formatCompactMoney(value, opts) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      compactDisplay: "short",
      minimumFractionDigits: opts?.minimumFractionDigits ?? 0,
      maximumFractionDigits: opts?.maximumFractionDigits ?? 2,
    }).format(amount);
  }

  function formatAxisMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    if (Math.abs(amount) < 1000) {
      return formatMoney(amount, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    return formatCompactMoney(amount, { maximumFractionDigits: 1 });
  }

  function formatInteger(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(amount);
  }

  function formatDate(value) {
    const timestamp = Date.parse(String(value ?? ""));
    if (!Number.isFinite(timestamp)) return "—";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  }

  function formatPrice(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    const digits = amount >= 100 ? 2 : amount >= 1 ? 3 : 4;
    return formatMoney(amount, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatPriceAxis(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return amount.toLocaleString("en-US", {
      minimumFractionDigits: amount >= 100 ? 2 : 3,
      maximumFractionDigits: amount >= 100 ? 2 : 3,
    });
  }

  function formatChartWindowTitle(value) {
    return formatWindowLabel(value);
  }

  function formatChartTime(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value)) return "";
    const options =
      state.chartWindow === "24h"
        ? { hour: "2-digit", minute: "2-digit" }
        : { month: "2-digit", day: "2-digit", hour: "2-digit" };
    return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
  }

  function avgEntryPrice(row) {
    const netUsd = Number(row?.netUsd);
    const netSize = Number(row?.netSize);
    if (!Number.isFinite(netUsd) || !Number.isFinite(netSize) || netUsd === 0) return null;
    const size = Math.abs(netSize);
    if (size <= 0) return null;
    const price = Math.abs(netUsd) / size;
    return Number.isFinite(price) && price > 0 ? price : null;
  }

  function totalBreakdown(row) {
    const netUsd = Number(row?.netUsd ?? 0);
    const totalUsd = Math.max(Number(row?.totalUsd ?? 0), Math.abs(netUsd));
    const buyUsd = Math.max(0, (totalUsd + netUsd) / 2);
    const sellUsd = Math.max(0, (totalUsd - netUsd) / 2);
    return { totalUsd, buyUsd, sellUsd };
  }

  function addressKey(address) {
    return typeof address === "string" ? address.trim().toLowerCase() : "";
  }

  function isWalletAddress(value) {
    return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
  }

  function readStateFromUrl() {
    const params = new URLSearchParams(location.search);
    const participantWindow = params.get("window");
    const chartWindow = params.get("chartWindow");
    const limitValue = Number(params.get("limit"));
    const viewValue = params.get("view");
    const marketId = params.get("marketId");
    const chartMode = params.get("chartMode");

    if (PARTICIPANT_WINDOWS.includes(participantWindow)) {
      state.participantsWindow = participantWindow;
    }
    if (CHART_WINDOWS.includes(chartWindow)) {
      state.chartWindow = chartWindow;
    }
    if (LIMIT_OPTIONS.includes(limitValue)) {
      state.limit = limitValue;
    }
    if (viewValue === "total" || viewValue === "net") {
      state.view = viewValue;
    }
    if (CHART_MODES.includes(chartMode)) {
      state.chartMode = chartMode;
    }
    if (typeof marketId === "string" && MARKET_MAP.has(marketId.trim())) {
      state.marketId = marketId.trim();
    }
  }

  function updateUrl() {
    const params = new URLSearchParams();
    if (state.participantsWindow !== DEFAULT_STATE.participantsWindow) {
      params.set("window", state.participantsWindow);
    }
    if (state.chartWindow !== DEFAULT_STATE.chartWindow) {
      params.set("chartWindow", state.chartWindow);
    }
    if (state.limit !== DEFAULT_STATE.limit) {
      params.set("limit", String(state.limit));
    }
    if (state.view !== DEFAULT_STATE.view) {
      params.set("view", state.view);
    }
    if (state.chartMode !== DEFAULT_STATE.chartMode) {
      params.set("chartMode", state.chartMode);
    }
    if (state.marketId !== DEFAULT_STATE.marketId) {
      params.set("marketId", state.marketId);
    }

    const query = params.toString();
    history.replaceState(null, "", query ? `${location.pathname}?${query}` : location.pathname);
  }

  function buildToggle(root, options, selected, formatter, onClick) {
    if (!root) return;
    root.innerHTML = "";
    const fragment = document.createDocumentFragment();

    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = formatter(option);
      if (option === selected) button.classList.add("active");
      button.addEventListener("click", () => onClick(option));
      fragment.appendChild(button);
    }

    root.appendChild(fragment);
  }

  function renderAssetTabs() {
    buildToggle(
      ui.assetToggle,
      ASSETS.map((asset) => asset.id),
      getCurrentAsset().id,
      (value) => ASSETS.find((asset) => asset.id === value)?.label || value,
      (value) => {
        const nextAsset = ASSETS.find((asset) => asset.id === value);
        if (!nextAsset) return;
        state.marketId = nextAsset.markets[0].id;
        updateUrl();
        loadDashboard(false);
      },
    );
  }

  function renderMarketToggle() {
    const asset = getCurrentAsset();
    const markets = asset.markets || [];

    if (ui.marketToggleWrap) {
      ui.marketToggleWrap.hidden = markets.length <= 1;
    }
    if (markets.length <= 1) {
      if (ui.marketToggle) ui.marketToggle.innerHTML = "";
      return;
    }

    buildToggle(
      ui.marketToggle,
      markets.map((entry) => entry.id),
      state.marketId,
      (value) => markets.find((entry) => entry.id === value)?.label || value,
      (value) => {
        state.marketId = value;
        updateUrl();
        loadDashboard(false);
      },
    );
  }

  function renderParticipantControls() {
    buildToggle(
      ui.windowToggle,
      PARTICIPANT_WINDOWS,
      state.participantsWindow,
      (value) => formatWindowLabel(value),
      (value) => {
        state.participantsWindow = value;
        updateUrl();
        loadDashboard(false);
      },
    );

    buildToggle(
      ui.limitToggle,
      LIMIT_OPTIONS,
      state.limit,
      (value) => `Top ${value}`,
      (value) => {
        state.limit = value;
        updateUrl();
        loadDashboard(false);
      },
    );

    ui.tabNet?.classList.toggle("active", state.view === "net");
    ui.tabTotal?.classList.toggle("active", state.view === "total");
  }

  function renderChartControls() {
    buildToggle(
      ui.chartModeToggle,
      CHART_MODES,
      state.chartMode,
      (value) => value.charAt(0).toUpperCase() + value.slice(1),
      (value) => {
        state.chartMode = value;
        updateUrl();
        renderChart(state.payload, state.candles);
      },
    );

    buildToggle(
      ui.chartWindowToggle,
      CHART_WINDOWS,
      state.chartWindow,
      (value) => formatWindowLabel(value),
      (value) => {
        state.chartWindow = value;
        updateUrl();
        loadDashboard(false);
      },
    );
  }

  function setStatus(message) {
    setText(ui.marketFlowStatus, message || "");
  }

  function setChartStatus(message) {
    setText(ui.chartStatus, message || "");
  }

  function setView(view) {
    state.view = view;
    render();
    updateUrl();
  }

  function renderHeroDeltas(payload) {
    if (!ui.heroDeltas) return;
    ui.heroDeltas.innerHTML = "";

    const deltas = payload?.summary?.deltas || {};
    const fragment = document.createDocumentFragment();

    for (const windowKey of DELTA_WINDOWS) {
      const entry = deltas[windowKey];
      const amount = Number(entry?.netUsd);
      const card = document.createElement("article");
      card.className = "market-flow-hero-delta-card";

      const label = document.createElement("span");
      label.className = "market-flow-hero-delta-label";
      label.textContent = formatDeltaLabel(windowKey);

      const value = document.createElement("strong");
      value.className = "market-flow-hero-delta-value";
      if (amount > 0) value.classList.add("positive");
      else if (amount < 0) value.classList.add("negative");
      else value.classList.add("neutral");
      value.textContent = formatSignedMoney(amount, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });

      const subtext = document.createElement("span");
      subtext.className = "market-flow-hero-delta-subtext";
      subtext.textContent = `${formatInteger(entry?.buyCount)} buys · ${formatInteger(
        entry?.sellCount,
      )} sells`;

      card.appendChild(label);
      card.appendChild(value);
      card.appendChild(subtext);
      fragment.appendChild(card);
    }

    ui.heroDeltas.appendChild(fragment);
  }

  function renderEmptyList(root, message) {
    if (!root) return;
    root.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "market-flow-empty";
    empty.textContent = message;
    root.appendChild(empty);
  }

  function renderParticipantRow(row, rank, labels, tone, mode) {
    const wrapper = document.createElement("div");
    wrapper.className = "market-flow-row";

    const left = document.createElement("div");
    left.className = "market-flow-rankline";

    const rankEl = document.createElement("span");
    rankEl.className = "market-flow-rank";
    rankEl.textContent = `#${rank}`;

    const identity = document.createElement("div");
    identity.className = "market-flow-identity";

    const address = String(row?.wallet ?? "");
    const labelInfo = labels?.[addressKey(address)] ?? null;
    const walletLink = isWalletAddress(address) ? document.createElement("a") : null;

    if (walletLink) {
      walletLink.className = "market-flow-wallet-link";
      walletLink.href = `/wallets/${address}`;
      walletLink.title = labelInfo?.name ? `${labelInfo.name} · ${address}` : address;
      walletLink.setAttribute("aria-label", `Open wallet ${address}`);
      walletLink.addEventListener("click", (event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        const href = walletLink.getAttribute("href");
        if (!href || href === location.pathname) return;

        event.preventDefault();
        history.pushState(null, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    }

    if (labelInfo?.name) {
      const nameEl = document.createElement("div");
      nameEl.className = "market-flow-name";
      nameEl.textContent = labelInfo.name;
      const addressEl = document.createElement("div");
      addressEl.className = "market-flow-address";
      addressEl.textContent = address;
      if (walletLink) {
        walletLink.appendChild(nameEl);
        walletLink.appendChild(addressEl);
        identity.appendChild(walletLink);
      } else {
        identity.appendChild(nameEl);
        identity.appendChild(addressEl);
      }
    } else {
      identity.classList.add("unlabeled");
      const addressEl = document.createElement("div");
      addressEl.className = "market-flow-address";
      addressEl.textContent = address;
      if (walletLink) {
        walletLink.appendChild(addressEl);
        identity.appendChild(walletLink);
      } else {
        identity.appendChild(addressEl);
      }
    }

    left.appendChild(rankEl);
    left.appendChild(identity);

    const right = document.createElement("div");
    right.className = "market-flow-stats";

    const amount = document.createElement("span");
    amount.className = `market-flow-amount ${tone}`;
    amount.textContent =
      mode === "total"
        ? formatMoney(Math.abs(Number(row?.totalUsd ?? 0)))
        : formatMoney(Math.abs(Number(row?.netUsd ?? 0)));

    const detail = document.createElement("span");
    detail.className = "market-flow-detail";

    if (mode === "total") {
      const breakdown = totalBreakdown(row);
      detail.textContent =
        `Buys ${formatCompactMoney(breakdown.buyUsd)} · ` +
        `Sells ${formatCompactMoney(breakdown.sellUsd)} · ` +
        `Trades ${formatInteger(row?.tradeCount)}`;
    } else {
      const avgEntry = avgEntryPrice(row);
      detail.textContent =
        `Trades ${formatInteger(row?.tradeCount)} · ` +
        `Avg entry ${avgEntry == null ? "—" : formatPrice(avgEntry)}`;
    }

    right.appendChild(amount);
    right.appendChild(detail);
    wrapper.appendChild(left);
    wrapper.appendChild(right);

    return wrapper;
  }

  function renderNetLists(payload) {
    const buyers = payload?.topBuys?.top ?? [];
    const sellers = payload?.topSells?.top ?? [];
    const labels = payload?.labels ?? {};

    setText(ui.buyersTitle, `Top net buyers (${formatWindowLabel(state.participantsWindow)})`);
    setText(ui.sellersTitle, `Top net sellers (${formatWindowLabel(state.participantsWindow)})`);

    if (!buyers.length) {
      renderEmptyList(ui.buyersList, "No participant data yet.");
    } else {
      ui.buyersList.innerHTML = "";
      const fragment = document.createDocumentFragment();
      buyers.forEach((row, index) => {
        fragment.appendChild(renderParticipantRow(row, index + 1, labels, "positive", "net"));
      });
      ui.buyersList.appendChild(fragment);
    }

    if (!sellers.length) {
      renderEmptyList(ui.sellersList, "No participant data yet.");
    } else {
      ui.sellersList.innerHTML = "";
      const fragment = document.createDocumentFragment();
      sellers.forEach((row, index) => {
        fragment.appendChild(renderParticipantRow(row, index + 1, labels, "negative", "net"));
      });
      ui.sellersList.appendChild(fragment);
    }

    if (ui.sellersCard) ui.sellersCard.hidden = false;
    ui.marketFlowGrid?.classList.remove("single");
  }

  function renderTotalList(payload) {
    const volumeRows = payload?.topVolume?.top ?? [];
    const labels = payload?.labels ?? {};

    setText(ui.buyersTitle, `Top total volume (${formatWindowLabel(state.participantsWindow)})`);
    setText(ui.sellersTitle, "");

    if (!volumeRows.length) {
      renderEmptyList(ui.buyersList, "No participant data yet.");
    } else {
      ui.buyersList.innerHTML = "";
      const fragment = document.createDocumentFragment();
      volumeRows.forEach((row, index) => {
        fragment.appendChild(renderParticipantRow(row, index + 1, labels, "neutral", "total"));
      });
      ui.buyersList.appendChild(fragment);
    }

    if (ui.sellersList) ui.sellersList.innerHTML = "";
    if (ui.sellersCard) ui.sellersCard.hidden = true;
    ui.marketFlowGrid?.classList.add("single");
  }

  function scaleLinear(value, domainMin, domainMax, rangeMin, rangeMax) {
    if (domainMax === domainMin) {
      return (rangeMin + rangeMax) / 2;
    }
    const ratio = (value - domainMin) / (domainMax - domainMin);
    return rangeMin + ratio * (rangeMax - rangeMin);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function buildHourlySeries(payload) {
    const hourly = Array.isArray(payload?.summary?.hourly) ? payload.summary.hourly : [];
    let cumulative = 0;
    return hourly
      .map((entry) => {
        const timestamp = Date.parse(String(entry?.hourStart ?? ""));
        const netUsd = Number(entry?.netUsd ?? 0);
        const buyUsd = Number(entry?.buyUsd ?? 0);
        const sellUsd = Number(entry?.sellUsd ?? 0);
        if (!Number.isFinite(timestamp) || !Number.isFinite(netUsd)) return null;
        cumulative += netUsd;
        return {
          timestamp,
          netUsd,
          displayNet: state.chartMode === "cumulative" ? cumulative : netUsd,
          buyUsd,
          sellUsd,
        };
      })
      .filter(Boolean);
  }

  function buildPriceSeries(candles, hourlySeries) {
    const rows = Array.isArray(candles?.candles) ? candles.candles : [];
    const normalized = rows
      .map((row) => ({
        timestamp: Number(row?.time ?? row?.t),
        close: Number(row?.close ?? row?.c),
      }))
      .filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.close))
      .sort((a, b) => a.timestamp - b.timestamp);

    if (!normalized.length || !hourlySeries.length) return [];

    const prices = [];
    let candleIndex = 0;
    let lastClose = normalized[0].close;

    for (const point of hourlySeries) {
      while (
        candleIndex + 1 < normalized.length &&
        normalized[candleIndex + 1].timestamp <= point.timestamp
      ) {
        candleIndex += 1;
        lastClose = normalized[candleIndex].close;
      }

      if (normalized[candleIndex]?.timestamp <= point.timestamp) {
        lastClose = normalized[candleIndex].close;
      }

      prices.push({
        timestamp: point.timestamp,
        close: lastClose,
      });
    }

    return prices;
  }

  function renderChart(payload, candles) {
    if (!ui.chartSvg) return;

    const market = getCurrentMarket();
    const hourlySeries = buildHourlySeries(payload);
    const priceSeries = buildPriceSeries(candles, hourlySeries);

    setText(
      ui.chartTitle,
      state.chartMode === "interval"
        ? `Net flow per hour (last ${formatChartWindowTitle(state.chartWindow)})`
        : `Cumulative net flow (last ${formatChartWindowTitle(state.chartWindow)})`,
    );
    setText(ui.chartSubtitle, market.label);

    if (!hourlySeries.length) {
      ui.chartSvg.innerHTML = "";
      if (ui.chartEmpty) {
        ui.chartEmpty.hidden = false;
        ui.chartEmpty.textContent = "No hourly market-flow data yet.";
      }
      return;
    }

    if (ui.chartEmpty) ui.chartEmpty.hidden = true;

    const width = 1200;
    const height = 480;
    const margin = { top: 28, right: 76, bottom: 56, left: 78 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const barSlot = plotWidth / hourlySeries.length;
    const barWidth = Math.max(3, Math.min(14, barSlot * 0.72));
    const values = hourlySeries.map((entry) => entry.displayNet);
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(0, ...values);
    let yMin = minValue;
    let yMax = maxValue;

    if (yMin === yMax) {
      const pad = Math.abs(yMax || 1);
      yMin -= pad;
      yMax += pad;
    }

    const netTicks = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      return yMax - (yMax - yMin) * ratio;
    });
    const zeroY = scaleLinear(0, yMin, yMax, margin.top + plotHeight, margin.top);
    const priceValues = priceSeries.map((entry) => entry.close).filter(Number.isFinite);
    let priceMin = priceValues.length ? Math.min(...priceValues) : 0;
    let priceMax = priceValues.length ? Math.max(...priceValues) : 1;
    if (priceMin === priceMax) {
      const pad = Math.abs(priceMax || 1) * 0.05;
      priceMin -= pad;
      priceMax += pad;
    }

    const xForIndex = (index) => {
      if (hourlySeries.length === 1) return margin.left + plotWidth / 2;
      return margin.left + barSlot * index + barSlot / 2;
    };
    const yForNet = (value) => scaleLinear(value, yMin, yMax, margin.top + plotHeight, margin.top);
    const yForPrice = (value) =>
      scaleLinear(value, priceMin, priceMax, margin.top + plotHeight, margin.top);

    const xTickCount = Math.min(state.chartWindow === "24h" ? 6 : 7, hourlySeries.length);
    const xTickIndexes = Array.from({ length: xTickCount }, (_, index) =>
      Math.round((index * (hourlySeries.length - 1)) / Math.max(1, xTickCount - 1)),
    ).filter((value, index, list) => list.indexOf(value) === index);

    const gridLines = netTicks
      .map((tick) => {
        const y = yForNet(tick);
        return `
          <line
            x1="${margin.left}"
            y1="${y}"
            x2="${width - margin.right}"
            y2="${y}"
            class="market-flow-chart-grid"
          />
          <text
            x="${margin.left - 16}"
            y="${y + 5}"
            class="market-flow-chart-axis-label market-flow-chart-axis-label-left"
          >${escapeHtml(formatAxisMoney(tick))}</text>
        `;
      })
      .join("");

    const zeroLine = `
      <line
        x1="${margin.left}"
        y1="${zeroY}"
        x2="${width - margin.right}"
        y2="${zeroY}"
        class="market-flow-chart-zero"
      />
    `;

    const bars = hourlySeries
      .map((entry, index) => {
        const x = xForIndex(index) - barWidth / 2;
        const y = yForNet(Math.max(entry.displayNet, 0));
        const baseY = yForNet(Math.min(entry.displayNet, 0));
        const heightValue = Math.max(2, Math.abs(baseY - y));
        const className =
          entry.displayNet > 0
            ? "market-flow-chart-bar positive"
            : entry.displayNet < 0
              ? "market-flow-chart-bar negative"
              : "market-flow-chart-bar neutral";

        return `
          <rect
            x="${x}"
            y="${Math.min(y, baseY)}"
            width="${barWidth}"
            height="${heightValue}"
            rx="3"
            class="${className}"
          >
            <title>${escapeHtml(
              `${formatChartTime(entry.timestamp)}\nNet ${formatSignedMoney(entry.displayNet)}\nBuys ${formatMoney(
                entry.buyUsd,
              )}\nSells ${formatMoney(entry.sellUsd)}`,
            )}</title>
          </rect>
        `;
      })
      .join("");

    const linePoints = priceSeries
      .map((entry, index) => `${xForIndex(index)},${yForPrice(entry.close)}`)
      .join(" ");
    const priceTickValues = Array.from({ length: 4 }, (_, index) => {
      const ratio = index / 3;
      return priceMax - (priceMax - priceMin) * ratio;
    });
    const priceLabels = priceTickValues
      .map((value) => {
        const y = yForPrice(value);
        return `
          <text
            x="${width - margin.right + 16}"
            y="${y + 5}"
            class="market-flow-chart-axis-label market-flow-chart-axis-label-right"
          >${escapeHtml(formatPriceAxis(value))}</text>
        `;
      })
      .join("");

    const xLabels = xTickIndexes
      .map((index) => {
        const entry = hourlySeries[index];
        return `
          <text
            x="${xForIndex(index)}"
            y="${height - 18}"
            text-anchor="middle"
            class="market-flow-chart-axis-label market-flow-chart-axis-label-bottom"
          >${escapeHtml(formatChartTime(entry.timestamp))}</text>
        `;
      })
      .join("");

    ui.chartSvg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${gridLines}
      ${zeroLine}
      ${bars}
      ${
        linePoints
          ? `<polyline points="${linePoints}" class="market-flow-chart-line" />
             <polyline points="${linePoints}" class="market-flow-chart-line-glow" />`
          : ""
      }
      ${priceLabels}
      ${xLabels}
    `;
  }

  function render() {
    renderAssetTabs();
    renderMarketToggle();
    renderParticipantControls();
    renderChartControls();

    const market = getCurrentMarket();
    setText(ui.marketId, state.marketId);
    setText(ui.marketWindow, formatWindowLabel(state.participantsWindow));
    setText(
      ui.marketFlowDescription,
      state.view === "net"
        ? "Aggregated buys minus sells (includes passive + aggressive trades)."
        : "Sum of buys and sells over the selected window.",
    );
    setText(ui.chartSubtitle, market.label);

    const payload = state.payload;
    if (!payload) {
      setText(ui.marketUpdated, "—");
      if (ui.heroDeltas) ui.heroDeltas.innerHTML = "";
      renderChart(null, state.candles);
      if (ui.sellersCard) ui.sellersCard.hidden = false;
      ui.marketFlowGrid?.classList.remove("single");
      renderEmptyList(ui.buyersList, "Loading participant data...");
      renderEmptyList(ui.sellersList, "Loading participant data...");
      return;
    }

    setText(ui.marketUpdated, formatDate(payload?.summary?.generatedAt));
    renderHeroDeltas(payload);
    renderChart(payload, state.candles);

    if (state.view === "net") {
      renderNetLists(payload);
    } else {
      renderTotalList(payload);
    }
  }

  async function fetchMarketFlow(refresh) {
    const url = new URL("/api/qwantify/market-flow/batch", location.origin);
    url.searchParams.set("marketId", state.marketId);
    url.searchParams.set("chartWindow", state.chartWindow);
    url.searchParams.set("participantsWindow", state.participantsWindow);
    url.searchParams.set("limit", String(state.limit));
    if (refresh) url.searchParams.set("refresh", "1");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        payload && typeof payload.error === "string"
          ? payload.error
          : "Failed to load market flow.";
      throw new Error(message);
    }

    return payload;
  }

  async function fetchMarketCandles(refresh) {
    const url = new URL("/api/qwantify/market-flow/candles", location.origin);
    url.searchParams.set("marketId", state.marketId);
    url.searchParams.set("window", state.chartWindow);
    if (refresh) url.searchParams.set("refresh", "1");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        payload && typeof payload.error === "string"
          ? payload.error
          : "Failed to load market candles.";
      throw new Error(message);
    }

    return payload;
  }

  async function loadDashboard(refresh) {
    state.loading = true;
    setStatus("Loading participant market flow...");
    setChartStatus("Loading chart...");
    if (ui.marketFlowRefresh) ui.marketFlowRefresh.disabled = true;

    const [flowResult, candleResult] = await Promise.allSettled([
      fetchMarketFlow(refresh),
      fetchMarketCandles(refresh),
    ]);

    try {
      if (flowResult.status === "rejected") {
        throw flowResult.reason;
      }

      state.payload = flowResult.value;
      state.candles = candleResult.status === "fulfilled" ? candleResult.value : null;
      render();

      setStatus(
        `Loaded ${state.marketId} ${formatWindowLabel(state.participantsWindow)} participant flow.`,
      );

      if (candleResult.status === "fulfilled") {
        const candleCount = Array.isArray(candleResult.value?.candles)
          ? candleResult.value.candles.length
          : 0;
        const lastClose = candleResult.value?.candles?.at?.(-1)?.close;
        setChartStatus(
          `Loaded ${formatWindowLabel(state.chartWindow)} chart with ${formatInteger(
            candleCount,
          )} candles${Number.isFinite(Number(lastClose)) ? ` · Last ${formatPrice(lastClose)}` : ""}.`,
        );
      } else {
        setChartStatus("Chart loaded without a price line.");
      }
    } catch (error) {
      state.payload = null;
      state.candles = null;
      render();
      setStatus("Unable to load participant market flow.");
      setChartStatus("Unable to load chart.");
      renderEmptyList(ui.buyersList, error?.message || "Failed to load market flow.");
      renderEmptyList(ui.sellersList, error?.message || "Failed to load market flow.");
      if (ui.chartEmpty) {
        ui.chartEmpty.hidden = false;
        ui.chartEmpty.textContent = error?.message || "Failed to load chart.";
      }
    } finally {
      state.loading = false;
      if (ui.marketFlowRefresh) ui.marketFlowRefresh.disabled = false;
    }
  }

  ui.tabNet?.addEventListener("click", () => setView("net"));
  ui.tabTotal?.addEventListener("click", () => setView("total"));
  ui.marketFlowRefresh?.addEventListener("click", () => loadDashboard(true));

  readStateFromUrl();
  render();
  loadDashboard(false);
  return undefined;
}
