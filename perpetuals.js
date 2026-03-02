const state = {
  rows: [],
  search: "",
  sort: "screener",
};

const ui = {
  searchInput: document.getElementById("market-search"),
  metricToggle: document.getElementById("metric-toggle"),
  marketBody: document.getElementById("market-body"),
};

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatPrice(value) {
  const num = toNumber(value);
  if (num === null) return "--";
  if (Math.abs(num) >= 1000) return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(num) >= 1) {
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 8,
  });
}

function formatCompact(value) {
  const num = toNumber(value);
  if (num === null) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
  }).format(num);
}

function formatPercent(value) {
  const num = toNumber(value);
  if (num === null) return "--";
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(2)}%`;
}

function percentFromSeries(series, startIndex, endIndex) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const start = toNumber(series[startIndex]);
  const end = toNumber(series[endIndex]);
  if (start === null || end === null || start === 0) return null;
  return ((end - start) / Math.abs(start)) * 100;
}

function renderSparkline(series) {
  if (!Array.isArray(series) || series.length < 2) {
    return '<span class="muted">--</span>';
  }

  const points = series.map(toNumber).filter((n) => n !== null);
  if (points.length < 2) return '<span class="muted">--</span>';

  const width = 86;
  const height = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stroke = points[points.length - 1] >= points[0] ? "#17b7c8" : "#ff606a";

  const polyline = points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return `<svg class="market-sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${polyline}" stroke="${stroke}" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}

function renderLs(longPct, shortPct) {
  const long = toNumber(longPct);
  const short = toNumber(shortPct);
  if (long === null || short === null) return '<span class="muted">--</span>';
  return `<div class="ls-cell"><span>${Math.round(long)}</span><div class="ls-bar"><span class="long" style="width:${Math.max(
    0,
    Math.min(100, long),
  )}%"></span><span class="short" style="width:${Math.max(
    0,
    Math.min(100, short),
  )}%"></span></div><span>${Math.round(short)}</span></div>`;
}

function getSortedRows(rows) {
  const copy = rows.slice();
  if (state.sort === "funding") {
    copy.sort((a, b) => (b.longPct ?? -Infinity) - (a.longPct ?? -Infinity));
    return copy;
  }
  if (state.sort === "volume") {
    copy.sort((a, b) => (b.volume1d ?? -Infinity) - (a.volume1d ?? -Infinity));
    return copy;
  }
  if (state.sort === "openInterest") {
    copy.sort((a, b) => (b.openInterestUsd ?? -Infinity) - (a.openInterestUsd ?? -Infinity));
    return copy;
  }
  // Screener
  copy.sort((a, b) => (b.openInterestUsd ?? -Infinity) - (a.openInterestUsd ?? -Infinity));
  return copy;
}

function renderRows() {
  if (!ui.marketBody) return;

  const query = state.search.trim().toUpperCase();
  let rows = state.rows;
  if (query) {
    rows = rows.filter((row) => row.base.includes(query));
  }
  rows = getSortedRows(rows);

  if (!rows.length) {
    ui.marketBody.innerHTML = '<tr><td colspan="10" class="muted">No matching markets</td></tr>';
    return;
  }

  ui.marketBody.innerHTML = rows
    .map((row) => {
      const change1dClass = (row.change1d ?? 0) >= 0 ? "positive" : "negative";
      const change1hClass = (row.change1h ?? 0) >= 0 ? "positive" : "negative";
      const oi1dClass = (row.oiChg1d ?? 0) >= 0 ? "positive" : "negative";
      const oi1hClass = (row.oiChg1h ?? 0) >= 0 ? "positive" : "negative";
      const href = `/?asset=${encodeURIComponent(`${row.base}/USD`)}`;
      return `<tr>
        <td><a class="market-link" href="${href}">${row.base}</a></td>
        <td>$${formatPrice(row.price)}</td>
        <td>${renderSparkline(row.trend)}</td>
        <td class="${change1dClass}">${formatPercent(row.change1d)}</td>
        <td class="${change1hClass}">${formatPercent(row.change1h)}</td>
        <td>$${formatCompact(row.openInterestUsd)}</td>
        <td class="${oi1dClass}">${formatPercent(row.oiChg1d)}</td>
        <td class="${oi1hClass}">${formatPercent(row.oiChg1h)}</td>
        <td>$${formatCompact(row.volume1d)}</td>
        <td>${renderLs(row.longPct, row.shortPct)}</td>
      </tr>`;
    })
    .join("");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

async function loadData() {
  try {
    const [snapshotRes, relativeRes, binanceRes] = await Promise.allSettled([
      fetchJson("/api/market/snapshot?refresh=1"),
      fetchJson("/api/market/relative-strength?refresh=1"),
      fetchJson("/api/market/binance-24h?refresh=1"),
    ]);

    const snapshot =
      snapshotRes.status === "fulfilled" && snapshotRes.value?.symbols
        ? snapshotRes.value.symbols
        : {};
    const relative =
      relativeRes.status === "fulfilled" && relativeRes.value?.symbols
        ? relativeRes.value.symbols
        : {};
    const binance =
      binanceRes.status === "fulfilled" && binanceRes.value?.symbols
        ? binanceRes.value.symbols
        : {};

    const keys = new Set([
      ...Object.keys(snapshot),
      ...Object.keys(relative),
      ...Object.keys(binance),
    ]);

    const rows = [];
    for (const key of keys) {
      const snap = snapshot[key] ?? {};
      const rel = relative[key] ?? {};
      const bin = binance[key] ?? {};
      const base = String(key).replace("/USD", "");

      const trend = Array.isArray(snap.sparkline)
        ? snap.sparkline
        : Array.isArray(rel.sparkline)
          ? rel.sparkline
          : [];
      const price =
        toNumber(bin.lastPrice) ??
        toNumber(rel.last_price) ??
        toNumber(trend[trend.length - 1]);
      const change1d =
        toNumber(bin.priceChangePercent) ??
        toNumber(rel.change_pct) ??
        percentFromSeries(trend, 0, trend.length - 1);
      const seriesFor1h = Array.isArray(rel.sparkline) ? rel.sparkline : trend;
      const oneHourStart = Math.max(0, seriesFor1h.length - 5);
      const change1h = percentFromSeries(
        seriesFor1h,
        oneHourStart,
        seriesFor1h.length - 1,
      );

      rows.push({
        base,
        price,
        trend,
        change1d,
        change1h,
        openInterestUsd: toNumber(snap.open_interest_usd),
        oiChg1d: toNumber(snap.oi_change_1d_pct),
        oiChg1h: toNumber(snap.oi_change_1h_pct),
        volume1d: toNumber(bin.quoteVolume),
        longPct: toNumber(snap.long_pct),
        shortPct: toNumber(snap.short_pct),
      });
    }

    state.rows = rows;
    renderRows();
  } catch (error) {
    if (ui.marketBody) {
      ui.marketBody.innerHTML = `<tr><td colspan="10" class="muted">Failed to load market data: ${
        error instanceof Error ? error.message : "Unknown error"
      }</td></tr>`;
    }
  }
}

function initControls() {
  ui.searchInput?.addEventListener("input", (event) => {
    const input = event.target;
    state.search = input && "value" in input ? String(input.value) : "";
    renderRows();
  });

  ui.metricToggle?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[data-sort]");
    if (!button) return;
    state.sort = button.dataset.sort || "screener";
    Array.from(ui.metricToggle.querySelectorAll("button")).forEach((node) => {
      node.classList.toggle("active", node === button);
    });
    renderRows();
  });
}

function init() {
  initControls();
  loadData();
  setInterval(loadData, 10_000);
}

init();
