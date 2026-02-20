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
const fees24hTtlMs = 5 * 60 * 1000; // 5 minutes
const FILLS_PAGE_LIMIT = 2000;
const DEFAULT_MAX_USER_FILLS = 4000;

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
  let attempt = 0;
  // Hyperliquid can rate-limit (429). Retry a few times with backoff.
  // Keep this conservative so a single request doesn't hang the server.
  while (true) {
    const response = await fetch(url, options);
    if (response.ok) return response.json();

    const status = response.status;
    const retryAfter = response.headers.get("retry-after");
    const text = await response.text().catch(() => "");

    if ((status === 429 || status >= 500) && attempt < 5) {
      const baseDelayMs = 500 * 2 ** attempt;
      const retryAfterMs = retryAfter
        ? Math.max(0, Number(retryAfter) * 1000)
        : 0;
      const delayMs = Math.min(8000, Math.max(baseDelayMs, retryAfterMs));
      await new Promise((r) => setTimeout(r, delayMs));
      attempt += 1;
      continue;
    }

    throw new Error(`Request failed (${status}): ${text || "null"}`);
  }
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

function computeFillRangeMs(items) {
  let min = Infinity;
  let max = -Infinity;
  for (const it of items ?? []) {
    const t = fillSortTimeMs(it);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { startTime: min, endTime: max };
}

function fillDedupeKey(fill) {
  return String(
    fill?.tid ?? `${fill?.time ?? ""}:${fill?.oid ?? ""}:${fill?.hash ?? ""}`,
  );
}

async function fetchUserFillsByTimeBackfill({
  user,
  startTime,
  endTime,
  maxItems,
}) {
  const out = [];
  const seen = new Set();

  let cursorEnd = endTime;
  let windowMs = 24 * 60 * 60 * 1000; // start with 24h chunks
  const minWindowMs = 60 * 1000; // 1 minute
  const maxWindowMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  let guard = 0;

  while (cursorEnd > startTime && out.length < maxItems && guard++ < 200) {
    const windowStart = Math.max(startTime, cursorEnd - windowMs);
    const batch = await fetchInfo({
      type: "userFillsByTime",
      user,
      startTime: windowStart,
      endTime: cursorEnd,
    });
    const items = Array.isArray(batch) ? batch : [];

    if (items.length >= FILLS_PAGE_LIMIT && windowMs > minWindowMs) {
      // Too many fills in this window; shrink to avoid truncation.
      windowMs = Math.max(minWindowMs, Math.floor(windowMs / 2));
      continue;
    }

    for (const fill of items) {
      const key = fillDedupeKey(fill);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fill);
      if (out.length >= maxItems) break;
    }

    // Move backward in time.
    cursorEnd = windowStart;

    // Adapt window size: grow if sparse, keep/shrink if dense.
    if (items.length < 250) windowMs = Math.min(maxWindowMs, windowMs * 2);
    else if (items.length >= FILLS_PAGE_LIMIT)
      windowMs = Math.max(minWindowMs, Math.floor(windowMs / 2));
  }

  return out;
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
  const now = Date.now();
  const queryStartTime = now - days * 24 * 60 * 60 * 1000;
  const cursorEndRaw = url.searchParams.get("cursorEnd");
  const cursorEnd = cursorEndRaw != null ? Number(cursorEndRaw) : null;
  const includeTwaps =
    cursorEnd == null && (url.searchParams.get("includeTwaps") ?? "1") !== "0";

  const pageSize = 2000;
  const key =
    cursorEnd == null
      ? `userFillsLatest:${address}:${days}`
      : `userFillsBackfill:${address}:${days}:${cursorEnd}`;
  const twapKey = `twapHistory:${address}`;

  const [fills, twapHistory] = await Promise.all([
    cachedWithBypass(
      key,
      fillsTtlMs,
      async () => {
        if (cursorEnd == null) {
          // Latest fills (fast, capped ~2000).
          return fetchInfo({ type: "userFills", user: address });
        }
        // Older fills (page backward) via adaptive backfill, capped to `pageSize`.
        return fetchUserFillsByTimeBackfill({
          user: address,
          startTime: queryStartTime,
          endTime: cursorEnd,
          maxItems: pageSize,
        });
      },
      bypassCache,
    ),
    includeTwaps
      ? cachedWithBypass(
          twapKey,
          fillsTtlMs,
          async () => {
            return fetchInfo({ type: "twapHistory", user: address });
          },
          bypassCache,
        )
      : Promise.resolve([]),
  ]);

  const items = (Array.isArray(fills) ? fills : [])
    .filter((f) => {
      const t = fillSortTimeMs(f);
      return t >= queryStartTime && t <= now;
    })
    .sort((a, b) => fillSortTimeMs(b) - fillSortTimeMs(a));

  const range = computeFillRangeMs(items);
  const minTime = range?.startTime ?? null;
  const hasMore =
    minTime != null &&
    Number.isFinite(minTime) &&
    items.length >= pageSize &&
    minTime > queryStartTime;
  const nextCursorEnd = hasMore ? minTime - 1 : null;

  const twapsRaw = Array.isArray(twapHistory) ? twapHistory : [];
  const twaps = twapsRaw
    .map((t) => {
      const state = t?.state ?? {};
      const statusObj = t?.status ?? {};
      const timeMs =
        Number(state?.timestamp ?? 0) || Number(t?.time ?? 0) * 1000;
      const executedSz = Number(state?.executedSz ?? 0);
      const totalSz = Number(state?.sz ?? 0);
      const executedNtl = Number(state?.executedNtl ?? 0);
      const avgPx = executedSz > 0 ? executedNtl / executedSz : 0;
      return {
        kind: "twap",
        time: timeMs,
        twapId: t?.twapId ?? null,
        coin: state?.coin ?? "—",
        side: state?.side ?? null,
        executedSz,
        totalSz,
        executedNtl,
        avgPx,
        status: statusObj?.status ?? null,
      };
    })
    .filter(
      (t) =>
        Number.isFinite(t.time) && t.time >= queryStartTime && t.time <= now,
    )
    .sort((a, b) => b.time - a.time);

  return jsonResponse({
    address,
    days,
    // Query window (what we asked HL for)
    queryStartTime,
    queryEndTime: now,
    // Actual range of returned items in *this page* (caller can accumulate across pages).
    startTime: range?.startTime ?? null,
    endTime: range?.endTime ?? null,
    items,
    twaps,
    pageSize,
    cursorEnd: cursorEnd ?? null,
    nextCursorEnd,
    done: !hasMore,
  });
}

