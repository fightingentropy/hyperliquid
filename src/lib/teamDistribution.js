// Derivations for the Team Distribution page: where each monthly HyperLabs
// HYPE distribution went and what the receiving wallets did with it. The
// qwantify team-wallets API sends every amount as a decimal string.

export const ALL_MONTHS_ID = "all";

// The four places a distributed token can end up. "Sold" is an estimate:
// received minus what was sent away, staked and kept.
export const FLOW_OUTCOMES = [
  { key: "kept", label: "Kept" },
  { key: "staked", label: "Staked" },
  { key: "sent", label: "Sent away" },
  { key: "sold", label: "Sold (est.)" },
];

const SANKEY_OUTCOME_ORDER = ["sent", "sold", "staked", "kept"];

export const WALLET_CATEGORIES = [
  {
    key: "sent",
    label: "Sent away",
    verb: "sent it all away",
    description: "Sent at least 95% to other addresses and kept under 2%.",
  },
  {
    key: "sentSold",
    label: "Sent away + sold",
    verb: "sent some away and sold the rest",
    description: "Kept under 2%. Some was sent away, the rest looks sold.",
  },
  {
    key: "sold",
    label: "Sold",
    verb: "sold it",
    description: "Kept under 2%, and at least half looks sold.",
  },
  {
    key: "keptSome",
    label: "Kept some",
    verb: "kept some of it",
    description: "Still has part of it and moved the rest out.",
  },
  {
    key: "staked",
    label: "Staked",
    verb: "staked it",
    description: "Kept it and staked most of it; under 10% moved out.",
  },
  {
    key: "kept",
    label: "Kept",
    verb: "kept it",
    description: "Kept it in the wallet; under 5% moved out.",
  },
];

const CATEGORY_INDEX = new Map(WALLET_CATEGORIES.map((category, index) => [category.key, index]));

const EMPTIED_HELD_SHARE = 0.02;
const SENT_AWAY_SHARE = 0.95;
const SOLD_SHARE = 0.5;
const STAKED_MAX_OUT_SHARE = 0.1;
const KEPT_MAX_OUT_SHARE = 0.05;

export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function share(value, total) {
  return total > 0 ? value / total : 0;
}

export function getWalletCategory(key) {
  return WALLET_CATEGORIES[CATEGORY_INDEX.get(key)] ?? null;
}

export function classifyWallet({ received, kept, staked, sent, sold }) {
  if (!(received > 0)) {
    return "kept";
  }

  const heldShare = (kept + staked) / received;
  const outShare = (sent + sold) / received;

  if (heldShare < EMPTIED_HELD_SHARE) {
    if (sent / received >= SENT_AWAY_SHARE) {
      return "sent";
    }

    return sold / received >= SOLD_SHARE ? "sold" : "sentSold";
  }

  if (outShare < STAKED_MAX_OUT_SHARE && staked / received > 0.5) {
    return "staked";
  }

  return outShare < KEPT_MAX_OUT_SHARE ? "kept" : "keptSome";
}

export function normalizeWalletRow(raw) {
  const address = raw?.wallet?.address ?? "";
  const row = {
    id: raw?.wallet?.id ?? address,
    address,
    label: raw?.memberLabel || raw?.wallet?.globalLabel || "",
    received: toNumber(raw?.receivedFromHyperLabs),
    kept: toNumber(raw?.currentBalance),
    staked: toNumber(raw?.currentStakedBalance),
    sent: toNumber(raw?.sentOutTotal),
    sentUsd: toNumber(raw?.sentOutUsd),
    sold: toNumber(raw?.soldToken),
  };

  row.held = row.kept + row.staked;
  row.outShare = share(row.sent + row.sold, row.received);
  row.category = classifyWallet(row);

  return row;
}

export function normalizeWalletRows(rawRows) {
  return Array.isArray(rawRows) ? rawRows.map(normalizeWalletRow) : [];
}

export function summarizeWallets(rows) {
  const totals = { received: 0, kept: 0, staked: 0, held: 0, sent: 0, sentUsd: 0, sold: 0 };
  const categories = WALLET_CATEGORIES.map((category) => ({
    ...category,
    count: 0,
    received: 0,
    outcomes: { kept: 0, staked: 0, sent: 0, sold: 0 },
  }));

  rows.forEach((row) => {
    Object.keys(totals).forEach((key) => {
      totals[key] += row[key];
    });

    const category = categories[CATEGORY_INDEX.get(row.category)];
    category.count += 1;
    category.received += row.received;
    FLOW_OUTCOMES.forEach(({ key }) => {
      category.outcomes[key] += row[key];
    });
  });

  return { walletCount: rows.length, totals, categories };
}

// The one or two categories that took the largest share of the distribution,
// for the "Of X HYPE distributed…" sentence.
export function buildSummaryClauses(summary, limit = 2) {
  return summary.categories
    .filter((category) => category.count > 0)
    .sort((left, right) => right.received - left.received)
    .slice(0, limit)
    .map((category) => ({
      key: category.key,
      verb: category.verb,
      count: category.count,
      share: share(category.received, summary.totals.received),
    }));
}

