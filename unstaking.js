const state = {
  data: null,
  feesData: null,
  loading: false,
};

const ui = {
  totalHype: document.getElementById("total-hype"),
  totalEntries: document.getElementById("total-entries"),
  pendingHype: document.getElementById("pending-hype"),
  lastUpdated: document.getElementById("last-updated"),
  fees24h: document.getElementById("fees-24h"),
  fees24hChange: document.getElementById("fees-24h-change"),
  feesSpotShare: document.getElementById("fees-spot-share"),
  feesUpdated: document.getElementById("fees-updated"),
  chartStatus: document.getElementById("chart-status"),
  unstakingBars: document.getElementById("unstaking-bars"),
  chartAxis: document.getElementById("chart-axis"),
  dailyBody: document.getElementById("daily-body"),
  topBody: document.getElementById("top-body"),
  topCount: document.getElementById("top-count"),
  avgDaily: document.getElementById("avg-daily"),
  peakDay: document.getElementById("peak-day"),
  peakAmount: document.getElementById("peak-amount"),
  refreshButton: document.getElementById("refresh-button"),
};

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const fullFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

function setText(el, value) {
  if (!el) return;
  el.textContent = value;
}

function formatCompact(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  if (Math.abs(value) < 1000) return fullFormatter.format(value);
  return compactFormatter.format(value);
}

function formatHype(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return formatCompact(value) + " HYPE";
}

function formatFullHype(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return numberFormatter.format(value) + " HYPE";
}

function formatUsd(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${formatCompact(Math.abs(value))}`;
}

function formatPercent(value, decimals = 2) {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

function formatPlainPercent(value, decimals = 2) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(decimals)}%`;
}