async function handleSpotState(address, bypassCache) {
  const key = `spot:${address}`;
  const data = await cachedWithBypass(
    key,
    positionsTtlMs,
    async () => {
      const [masterSpot, subs, stakingSummary, stakingDelegations] =
        await Promise.all([
          fetchInfo({ type: "spotClearinghouseState", user: address }),
          fetchInfo({ type: "subAccounts", user: address }).catch(() => []),
          fetchInfo({ type: "delegatorSummary", user: address }).catch(
            () => null,
          ),
          fetchInfo({ type: "delegations", user: address }).catch(() => []),
        ]);

      const aggregate = new Map();

      function addBalances(list) {
        for (const b of list ?? []) {
          const coin = String(b?.coin ?? "").trim();
          if (!coin) continue;
          const total = Number(b?.total ?? 0);
          const hold = Number(b?.hold ?? 0);
          if (!Number.isFinite(total) && !Number.isFinite(hold)) continue;
          const prev = aggregate.get(coin) ?? { coin, total: 0, hold: 0 };
          prev.total += Number.isFinite(total) ? total : 0;
          prev.hold += Number.isFinite(hold) ? hold : 0;
          aggregate.set(coin, prev);
        }
      }

      addBalances(masterSpot?.balances);
      for (const sub of Array.isArray(subs) ? subs : []) {
        addBalances(sub?.spotState?.balances);
      }

      const extras = [];
      const delegated = Number(stakingSummary?.delegated ?? 0);
      if (Number.isFinite(delegated) && delegated > 0) {
        extras.push({
          coin: "HYPE",
          total: delegated,
          hold: 0,
          kind: "delegated",
        });
      }

      return {
        aggregated: true,
        master: { balances: masterSpot?.balances ?? [] },
        subAccountsCount: Array.isArray(subs) ? subs.length : 0,
        stakingSummary,
        stakingDelegations,
        balances: [
          ...Array.from(aggregate.values()).sort((a, b) =>
            a.coin.localeCompare(b.coin),
          ),
          ...extras,
        ],
      };
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

function normalizeFeePoint(point) {
  const time = Number(point?.time ?? 0);
  const totalFees = Number(point?.total_fees ?? point?.totalFees ?? NaN);
  const totalSpotFees = Number(
    point?.total_spot_fees ?? point?.totalSpotFees ?? 0,
  );
  if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(totalFees)) {
    return null;
  }
  return {
    time,
    totalFees,
    totalSpotFees: Number.isFinite(totalSpotFees) ? totalSpotFees : 0,
  };
}

async function handleFees24h(bypassCache) {
  const key = "fees:24h";
  const raw = await cachedWithBypass(
    key,
    fees24hTtlMs,
    async () => {
      return fetchJson(`${HYPURRSCAN_API}/fees`);
    },
    bypassCache,
  );

  const points = (Array.isArray(raw) ? raw : [])
    .map(normalizeFeePoint)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);

  if (points.length < 2) {
    throw new Error("Not enough fee snapshots");
  }

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const prevPrev = points.length >= 3 ? points[points.length - 3] : null;

  const currentFeesRaw = last.totalFees - prev.totalFees;
  const previousFeesRaw = prevPrev ? prev.totalFees - prevPrev.totalFees : null;

  const currentSpotFeesRaw = last.totalSpotFees - prev.totalSpotFees;
  const previousSpotFeesRaw = prevPrev
    ? prev.totalSpotFees - prevPrev.totalSpotFees
    : null;

  const fees24hChangePct =
    previousFeesRaw != null && previousFeesRaw !== 0
      ? ((currentFeesRaw - previousFeesRaw) / Math.abs(previousFeesRaw)) * 100
      : null;

  const spotSharePct24h =
    currentFeesRaw !== 0 ? (currentSpotFeesRaw / currentFeesRaw) * 100 : null;

  return jsonResponse({
    updatedAt: Date.now(),
    unit: "USD",
    intervalHours: 24,
    source: `${HYPURRSCAN_API}/fees`,
    snapshots: {
      latestTime: last.time * 1000,
      previousTime: prev.time * 1000,
      previousPreviousTime: prevPrev ? prevPrev.time * 1000 : null,
    },
    fees24h: currentFeesRaw / 1e6,
    previousFees24h: previousFeesRaw == null ? null : previousFeesRaw / 1e6,
    fees24hChangePct,
    spotFees24h: currentSpotFeesRaw / 1e6,
    previousSpotFees24h:
      previousSpotFeesRaw == null ? null : previousSpotFeesRaw / 1e6,
    spotSharePct24h,
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

  if (url.pathname === "/api/fees24h") {
    try {
      return await handleFees24h(bypassCache);
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
  // Some endpoints (notably userFills backfill) may take >10s if upstream
  // rate-limits; keep the connection open longer.
  idleTimeout: 60,
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
