const PORT = Number(process.env.PORT ?? 3000);
const CHAIN = process.env.HL_CHAIN ?? "Mainnet";

const INFO_ENDPOINT = "https://api.hyperliquid.xyz/info";
const STATS_BASE = "https://stats-data.hyperliquid.xyz";
const HYPURRSCAN_API = "https://api.hypurrscan.io";

const DAY_MS = 24 * 60 * 60 * 1000;
const leaderboardTtlMs = DAY_MS;
const positionsTtlMs = DAY_MS;
const fillsTtlMs = DAY_MS;
const midsTtlMs = DAY_MS;
const unstakingTtlMs = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_USER_FILLS = 2000;

const cache = new Map();

const windowKeys = ["day", "week", "month", "allTime"];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function notFound() {
  return new Response("Not Found", { status: 404 });
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function cached(key, ttlMs, fetcher) {
  const cachedValue = getCached(key);
  if (cachedValue) return cachedValue;
  const value = await fetcher();
  return setCached(key, value, ttlMs);
}

async function cachedWithBypass(key, ttlMs, fetcher, bypassCache) {
  if (bypassCache) {
    const value = await fetcher();
    return setCached(key, value, ttlMs);
  }
  return cached(key, ttlMs, fetcher);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function fetchInfo(payload) {
  return fetchJson(INFO_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function normalizeWindowPerformances(list) {
  const windows = Object.fromEntries(
    windowKeys.map((key) => [key, { pnl: 0, roi: 0, vlm: 0 }]),
  );
  for (const [key, stats] of list ?? []) {
    windows[key] = {
      pnl: Number(stats?.pnl ?? 0),
      roi: Number(stats?.roi ?? 0),
      vlm: Number(stats?.vlm ?? 0),
    };
  }
  return windows;
}

function normalizeLeaderboardRow(row) {
  return {
    ethAddress: row.ethAddress,
    displayName: row.displayName ?? "",
    accountValue: Number(row.accountValue ?? 0),
    windows: normalizeWindowPerformances(row.windowPerformances),
  };
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function shouldBypassCache(url) {
  const refresh = url.searchParams.get("refresh");
  return refresh === "1" || refresh === "true";
}

function toTimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value; // seconds -> ms
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) return asNum < 1e12 ? asNum * 1000 : asNum; // seconds -> ms
    const asDate = Date.parse(trimmed);
    if (Number.isFinite(asDate)) return asDate;
  }
  return 0;
}

function fillSortTimeMs(fill) {
  return Math.max(
    toTimeMs(fill?.time),
    toTimeMs(fill?.endTime),
    toTimeMs(fill?.startTime),
  );
}

async function handleLeaderboard(url) {
  const limit = Math.min(
    5000,
    Math.max(1, Number(url.searchParams.get("limit") ?? "500")),
  );
  const key = `leaderboard:${CHAIN}`;
  const leaderboard = await cachedWithBypass(
    key,
    leaderboardTtlMs,
    async () => {
      return fetchJson(`${STATS_BASE}/${CHAIN}/leaderboard`);
    },
    shouldBypassCache(url),
  );

  const rows = (leaderboard?.leaderboardRows ?? [])
    .map(normalizeLeaderboardRow)
    .sort((a, b) => b.accountValue - a.accountValue)
    .slice(0, limit)
    .map((row, index) => ({ rank: index + 1, ...row }));

  return jsonResponse({ chain: CHAIN, limit, updatedAt: Date.now(), rows });
}

async function handlePositions(address, bypassCache) {
  const key = `positions:${address}`;
  const data = await cachedWithBypass(
    key,
    positionsTtlMs,
    async () => {
      return fetchInfo({ type: "clearinghouseState", user: address });
    },
    bypassCache,
  );

  return jsonResponse({ address, data });
}

async function handleFills(address, url, bypassCache) {
  const days = Math.min(
    180,
    Math.max(1, Number(url.searchParams.get("days") ?? "30")),
  );
  const now = Date.now();
  const startTime = now - days * 24 * 60 * 60 * 1000;
  const key = `fills:${address}:${days}`;

  const fills = await cachedWithBypass(
    key,
    fillsTtlMs,
    async () => {
      return fetchInfo({
        type: "userFillsByTime",
        user: address,
        startTime,
        endTime: now,
        aggregateByTime: true,
      });
    },
    bypassCache,
  );

  const liquidations = (Array.isArray(fills) ? fills : []).filter(
    (fill) => fill.liquidation,
  );
  liquidations.sort((a, b) => fillSortTimeMs(b) - fillSortTimeMs(a));

  return jsonResponse({ address, days, items: liquidations });
}

async function handleUserFills(address, url, bypassCache) {
  const days = Math.min(
    180,
    Math.max(1, Number(url.searchParams.get("days") ?? "30")),
  );
  const limitRaw = Number(url.searchParams.get("limit") ?? String(DEFAULT_MAX_USER_FILLS));
  const limit = Math.min(2000, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_MAX_USER_FILLS));
  const now = Date.now();
  const startTime = now - days * 24 * 60 * 60 * 1000;
  const key = `userFills:${address}:${days}:${limit}`;

  const fills = await cachedWithBypass(
    key,
    fillsTtlMs,
    async () => {
      // `userFillsByTime` is capped and returns fills closest to `startTime`.
      // For a "Recent trades" UI we want the most recent fills, so use
      // `userFills` which returns the latest fills directly.
      return fetchInfo({ type: "userFills", user: address });
    },
    bypassCache,
  );

  const items = (Array.isArray(fills) ? fills : [])
    .filter((fill) => {
      const t = fillSortTimeMs(fill);
      return t >= startTime && t <= now;
    })
    .sort((a, b) => fillSortTimeMs(b) - fillSortTimeMs(a))
    .slice(0, limit);

  return jsonResponse({ address, days, startTime, endTime: now, items });
}

async function handleSpotState(address, bypassCache) {
  const key = `spot:${address}`;
  const data = await cachedWithBypass(
    key,
    positionsTtlMs,
    async () => {
      return fetchInfo({ type: "spotClearinghouseState", user: address });
    },
    bypassCache,
  );

  return jsonResponse({ address, data });
}

async function handleMids(bypassCache) {
  const key = `mids:${CHAIN}`;
  const mids = await cachedWithBypass(
    key,
    midsTtlMs,
    async () => {
      return fetchInfo({ type: "allMids" });
    },
    bypassCache,
  );

  return jsonResponse({ chain: CHAIN, updatedAt: Date.now(), mids });
}

async function handleUnstaking(bypassCache) {
  const key = "unstaking:queue";
  const raw = await cachedWithBypass(
    key,
    unstakingTtlMs,
    async () => {
      return fetchJson(`${HYPURRSCAN_API}/fullUnstakingQueue`);
    },
    bypassCache,
  );

  const now = Date.now();
  const WEI_DECIMALS = 1e8;

  const future = [];
  const pending = [];

  for (const entry of raw) {
    if (entry.time == null) {
      pending.push(entry);
    } else if (entry.time > now) {
      future.push(entry);
    }
  }

  const days = [];
  for (let i = 0; i < 7; i++) {
    const dayStart = now + i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    let totalWei = 0;
    let count = 0;
    const topEntries = [];

    for (const entry of future) {
      if (entry.time >= dayStart && entry.time < dayEnd) {
        totalWei += entry.wei;
        count += 1;
        topEntries.push(entry);
      }
    }

    topEntries.sort((a, b) => b.wei - a.wei);

    days.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      dayOfWeek: new Date(dayStart).toLocaleDateString("en-US", {
        weekday: "short",
      }),
      hype: totalWei / WEI_DECIMALS,
      count,
      top: topEntries.slice(0, 10).map((e) => ({
        user: e.user,
        hype: e.wei / WEI_DECIMALS,
        time: e.time,
      })),
    });
  }

  const totalFutureHype = future.reduce((s, e) => s + e.wei, 0) / WEI_DECIMALS;
  const totalPendingHype =
    pending.reduce((s, e) => s + e.wei, 0) / WEI_DECIMALS;

  return jsonResponse({
    updatedAt: now,
    totalEntries: future.length,
    totalHype: totalFutureHype,
    pendingEntries: pending.length,
    pendingHype: totalPendingHype,
    days,
  });
}