// Kept / Staked / Sent away / Sold segments for the small stacked bars.
export function buildFlowSegments(amounts, total) {
  return FLOW_OUTCOMES.map((outcome) => ({
    ...outcome,
    value: amounts[outcome.key] ?? 0,
    share: share(amounts[outcome.key] ?? 0, total),
  })).filter((segment) => segment.share > 0);
}

export function monthShortLabel(label) {
  const [monthName = "", year = ""] = `${label ?? ""}`.trim().split(/\s+/);
  return year ? `${monthName.slice(0, 3)} ’${year.slice(-2)}` : monthName;
}

export function isMonthWindowOpen(month, now = Date.now()) {
  const startAt = Date.parse(month?.startAt);
  const endAt = Date.parse(month?.endAt);
  return Number.isFinite(startAt) && Number.isFinite(endAt) && startAt <= now && now < endAt;
}

function buildTotalsTile(source) {
  const distributed = toNumber(source?.distributedFromHyperLabs);
  const kept = toNumber(source?.currentSpotBalance);
  const staked = toNumber(source?.currentStakedBalance);
  const sent = toNumber(source?.sentOutTotal);
  const sold = toNumber(source?.soldToken);
  const held = kept + staked;

  return {
    distributed,
    kept,
    staked,
    held,
    sent,
    sentUsd: toNumber(source?.sentOutUsd),
    sold,
    heldShare: share(held, distributed),
    soldShare: share(sold, distributed),
  };
}

// The month strip: an "All months" tile, then each distribution newest first.
export function buildMonthTiles(overview, monthsMeta, now = Date.now()) {
  const metaById = new Map((monthsMeta ?? []).map((month) => [month.id, month]));
  const months = [...(overview?.months ?? [])]
    .sort((left, right) => Date.parse(right.startAt) - Date.parse(left.startAt))
    .map((month) => {
      const meta = metaById.get(month.id);
      return {
        ...buildTotalsTile(month),
        id: month.id,
        label: month.label,
        shortLabel: monthShortLabel(month.label),
        startAt: month.startAt,
        endAt: month.endAt,
        walletCount: meta ? toNumber(meta.walletCount) : null,
        isOpen: isMonthWindowOpen(month, now),
      };
    });

  if (!overview?.totals) {
    return months;
  }

  const oldest = months[months.length - 1];
  const newest = months[0];

  return [
    {
      ...buildTotalsTile(overview.totals),
      id: ALL_MONTHS_ID,
      label: "All months",
      shortLabel: "All months",
      rangeLabel: oldest && newest ? `${oldest.label} – ${newest.label}` : "",
      monthCount: months.length,
      walletCount: toNumber(overview.walletCount),
      isOpen: false,
    },
    ...months,
  ];
}

export function buildMonthComparison(tile, previousTile) {
  if (!tile || !previousTile) {
    return null;
  }

  return {
    previousLabel: previousTile.label,
    heldDeltaPp: (tile.heldShare - previousTile.heldShare) * 100,
    soldDeltaPp: (tile.soldShare - previousTile.soldShare) * 100,
    distributedChangePct:
      previousTile.distributed > 0
        ? (tile.distributed / previousTile.distributed - 1) * 100
        : null,
  };
}

export function formatDelta(value, unit) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const digits = unit === "pp" ? 1 : 0;
  const sign = value < 0 ? "-" : "+";
  const arrow = Math.abs(value) >= 0.5 ? (value < 0 ? "↓ " : "↑ ") : "";
  return `${arrow}${sign}${Math.abs(value).toFixed(digits)}${unit}`;
}

const SORT_ACCESSORS = {
  wallet: (row) => (row.label || row.address).toLowerCase(),
  received: (row) => row.received,
  kept: (row) => row.kept,
  staked: (row) => row.staked,
  sent: (row) => row.sent,
  sold: (row) => row.sold,
  // Every row is valued at the same price, so held tokens order the same way.
  value: (row) => row.held,
  status: (row) => CATEGORY_INDEX.get(row.category),
  outShare: (row) => row.outShare,
};

export function sortWalletRows(rows, key, direction = "desc") {
  const accessor = SORT_ACCESSORS[key] ?? SORT_ACCESSORS.outShare;
  const factor = direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    const leftValue = accessor(left);
    const rightValue = accessor(right);
    const order =
      typeof leftValue === "string"
        ? leftValue.localeCompare(rightValue)
        : leftValue - rightValue;
    return order * factor;
  });
}

const SANKEY_NODE_WIDTH = 4;
const SANKEY_PAD_TOP = 22;
const SANKEY_PAD_BOTTOM = 8;
const SANKEY_CATEGORY_GAP = 19;
const SANKEY_OUTCOME_GAP = 14;
const SANKEY_MIN_NODE = 1.5;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function linkPath(x0, y0, x1, y1) {
  const midX = round2((x0 + x1) / 2);
  return `M${round2(x0)},${round2(y0)}C${midX},${round2(y0)} ${midX},${round2(y1)} ${round2(x1)},${round2(y1)}`;
}

