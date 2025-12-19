const INFO_ENDPOINT = "https://api.hyperliquid.xyz/info";
const STATS_BASE = "https://stats-data.hyperliquid.xyz";

const leaderboardTtlMs = 60_000;
const positionsTtlMs = 15_000;
const fillsTtlMs = 30_000;
const midsTtlMs = 10_000;

const cache = new Map<string, { value: unknown; expiresAt: number }>();

const windowKeys = ["day", "week", "month", "allTime"] as const;

type Env = {
  HL_CHAIN?: string;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function getCached(key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached<T>(key: string, value: T, ttlMs: number): T {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>) {
  const cachedValue = getCached(key);
  if (cachedValue) return cachedValue as T;
  const value = await fetcher();
  return setCached(key, value, ttlMs);
}

async function fetchJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function fetchInfo(payload: unknown) {
  return fetchJson(INFO_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function normalizeWindowPerformances(list: Array<[string, any]> | null | undefined) {
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

function normalizeLeaderboardRow(row: any) {
  return {
    ethAddress: row.ethAddress,
    displayName: row.displayName ?? "",
    accountValue: Number(row.accountValue ?? 0),
    windows: normalizeWindowPerformances(row.windowPerformances),
  };
}

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

async function handleLeaderboard(chain: string, url: URL) {
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") ?? "500")));
  const key = `leaderboard:${chain}`;
  const leaderboard = await cached(key, leaderboardTtlMs, async () => {
    return fetchJson(`${STATS_BASE}/${chain}/leaderboard`);
  });

  const rows = (leaderboard as any)?.leaderboardRows ?? [];
  const ranked = rows
    .map(normalizeLeaderboardRow)
    .sort((a: any, b: any) => b.accountValue - a.accountValue)
    .slice(0, limit)
    .map((row: any, index: number) => ({ rank: index + 1, ...row }));

  return jsonResponse({ chain, limit, updatedAt: Date.now(), rows: ranked });
}

async function handlePositions(address: string) {
  const key = `positions:${address}`;
  const data = await cached(key, positionsTtlMs, async () => {
    return fetchInfo({ type: "clearinghouseState", user: address });
  });

  return jsonResponse({ address, data });
}

async function handleFills(address: string, url: URL) {
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

async function handleMids(chain: string) {
  const key = `mids:${chain}`;
  const mids = await cached(key, midsTtlMs, async () => {
    return fetchInfo({ type: "allMids" });
  });

  return jsonResponse({ chain, updatedAt: Date.now(), mids });
}

async function handleApi(chain: string, req: Request, url: URL) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/leaderboard") {
    try {
      return await handleLeaderboard(chain, url);
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
      return await handleMids(chain);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  return notFound();
}

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  const url = new URL(request.url);
  const chain = env.HL_CHAIN ?? "Mainnet";

  return handleApi(chain, request, url);
}
