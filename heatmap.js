const heatmapState = {
  rows: [],
  metric: "change1d",
  search: "",
};

const heatmapUi = {
  searchInput: document.getElementById("heatmap-search"),
  metricToggle: document.getElementById("heatmap-metric"),
  grid: document.getElementById("heatmap-grid"),
};

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

function metricLabel(metric) {
  if (metric === "oi1h") return "OI Chg 1H";
  if (metric === "oi1d") return "OI Chg 1D";
  return "1D Change";
}

function metricColor(value) {
  const num = toNumber(value);
  if (num === null) return "rgba(19, 54, 88, 0.45)";
  const capped = Math.min(18, Math.max(-18, num));
  const intensity = Math.abs(capped) / 18;
  if (capped >= 0) {
    return `rgba(46, 207, 208, ${0.18 + intensity * 0.45})`;
  }
  return `rgba(255, 96, 106, ${0.18 + intensity * 0.45})`;
}

function renderHeatmap() {
  if (!heatmapUi.grid) return;
  const query = heatmapState.search.trim().toUpperCase();
  let rows = heatmapState.rows;
  if (query) {
    rows = rows.filter((row) => row.base.includes(query));
  }
  rows = rows
    .slice()
    .sort((a, b) => (b.openInterestUsd ?? -Infinity) - (a.openInterestUsd ?? -Infinity));

  if (!rows.length) {
    heatmapUi.grid.innerHTML = '<div class="muted">No matching markets</div>';
    return;
  }

  const metric = heatmapState.metric;
  heatmapUi.grid.innerHTML = rows
    .map((row) => {
      const metricValue = row[metric];
      const color = metricColor(metricValue);
      const href = `/asset/${encodeURIComponent(`${row.base}/USD`)}`;
      return `<a class="heatmap-tile" href="${href}" style="background:${color}">
        <div class="heatmap-symbol">${row.base}</div>
        <div class="heatmap-value">${formatPercent(metricValue)}</div>
        <div class="heatmap-meta">$${formatCompact(row.openInterestUsd)} OI</div>
        <div class="heatmap-meta">$${formatCompact(row.volume1d)} Vol</div>
      </a>`;
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

async function loadHeatmapData() {
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

    heatmapState.rows = Array.from(keys).map((key) => {
      const snap = snapshot[key] ?? {};
      const rel = relative[key] ?? {};
      const bin = binance[key] ?? {};
      return {
        base: String(key).replace("/USD", ""),
        change1d: toNumber(bin.priceChangePercent) ?? toNumber(rel.change_pct),
        oi1h: toNumber(snap.oi_change_1h_pct),
        oi1d: toNumber(snap.oi_change_1d_pct),
        openInterestUsd: toNumber(snap.open_interest_usd),
        volume1d: toNumber(bin.quoteVolume),
      };
    });

    renderHeatmap();
  } catch (error) {
    if (heatmapUi.grid) {
      heatmapUi.grid.innerHTML = `<div class="muted">Failed to load heatmap: ${
        error instanceof Error ? error.message : "Unknown error"
      }</div>`;
    }
  }
}

function initHeatmapControls() {
  heatmapUi.searchInput?.addEventListener("input", (event) => {
    const input = event.target;
    heatmapState.search = input && "value" in input ? String(input.value) : "";
    renderHeatmap();
  });

  heatmapUi.metricToggle?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[data-metric]");
    if (!button) return;
    heatmapState.metric = button.dataset.metric || "change1d";
    Array.from(heatmapUi.metricToggle.querySelectorAll("button")).forEach((node) => {
      node.classList.toggle("active", node === button);
      node.textContent = metricLabel(node.dataset.metric || "change1d");
    });
    renderHeatmap();
  });
}

function initHeatmap() {
  initHeatmapControls();
  loadHeatmapData();
  setInterval(loadHeatmapData, 10_000);
}

initHeatmap();