async function handleApi(req, url) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const bypassCache = shouldBypassCache(url);

  if (url.pathname === "/api/leaderboard") {
    try {
      return await handleLeaderboard(url);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname.startsWith("/api/positions/")) {
    const address = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    if (!isAddress(address)) {
      return jsonResponse({ error: "Invalid address" }, 400);
    }

    try {
      return await handlePositions(address, bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname.startsWith("/api/fills/")) {
    const address = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    if (!isAddress(address)) {
      return jsonResponse({ error: "Invalid address" }, 400);
    }

    try {
      return await handleFills(address, url, bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname.startsWith("/api/userFills/")) {
    const address = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    if (!isAddress(address)) {
      return jsonResponse({ error: "Invalid address" }, 400);
    }

    try {
      return await handleUserFills(address, url, bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname.startsWith("/api/spot/")) {
    const address = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    if (!isAddress(address)) {
      return jsonResponse({ error: "Invalid address" }, 400);
    }

    try {
      return await handleSpotState(address, bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/mids") {
    try {
      return await handleMids(bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/unstaking") {
    try {
      return await handleUnstaking(bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  return notFound();
}

async function serveStatic(pathname) {
  const safePath =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (safePath.includes("..")) return notFound();

  const file = Bun.file(new URL(`./public/${safePath}`, import.meta.url));
  if (!(await file.exists())) return notFound();

  return new Response(file, {
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
}

const WALLET_PATH_REGEX = /^\/wallets\/(0x[a-fA-F0-9]{40})\/?$/;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, url);
    }

    if (WALLET_PATH_REGEX.test(url.pathname)) {
      const file = Bun.file(new URL("./public/wallet.html", import.meta.url));
      return new Response(file, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return serveStatic(url.pathname);
  },
});

console.log(`hl-stats running on http://localhost:${PORT}`);
