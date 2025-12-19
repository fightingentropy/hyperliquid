const PORT = Number(process.env.PORT ?? 3000);
const CHAIN = process.env.HL_CHAIN ?? "Mainnet";

const INFO_ENDPOINT = "https://api.hyperliquid.xyz/info";
const STATS_BASE = "https://stats-data.hyperliquid.xyz";

const leaderboardTtlMs = 60_000;
const positionsTtlMs = 15_000;
const fillsTtlMs = 30_000;
const midsTtlMs = 10_000;

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
  const windows = Object.fromEntries(windowKeys.map((key) => [key, { pnl: 0, roi: 0, vlm: 0 }]));
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

async function handleLeaderboard(url) {
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") ?? "500")));
  const key = `leaderboard:${CHAIN}`;
  const leaderboard = await cached(key, leaderboardTtlMs, async () => {
    return fetchJson(`${STATS_BASE}/${CHAIN}/leaderboard`);
  });

  const rows = (leaderboard?.leaderboardRows ?? [])
    .map(normalizeLeaderboardRow)
    .sort((a, b) => b.accountValue - a.accountValue)
    .slice(0, limit)
    .map((row, index) => ({ rank: index + 1, ...row }));

  return jsonResponse({ chain: CHAIN, limit, updatedAt: Date.now(), rows });
}

async function handlePositions(address) {
  const key = `positions:${address}`;
  const data = await cached(key, positionsTtlMs, async () => {
    return fetchInfo({ type: "clearinghouseState", user: address });
  });

  return jsonResponse({ address, data });
}

async function handleFills(address, url) {
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? "30")));
  const now = Date.now();
  const startTime = now - days * 24 * 60 * 60 * 1000;
  const key = `fills:${address}:${days}`;

  const fills = await cached(key, fillsTtlMs, async () => {
    return fetchInfo({
      type: "userFillsByTime",
      user: address,
      startTime,
      endTime: now,
      aggregateByTime: true,
    });
  });

  const liquidations = (Array.isArray(fills) ? fills : []).filter((fill) => fill.liquidation);

  return jsonResponse({ address, days, items: liquidations });
}

async function handleMids() {
  const key = `mids:${CHAIN}`;
  const mids = await cached(key, midsTtlMs, async () => {
    return fetchInfo({ type: "allMids" });
  });

  return jsonResponse({ chain: CHAIN, updatedAt: Date.now(), mids });
}

async function handleApi(req, url) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

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
      return await handlePositions(address);
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
      return await handleFills(address, url);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/mids") {
    try {
      return await handleMids();
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  return notFound();
}

async function serveStatic(pathname) {
  const safePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (safePath.includes("..")) return notFound();

  const file = Bun.file(new URL(`./public/${safePath}`, import.meta.url));
  if (!(await file.exists())) return notFound();

  return new Response(file, {
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, url);
    }

    return serveStatic(url.pathname);
  },
});

console.log(`hl-stats running on http://localhost:${PORT}`);