function stackColumn(items, { x, top, span, minGap, size }) {
  const heights = items.map((item) => size(item.value));
  const used = heights.reduce((sum, height) => sum + height, 0);
  const gap = items.length > 1 ? Math.max(minGap, (span - used) / (items.length - 1)) : 0;
  let y = items.length > 1 ? top : top + Math.max(0, (span - used) / 2);

  return items.map((item, index) => {
    const node = { ...item, x, y, height: heights[index] };
    y += heights[index] + gap;
    return node;
  });
}

// Three-column flow: the distribution → wallet categories → where the tokens
// are now. Node heights and link widths share one tokens-to-pixels scale.
export function buildFlowLayout(summary, { width = 1152, height = 320 } = {}) {
  const total = summary?.totals?.received ?? 0;
  const categories = (summary?.categories ?? []).filter(
    (category) => category.count > 0 && category.received > 0,
  );
  const outcomes = SANKEY_OUTCOME_ORDER.map((key) => ({
    ...FLOW_OUTCOMES.find((outcome) => outcome.key === key),
    value: summary?.totals?.[key] ?? 0,
  })).filter((outcome) => outcome.value > 0);

  if (!(total > 0) || !categories.length || !outcomes.length) {
    return null;
  }

  const sourceX = 120;
  const outcomeX = width - 154;
  const categoryX = (sourceX + outcomeX) / 2;
  const span = height - SANKEY_PAD_TOP - SANKEY_PAD_BOTTOM;
  const scale = Math.min(
    (span - SANKEY_CATEGORY_GAP * (categories.length - 1) - SANKEY_MIN_NODE * categories.length) / total,
    (span - SANKEY_OUTCOME_GAP * (outcomes.length - 1) - SANKEY_MIN_NODE * outcomes.length) / total,
  );
  const size = (value) => Math.max(value * scale, SANKEY_MIN_NODE);

  const categoryNodes = stackColumn(
    categories.map((category) => ({
      key: category.key,
      label: category.label,
      count: category.count,
      value: category.received,
      outcomes: category.outcomes,
    })),
    { x: categoryX, top: SANKEY_PAD_TOP, span, minGap: SANKEY_CATEGORY_GAP, size },
  );
  const outcomeNodes = stackColumn(
    outcomes.map((outcome) => ({ key: outcome.key, label: outcome.label, value: outcome.value })),
    { x: outcomeX, top: SANKEY_PAD_TOP, span, minGap: SANKEY_OUTCOME_GAP, size },
  );

  const firstCategory = categoryNodes[0];
  const lastCategory = categoryNodes[categoryNodes.length - 1];
  const sourceHeight = total * scale;
  const source = {
    x: sourceX,
    y: (firstCategory.y + lastCategory.y + lastCategory.height) / 2 - sourceHeight / 2,
    height: sourceHeight,
    value: total,
  };

  const links = [];
  let sourceOffset = 0;
  categoryNodes.forEach((node) => {
    const linkWidth = node.value * scale;
    links.push({
      key: `source:${node.key}`,
      category: node.key,
      outcome: null,
      width: Math.max(linkWidth, 1),
      path: linkPath(
        source.x + SANKEY_NODE_WIDTH,
        source.y + sourceOffset + linkWidth / 2,
        node.x,
        node.y + node.height / 2,
      ),
    });
    sourceOffset += linkWidth;
  });

  const outcomeByKey = new Map(outcomeNodes.map((node) => [node.key, node]));
  const outcomeOffsets = new Map();
  categoryNodes.forEach((node) => {
    let categoryOffset = 0;
    SANKEY_OUTCOME_ORDER.forEach((outcomeKey) => {
      const value = node.outcomes[outcomeKey] ?? 0;
      const target = outcomeByKey.get(outcomeKey);
      if (!(value > 0) || !target) {
        return;
      }

      const linkWidth = value * scale;
      const targetOffset = outcomeOffsets.get(outcomeKey) ?? 0;
      links.push({
        key: `${node.key}:${outcomeKey}`,
        category: node.key,
        outcome: outcomeKey,
        width: Math.max(linkWidth, 1),
        path: linkPath(
          node.x + SANKEY_NODE_WIDTH,
          node.y + categoryOffset + linkWidth / 2,
          target.x,
          target.y + targetOffset + linkWidth / 2,
        ),
      });
      categoryOffset += linkWidth;
      outcomeOffsets.set(outcomeKey, targetOffset + linkWidth);
    });
  });

  return {
    width,
    height,
    nodeWidth: SANKEY_NODE_WIDTH,
    source,
    categories: categoryNodes,
    outcomes: outcomeNodes,
    links,
  };
}

const tokenAmountFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const compactTokenFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const smallUsdFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatTokenAmount(value) {
  return Number.isFinite(value) ? tokenAmountFormat.format(value) : "—";
}

export function formatCompactToken(value) {
  return Number.isFinite(value) ? compactTokenFormat.format(value) : "—";
}

export function formatUsdValue(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  return `${sign}$${magnitude < 1000 ? smallUsdFormat.format(magnitude) : compactTokenFormat.format(magnitude)}`;
}

export function formatShare(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

export function formatDayMonth(isoString, timeZone) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone });
}

export function formatSyncedAt(isoString, timeZone) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}