function classForSign(value) {
  if (value == null || !Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "positive" : "negative";
}

function applySignedClass(element, value) {
  if (!element) return;
  element.classList.remove("positive", "negative");
  const className = classForSign(value);
  if (className) element.classList.add(className);
}

function formatAddress(address) {
  if (!address) return "--";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatUnlockTime(timestamp) {
  if (!timestamp) return "--";
  const d = new Date(timestamp);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function createCell(value, className) {
  const cell = document.createElement("td");
  cell.textContent = value ?? "--";
  if (className) cell.className = className;
  return cell;
}

function getBarColor(index, total) {
  const colors = [
    "linear-gradient(180deg, #e56b3b, #c2462f)",
    "linear-gradient(180deg, #e8854f, #d4632f)",
    "linear-gradient(180deg, #f0a060, #d87840)",
    "linear-gradient(180deg, #e8b870, #c89050)",
    "linear-gradient(180deg, #1f7f6d, #186b5c)",
    "linear-gradient(180deg, #3aa48f, #2d8a78)",
    "linear-gradient(180deg, #5cb8a5, #4aa090)",
  ];
  return colors[index % colors.length];
}

function renderChart(days) {
  if (!ui.unstakingBars || !days?.length) return;

  const maxHype = Math.max(...days.map((d) => d.hype), 1);

  ui.unstakingBars.innerHTML = "";
  ui.unstakingBars.style.setProperty("--bins", String(days.length));

  days.forEach((day, i) => {
    const col = document.createElement("div");
    col.className = "unstaking-bar-col";

    const bar = document.createElement("div");
    bar.className = "unstaking-bar";
    const heightPct = Math.max((day.hype / maxHype) * 100, 3);
    bar.style.height = `${heightPct}%`;
    bar.style.background = getBarColor(i, days.length);

    const label = document.createElement("div");
    label.className = "unstaking-bar-label";
    label.textContent = formatCompact(day.hype);

    const tooltip = document.createElement("div");
    tooltip.className = "unstaking-bar-tooltip";
    tooltip.textContent = `${fullFormatter.format(day.hype)} HYPE`;

    bar.appendChild(tooltip);
    col.appendChild(label);
    col.appendChild(bar);
    ui.unstakingBars.appendChild(col);
  });

  if (ui.chartAxis) {
    ui.chartAxis.innerHTML = "";
    days.forEach((day) => {
      const span = document.createElement("span");
      span.textContent = `${day.dayOfWeek} ${formatDate(day.date)}`;
      ui.chartAxis.appendChild(span);
    });
  }
}

function renderDailyTable(days, totalHype) {
  if (!ui.dailyBody || !days?.length) {
    setTableMessage(ui.dailyBody, "No data available.", 5);
    return;
  }

  ui.dailyBody.innerHTML = "";
  const fragment = document.createDocumentFragment();

  days.forEach((day) => {
    const row = document.createElement("tr");
    row.appendChild(createCell(formatDate(day.date)));
    row.appendChild(createCell(day.dayOfWeek));
    row.appendChild(createCell(formatFullHype(day.hype), "mono"));
    row.appendChild(createCell(numberFormatter.format(day.count)));

    const pct = totalHype > 0 ? ((day.hype / totalHype) * 100).toFixed(1) : 0;
    row.appendChild(createCell(`${pct}%`));

    fragment.appendChild(row);
  });

  ui.dailyBody.appendChild(fragment);
}

function renderTopEntries(days) {
  if (!ui.topBody) return;

  const allTop = [];
  for (const day of days ?? []) {
    for (const entry of day.top ?? []) {
      allTop.push({
        ...entry,
        date: day.date,
        dayOfWeek: day.dayOfWeek,
      });
    }
  }

  allTop.sort((a, b) => b.hype - a.hype);
  const top20 = allTop.slice(0, 20);

  setText(ui.topCount, `${top20.length} entries`);

  if (!top20.length) {
    setTableMessage(ui.topBody, "No entries yet.", 3);
    return;
  }

  ui.topBody.innerHTML = "";
  const fragment = document.createDocumentFragment();

  top20.forEach((entry) => {
    const row = document.createElement("tr");

    const addrCell = createCell(formatAddress(entry.user), "mono");
    addrCell.title = entry.user;
    addrCell.style.cursor = "pointer";
    addrCell.addEventListener("click", () => {
      window.open(
        `https://hypurrscan.io/address/${entry.user}`,
        "_blank",
        "noreferrer",
      );
    });
    row.appendChild(addrCell);

    row.appendChild(createCell(formatCompact(entry.hype)));
    row.appendChild(createCell(formatUnlockTime(entry.time)));

    fragment.appendChild(row);
  });

  ui.topBody.appendChild(fragment);
}

function renderStats(data) {
  if (!data?.days?.length) return;

  const days = data.days;
  const avgDaily = data.totalHype / days.length;
  setText(ui.avgDaily, formatHype(avgDaily));

  let peakIdx = 0;
  for (let i = 1; i < days.length; i++) {
    if (days[i].hype > days[peakIdx].hype) peakIdx = i;
  }

  const peak = days[peakIdx];
  setText(ui.peakDay, `${peak.dayOfWeek} ${formatDate(peak.date)}`);
  setText(ui.peakAmount, formatHype(peak.hype));
}

function clearFeeStats() {
  setText(ui.fees24h, "--");
  setText(ui.fees24hChange, "--");
  setText(ui.feesSpotShare, "--");
  setText(ui.feesUpdated, "--");
  applySignedClass(ui.fees24hChange, 0);
}

function renderFeeStats(data) {
  if (!data) {
    clearFeeStats();
    return;
  }

  setText(ui.fees24h, formatUsd(Number(data.fees24h)));

  const changePct = Number(data.fees24hChangePct);
  setText(ui.fees24hChange, formatPercent(changePct));
  applySignedClass(ui.fees24hChange, changePct);

  const spotShare = Number(data.spotSharePct24h);
  setText(ui.feesSpotShare, formatPlainPercent(spotShare));
  setText(
    ui.feesUpdated,
    data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : "--",
  );
}

function render(data) {
  if (!data) return;

  setText(ui.totalHype, formatHype(data.totalHype));
  setText(ui.totalEntries, numberFormatter.format(data.totalEntries));
  setText(ui.pendingHype, formatHype(data.pendingHype));
  setText(
    ui.lastUpdated,
    data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : "--",
  );
  setText(ui.chartStatus, `${data.totalEntries} entries loaded`);

  renderChart(data.days);
  renderDailyTable(data.days, data.totalHype);
  renderTopEntries(data.days);
  renderStats(data);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadData(refresh = false) {
  if (state.loading) return;
  state.loading = true;
  setText(ui.chartStatus, "Loading...");
  setTableMessage(ui.dailyBody, "Loading unstaking data...", 5);
  setTableMessage(ui.topBody, "Loading...", 3);
  setText(ui.feesUpdated, "Loading...");

  const unstakingUrl = refresh ? "/api/unstaking?refresh=1" : "/api/unstaking";
  const feesUrl = refresh ? "/api/fees24h?refresh=1" : "/api/fees24h";

  const [unstakingResult, feesResult] = await Promise.allSettled([
    fetchJson(unstakingUrl),
    fetchJson(feesUrl),
  ]);

  if (unstakingResult.status === "fulfilled") {
    state.data = unstakingResult.value;
    render(unstakingResult.value);
  } else {
    setText(ui.chartStatus, "Failed to load data");
    setTableMessage(ui.dailyBody, "Failed to load unstaking data.", 5);
    setTableMessage(ui.topBody, "Failed to load data.", 3);
  }

  if (feesResult.status === "fulfilled") {
    state.feesData = feesResult.value;
    renderFeeStats(feesResult.value);
  } else {
    state.feesData = null;
    clearFeeStats();
  }

  state.loading = false;
}

function init() {
  ui.refreshButton?.addEventListener("click", () => loadData(true));
  loadData();

  // Auto-refresh every 5 minutes
  setInterval(() => loadData(), 5 * 60 * 1000);
}

init();
