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

const HEATMAP_TILE_GAP = 4;
const MIN_VISIBLE_TILE_WIDTH = 78;
const MIN_VISIBLE_TILE_HEIGHT = 52;
const MIN_VISIBLE_TILE_AREA = 4800;

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

function worstAspect(row, side) {
  if (!row.length || side <= 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const node of row) {
    const area = Math.max(0, node.area);
    sum += area;
    if (area < min) min = area;
    if (area > max) max = area;
  }
  if (sum <= 0 || min <= 0) return Number.POSITIVE_INFINITY;
  const sideSq = side * side;
  return Math.max((sideSq * max) / (sum * sum), (sum * sum) / (sideSq * min));
}

function layoutTreemapRow(row, rect, out) {
  const totalArea = row.reduce((sum, node) => sum + node.area, 0);
  if (!row.length || totalArea <= 0) return rect;

  // Strip orientation must follow the shorter side.
  // For wide canvases, place a vertical column first (not a full-width row).
  if (rect.w >= rect.h) {
    const colWidth = rect.h > 0 ? totalArea / rect.h : 0;
    let cursorY = rect.y;
    for (const node of row) {
      const itemHeight = colWidth > 0 ? node.area / colWidth : 0;
      out.push({ row: node.row, x: rect.x, y: cursorY, w: colWidth, h: itemHeight });
      cursorY += itemHeight;
    }
    return {
      x: rect.x + colWidth,
      y: rect.y,
      w: Math.max(0, rect.w - colWidth),
      h: rect.h,
    };
  }

  const rowHeight = rect.w > 0 ? totalArea / rect.w : 0;
  let cursorX = rect.x;
  for (const node of row) {
    const itemWidth = rowHeight > 0 ? node.area / rowHeight : 0;
    out.push({ row: node.row, x: cursorX, y: rect.y, w: itemWidth, h: rowHeight });
    cursorX += itemWidth;
  }
  return {
    x: rect.x,
    y: rect.y + rowHeight,
    w: rect.w,
    h: Math.max(0, rect.h - rowHeight),
  };
}

function squarifyTreemap(nodes, currentRow, rect, out) {
  if (!nodes.length) {
    if (currentRow.length) layoutTreemapRow(currentRow, rect, out);
    return;
  }

  if (rect.w <= 0 || rect.h <= 0) return;

  const side = Math.min(rect.w, rect.h);
  const nextNode = nodes[0];

  if (!currentRow.length) {
    squarifyTreemap(nodes.slice(1), [nextNode], rect, out);
    return;
  }

  const currentWorst = worstAspect(currentRow, side);
  const nextWorst = worstAspect([...currentRow, nextNode], side);

  if (nextWorst <= currentWorst) {
    squarifyTreemap(nodes.slice(1), [...currentRow, nextNode], rect, out);
    return;
  }

  const nextRect = layoutTreemapRow(currentRow, rect, out);
  squarifyTreemap(nodes, [], nextRect, out);
}

function computeTreemapLayout(rows, width, height) {
  if (!rows.length || width <= 0 || height <= 0) return [];

  const withWeight = rows
    .map((row) => {
      const openInterestUsd = toNumber(row.openInterestUsd);
      return {
        row,
        weight: openInterestUsd != null ? Math.max(0, openInterestUsd) : 0,
      };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  if (!withWeight.length) return [];

  const totalWeight = withWeight.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return [];

  const totalArea = width * height;
  const nodes = withWeight.map((entry) => ({
    row: entry.row,
    area: (entry.weight / totalWeight) * totalArea,
  }));

  const out = [];
  squarifyTreemap(nodes, [], { x: 0, y: 0, w: width, h: height }, out);
  return out;
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
    .sort((a, b) => (b.openInterestUsd ?? -Infinity) - (a.openInterestUsd ?? -Infinity))
    .slice(0, 80);

  if (!rows.length) {
    heatmapUi.grid.innerHTML = '<div class="muted">No matching markets</div>';
    return;
  }

  const width = Math.max(0, Math.floor(heatmapUi.grid.clientWidth));
  const height = Math.max(0, Math.floor(heatmapUi.grid.clientHeight));

  if (!width || !height) return;

  const metric = heatmapState.metric;
  const layout = computeTreemapLayout(rows, width, height);

  if (!layout.length) {
    heatmapUi.grid.innerHTML = '<div class="muted">No markets with open interest data yet.</div>';
    return;
  }

  heatmapUi.grid.innerHTML = layout
    .map(({ row, x, y, w, h }) => {
      const tileWidth = Math.max(0, w - HEATMAP_TILE_GAP);
      const tileHeight = Math.max(0, h - HEATMAP_TILE_GAP);
      if (
        tileWidth < MIN_VISIBLE_TILE_WIDTH ||
        tileHeight < MIN_VISIBLE_TILE_HEIGHT ||
        tileWidth * tileHeight < MIN_VISIBLE_TILE_AREA
      ) {
        return "";
      }

      const metricValue = row[metric];
      const color = metricColor(metricValue);
      const href = `/?asset=${encodeURIComponent(`${row.base}/USD`)}`;

      const compact = tileWidth < 130 || tileHeight < 100;
      const tiny = tileWidth < 95 || tileHeight < 72;
      const micro = tileWidth < 62 || tileHeight < 44;

      const classes = ["heatmap-tile"];
      if (compact) classes.push("compact");
      if (tiny) classes.push("tiny");
      if (micro) classes.push("micro");

      return `<a class="${classes.join(" ")}" href="${href}" style="left:${x + HEATMAP_TILE_GAP / 2}px;top:${y + HEATMAP_TILE_GAP / 2}px;width:${tileWidth}px;height:${tileHeight}px;background:${color}">
        <div class="heatmap-symbol">${row.base}</div>
        <div class="heatmap-value">${formatPercent(metricValue)}</div>
        <div class="heatmap-meta">$${formatCompact(row.openInterestUsd)} OI</div>
        <div class="heatmap-meta secondary">$${formatCompact(row.volume1d)} Vol</div>
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

function initHeatmapResize() {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(renderHeatmap, 120);
  });
}

function initHeatmap() {
  initHeatmapControls();
  initHeatmapResize();
  loadHeatmapData();
  setInterval(loadHeatmapData, 10_000);
}

initHeatmap();
