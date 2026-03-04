const PORT = Number(process.env.PORT ?? 4173);
const CHAIN = process.env.HL_CHAIN ?? "Mainnet";

const INFO_ENDPOINT = "https://api.hyperliquid.xyz/info";
const STATS_BASE = "https://stats-data.hyperliquid.xyz";
const HYPURRSCAN_API = "https://api.hypurrscan.io";
const BREAKOUTPROP_API = "https://tools.breakoutprop.com/api";
const REMOTE_ORIGIN = "https://tools.breakoutprop.com";
const BINANCE_FAPI = "https://fapi.binance.com";
const YAHOO_FINANCE_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

const DAY_MS = 24 * 60 * 60 * 1000;
const leaderboardTtlMs = DAY_MS;
const positionsTtlMs = DAY_MS;
const fillsTtlMs = DAY_MS;
const midsTtlMs = DAY_MS;
const unstakingTtlMs = 5 * 60 * 1000; // 5 minutes
const fees24hTtlMs = 5 * 60 * 1000; // 5 minutes
const breakoutpropTtlMs = 30 * 1000; // 30 seconds
const depthTtlMs = 1000; // 1 second
const klineTtlMs = 5 * 1000; // 5 seconds
const assetHeaderTtlMs = 1000; // 1 second
const relativeStrengthTtlMs = 60 * 1000; // 60 seconds
const imageProxyTtlSeconds = 300;

const RELATIVE_STRENGTH_BASES = [
  "HYPE",
  "GRASS",
  "AIXBT",
  "NEAR",
  "AAVE",
  "JUP",
  "JTO",
  "UNI",
  "BONK",
  "PUMP",
  "FIL",
  "TRX",
  "ARB",
  "TIA",
  "ORDI",
  "OP",
  "BTC",
  "FLOKI",
  "LDO",
  "PENGU",
  "VIRTUAL",
  "S",
  "ETC",
  "LTC",
  "ALGO",
  "WLD",
  "POPCAT",
  "LIT",
  "WIF",
  "PNUT",
  "TRUMP",
  "SUI",
  "BCH",
  "RENDER",
  "ETH",
  "TAO",
  "ATOM",
  "DOGE",
  "XRP",
  "CRV",
  "XPL",
  "AVAX",
  "SOL",
  "INJ",
  "APT",
  "HBAR",
  "TON",
  "ONDO",
  "ADA",
  "LINK",
  "STX",
  "POL",
  "ASTER",
  "MOODENG",
  "SHIB",
  "KAITO",
  "PEPE",
  "FARTCOIN",
  "ZEC",
  "DOT",
  "IP",
];
const RELATIVE_STRENGTH_BASE_SET = new Set(RELATIVE_STRENGTH_BASES);
const RELATIVE_STRENGTH_SECTOR_ETFS = [
  "SPY",
  "XLC",
  "XLY",
  "XLP",
  "XLE",
  "XLF",
  "XLV",
  "XLI",
  "XLB",
  "XLRE",
  "XLK",
  "XLU",
];
const FILLS_PAGE_LIMIT = 2000;
const DEFAULT_MAX_USER_FILLS = 4000;

const cache = new Map();
const inFlight = new Map();

const windowKeys = ["day", "week", "month", "allTime"];
const IMAGE_PROXY_HOST_ALLOWLIST = new Set([
  "twproxy.twproxy.workers.dev",
  "pbs.twimg.com",
  "abs.twimg.com",
]);
const BINANCE_KLINE_INTERVALS = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
]);

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function withUnloadAllowedPermissionsPolicy(headers) {
  const existing = headers.get("permissions-policy");
  if (!existing) {
    headers.set("Permissions-Policy", "unload=(self)");
    return;
  }

  if (/\bunload\s*=/.test(existing)) {
    headers.set(
      "Permissions-Policy",
      existing.replace(/\bunload\s*=\s*([^,;]+)/, "unload=(self)"),
    );
    return;
  }

  headers.set("Permissions-Policy", `${existing}, unload=(self)`);
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

async function cachedWithStaleRevalidate(key, ttlMs, maxStaleMs, fetcher) {
  const now = Date.now();
  const entry = cache.get(key);

  if (entry && now <= entry.expiresAt) {
    return entry.value;
  }

  // Return slightly stale data immediately and refresh in background.
  if (entry && now - entry.expiresAt <= maxStaleMs) {
    if (!inFlight.has(key)) {
      const refreshPromise = Promise.resolve()
        .then(fetcher)
        .then((value) => setCached(key, value, ttlMs))
        .catch(() => entry.value)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, refreshPromise);
    }
    return entry.value;
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const fetchPromise = Promise.resolve()
    .then(fetcher)
    .then((value) => setCached(key, value, ttlMs))
    .finally(() => inFlight.delete(key));
  inFlight.set(key, fetchPromise);
  return fetchPromise;
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

function toImageProxyPath(rawUrl) {
  if (typeof rawUrl !== "string") return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed) return rawUrl;
  if (/^\/api\/image-proxy\?url=/.test(trimmed)) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return rawUrl;
  return `/api/image-proxy?url=${encodeURIComponent(trimmed)}`;
}

function rewriteNewsImageUrls(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (!Array.isArray(payload.items)) return payload;

  const keys = ["icon", "avatar", "image", "profileImage", "profile_image"];
  return {
    ...payload,
    items: payload.items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const next = { ...item };
      for (const key of keys) {
        if (typeof next[key] === "string") {
          next[key] = toImageProxyPath(next[key]);
        }
      }
      return next;
    }),
  };
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

async function handleBreakoutRatios(symbol, bypassCache) {
  const normalized = String(symbol ?? "").trim().toUpperCase();
  if (!normalized) {
    throw new Error("Missing symbol");
  }
  const key = `market:ratios:${normalized}`;
  const data = await cachedWithBypass(
    key,
    breakoutpropTtlMs,
    async () => {
      return fetchJson(`${BREAKOUTPROP_API}/ratios/${encodeURIComponent(normalized)}`);
    },
    bypassCache,
  );
  return jsonResponse(data);
}

async function handleBreakoutOpenInterest(symbol, bypassCache) {
  const normalized = String(symbol ?? "").trim().toUpperCase();
  if (!normalized) {
    throw new Error("Missing symbol");
  }
  const key = `market:open-interest:${normalized}`;
  const data = await cachedWithBypass(
    key,
    breakoutpropTtlMs,
    async () => {
      return fetchJson(
        `${BREAKOUTPROP_API}/open-interest/${encodeURIComponent(normalized)}`,
      );
    },
    bypassCache,
  );
  return jsonResponse(data);
}

async function handleBreakoutSnapshot(bypassCache) {
  const key = "market:snapshot";
  const data = await cachedWithBypass(
    key,
    breakoutpropTtlMs,
    async () => {
      return fetchJson(`${BREAKOUTPROP_API}/snapshot`);
    },
    bypassCache,
  );
  return jsonResponse(data);
}

async function handleBreakoutNews(url, bypassCache) {
  const query = url.search || "";
  const key = `market:news:${query}`;
  const data = await cachedWithBypass(
    key,
    breakoutpropTtlMs,
    async () => {
      return fetchJson(`${BREAKOUTPROP_API}/news${query}`);
    },
    bypassCache,
  );
  return jsonResponse(rewriteNewsImageUrls(data));
}

async function handleImageProxy(url) {
  const target = url.searchParams.get("url");
  if (!target) {
    return jsonResponse({ error: "Missing url" }, 400);
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return jsonResponse({ error: "Invalid url" }, 400);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return jsonResponse({ error: "Unsupported protocol" }, 400);
  }

  if (!IMAGE_PROXY_HOST_ALLOWLIST.has(parsed.hostname)) {
    return jsonResponse({ error: "Host not allowed" }, 403);
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0",
      },
    });
    if (!upstream.ok) {
      return jsonResponse(
        { error: `Upstream image request failed (${upstream.status})` },
        502,
      );
    }

    const headers = new Headers();
    const upstreamType = upstream.headers.get("content-type");
    headers.set("Content-Type", upstreamType || "image/jpeg");
    headers.set("Cache-Control", `public, max-age=${imageProxyTtlSeconds}`);
    headers.set("X-Proxy-Origin", parsed.origin);
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return jsonResponse({ error: `Image proxy failed: ${String(error)}` }, 502);
  }
}

async function handleMarketRatios(bypassCache) {
  return handleBreakoutRatios("HYPEUSD", bypassCache);
}

async function handleMarketOpenInterest(bypassCache) {
  return handleBreakoutOpenInterest("HYPEUSD", bypassCache);
}

async function handleMarketSnapshot(bypassCache) {
  return handleBreakoutSnapshot(bypassCache);
}

async function fetchMarketBinance24h() {
  const rows = await fetchJson(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`);
  const symbols = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = String(row?.symbol ?? "").toUpperCase();
    if (!symbol.endsWith("USDT")) continue;
    const base = symbol.slice(0, -4);
    if (!base || !RELATIVE_STRENGTH_BASE_SET.has(base)) continue;
    const key = `${base}/USD`;
    symbols[key] = {
      symbol,
      lastPrice: Number(row?.lastPrice ?? 0),
      priceChangePercent: Number(row?.priceChangePercent ?? 0),
      quoteVolume: Number(row?.quoteVolume ?? 0),
      volume: Number(row?.volume ?? 0),
    };
  }
  return {
    source: "binance",
    updatedAt: Date.now(),
    symbols,
  };
}

async function handleMarketBinance24h(bypassCache) {
  const key = "market:binance-24h";
  const data = await cachedWithBypass(
    key,
    5 * 1000,
    async () => fetchMarketBinance24h(),
    bypassCache,
  );
  return jsonResponse(data);
}

function normalizeMarketSymbol(rawSymbol) {
  const raw = String(rawSymbol ?? "").trim().toUpperCase();
  if (!raw) {
    throw new Error("Missing symbol");
  }

  const cleaned = raw.replace(/\s+/g, "");
  const plain = cleaned.replace(/[^A-Z0-9]/g, "");
  if (!plain) {
    throw new Error("Invalid symbol");
  }

  if (plain.endsWith("USDT")) {
    const base = plain.slice(0, -4);
    return {
      base,
      breakout: `${base}USD`,
      binance: `${base}USDT`,
      pair: `${base}/USD`,
    };
  }

  if (plain.endsWith("USD")) {
    const base = plain.slice(0, -3);
    return {
      base,
      breakout: `${base}USD`,
      binance: `${base}USDT`,
      pair: `${base}/USD`,
    };
  }

  const base = plain;
  return {
    base,
    breakout: `${base}USD`,
    binance: `${base}USDT`,
    pair: `${base}/USD`,
  };
}

function normalizeKlineInterval(rawInterval) {
  const interval = String(rawInterval ?? "1h").trim();
  if (BINANCE_KLINE_INTERVALS.has(interval)) {
    return interval;
  }
  return "1h";
}

function normalizePositiveInt(rawValue, fallback, min, max) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

async function handleSymbolKlines(symbol, url, bypassCache) {
  const normalized = normalizeMarketSymbol(symbol);
  const interval = normalizeKlineInterval(url.searchParams.get("interval"));
  const limit = normalizePositiveInt(url.searchParams.get("limit"), 220, 50, 1000);
  const key = `market:klines:${normalized.binance}:${interval}:${limit}`;

  const data = await cachedWithBypass(
    key,
    klineTtlMs,
    async () => {
      const raw = await fetchJson(
        `${BINANCE_FAPI}/fapi/v1/klines?symbol=${normalized.binance}&interval=${interval}&limit=${limit}`,
      );
      const candles = (Array.isArray(raw) ? raw : [])
        .map((row) => ({
          time: Number(row?.[6]),
          open: Number(row?.[1]),
          high: Number(row?.[2]),
          low: Number(row?.[3]),
          close: Number(row?.[4]),
          volume: Number(row?.[5]),
        }))
        .filter(
          (row) =>
            Number.isFinite(row.time) &&
            Number.isFinite(row.open) &&
            Number.isFinite(row.high) &&
            Number.isFinite(row.low) &&
            Number.isFinite(row.close) &&
            Number.isFinite(row.volume),
        );
      if (!candles.length) {
        throw new Error("No candle data");
      }
      return {
        source: "binance",
        symbol: normalized.breakout,
        binanceSymbol: normalized.binance,
        pair: normalized.pair,
        interval,
        updatedAt: Date.now(),
        candles,
      };
    },
    bypassCache,
  );

  return jsonResponse(data);
}

async function handleAssetHeader(symbol, bypassCache) {
  const normalized = normalizeMarketSymbol(symbol);
  const key = `asset:header:binance:${normalized.binance}`;
  const data = await cachedWithBypass(
    key,
    assetHeaderTtlMs,
    async () => {
      const [ticker24h, openInterestPayload] = await Promise.all([
        fetchJson(
          `${BINANCE_FAPI}/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(normalized.binance)}`,
        ),
        fetchJson(
          `${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${encodeURIComponent(normalized.binance)}`,
        ),
      ]);

      const lastPrice = Number(ticker24h?.lastPrice ?? NaN);
      const changePctRaw = Number(ticker24h?.priceChangePercent ?? NaN);
      const quoteVolume24h = Number(ticker24h?.quoteVolume ?? NaN);
      const openInterest = Number(openInterestPayload?.openInterest ?? NaN);

      const safeLastPrice = Number.isFinite(lastPrice) ? lastPrice : null;
      const safeChangePct = Number.isFinite(changePctRaw) ? changePctRaw : null;
      const openInterestRaw = Number.isFinite(openInterest) ? openInterest : null;
      const openInterestUsd =
        openInterestRaw != null && safeLastPrice != null
          ? openInterestRaw * safeLastPrice
          : null;

      return {
        source: "binance",
        symbol: normalized.breakout,
        pair: normalized.pair,
        updatedAt: Date.now(),
        last: safeLastPrice,
        changePct: safeChangePct,
        volume24h: Number.isFinite(quoteVolume24h) ? quoteVolume24h : null,
        openInterest: openInterestRaw,
        openInterestUsd,
      };
    },
    bypassCache,
  );
  return jsonResponse(data);
}

function normalizeDepthLevels(levels, bidSide) {
  const out = (Array.isArray(levels) ? levels : [])
    .map((row) => {
      const price = Number(row?.price ?? row?.px ?? row?.[0]);
      const size = Number(row?.size ?? row?.sz ?? row?.[1]);
      if (!Number.isFinite(price) || !Number.isFinite(size)) return null;
      return { price, size: Math.max(0, size) };
    })
    .filter(Boolean);

  out.sort((a, b) => (bidSide ? b.price - a.price : a.price - b.price));
  return out;
}

async function fetchDepthBinance(symbol = "HYPEUSDT") {
  const raw = await fetchJson(
    `${BINANCE_FAPI}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=500`,
  );
  const bids = normalizeDepthLevels(raw?.bids, true);
  const asks = normalizeDepthLevels(raw?.asks, false);
  if (!bids.length || !asks.length) {
    throw new Error("Binance depth empty");
  }
  return {
    source: "binance",
    symbol,
    updatedAt: Date.now(),
    bids,
    asks,
  };
}

async function handleSymbolDepth(symbol, bypassCache) {
  const normalized = normalizeMarketSymbol(symbol);
  const key = `market:depth:${normalized.binance}`;
  const data = await cachedWithBypass(
    key,
    depthTtlMs,
    async () => {
      const depth = await fetchDepthBinance(normalized.binance);
      return {
        ...depth,
        symbol: normalized.breakout,
        binanceSymbol: normalized.binance,
        pair: normalized.pair,
      };
    },
    bypassCache,
  );
  return jsonResponse(data);
}

async function handleMarketDepth(bypassCache) {
  const key = "market:depth:hype";
  const data = await cachedWithBypass(
    key,
    depthTtlMs,
    async () => {
      return fetchDepthBinance("HYPEUSDT");
    },
    bypassCache,
  );
  return jsonResponse(data);
}

function toRelativeStrengthPayloadFromRows(rows) {
  const sortedRows = (Array.isArray(rows) ? rows : [])
    .filter(
      (row) => Number.isFinite(Number(row?.time)) && Number.isFinite(Number(row?.close)),
    )
    .sort((a, b) => Number(a.time) - Number(b.time));

  if (sortedRows.length < 2) return null;
  const trimmed = sortedRows.slice(-96);
  const first = Number(trimmed[0]?.close);
  const last = Number(trimmed[trimmed.length - 1]?.close);
  const changePct =
    Number.isFinite(first) && Number.isFinite(last) && first !== 0
      ? ((last - first) / first) * 100
      : null;

  return {
    sparkline: trimmed.map((row) => Number(row.close)),
    times: trimmed.map((row) => Number(row.time)),
    change_pct: Number.isFinite(changePct) ? changePct : null,
    last_price: Number.isFinite(last) ? last : null,
  };
}

async function fetchRelativeStrengthYahooSymbols() {
  const results = new Map();

  await Promise.all(
    RELATIVE_STRENGTH_SECTOR_ETFS.map(async (base) => {
      try {
        const payload = await fetchJson(
          `${YAHOO_FINANCE_CHART}/${encodeURIComponent(
            base,
          )}?interval=15m&range=5d&includePrePost=false&events=history`,
        );
        const result = payload?.chart?.result?.[0] ?? null;
        const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
        const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
          ? result.indicators.quote[0].close
          : [];

        const rows = [];
        const length = Math.min(timestamps.length, closes.length);
        for (let index = 0; index < length; index += 1) {
          const close = Number(closes[index]);
          const time = Number(timestamps[index]) * 1000;
          if (!Number.isFinite(close) || !Number.isFinite(time)) continue;
          rows.push({ close, time });
        }

        const normalized = toRelativeStrengthPayloadFromRows(rows);
        if (normalized) {
          results.set(`${base}/USD`, normalized);
        }
      } catch {
        // Ignore per-symbol errors; keep best-effort dataset.
      }
    }),
  );

  return results;
}

async function fetchRelativeStrengthBinance() {
  const tickers = await fetchJson(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`);
  const list = Array.isArray(tickers) ? tickers : [];

  const tickerMap = new Map(
    list
      .filter((t) => String(t?.symbol ?? "").endsWith("USDT"))
      .map((t) => [String(t.symbol), t]),
  );

  const symbols = [];
  const missing = [];
  for (const base of RELATIVE_STRENGTH_BASES) {
    const sym = `${base}USDT`;
    if (tickerMap.has(sym)) symbols.push(sym);
    else missing.push(base);
  }

  const eligible = list
    .filter((t) => String(t?.symbol ?? "").endsWith("USDT"))
    .map((t) => ({
      symbol: String(t.symbol),
      quoteVolume: Number(t.quoteVolume ?? 0),
      changePct: Number(t.priceChangePercent ?? 0),
      lastPrice: Number(t.lastPrice ?? 0),
    }))
    .filter((t) => Number.isFinite(t.quoteVolume))
    .sort((a, b) => b.quoteVolume - a.quoteVolume);

  const eligibleMap = new Map(eligible.map((t) => [t.symbol, t]));

  const concurrency = 16;
  const cryptoResults = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < symbols.length) {
      const idx = cursor++;
      const symbol = symbols[idx];
      try {
        const klines = await fetchJson(
          `${BINANCE_FAPI}/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=96`,
        );
        const rows = (Array.isArray(klines) ? klines : [])
          .map((k) => ({
            close: Number(k?.[4]),
            // close time in ms (binance kline index 6)
            time: Number(k?.[6]),
          }))
          .filter((r) => Number.isFinite(r.close) && Number.isFinite(r.time));
        if (rows.length < 2) continue;

        const base = symbol.endsWith("USDT")
          ? symbol.slice(0, -4)
          : symbol;
        const key = `${base}/USD`;
        const t = eligibleMap.get(symbol);
        const normalized = toRelativeStrengthPayloadFromRows(rows);
        if (!normalized) continue;
        cryptoResults.set(key, {
          ...normalized,
          change_pct: Number.isFinite(t?.changePct) ? t.changePct : normalized.change_pct,
          last_price: Number.isFinite(t?.lastPrice) ? t.lastPrice : normalized.last_price,
        });
      } catch {
        // Ignore per-symbol errors; keep best-effort dataset.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, symbols.length) }, () =>
      worker(),
    ),
  );

  const macroResults = await fetchRelativeStrengthYahooSymbols();

  const results = new Map(cryptoResults);
  for (const [symbol, payload] of macroResults.entries()) {
    results.set(symbol, payload);
  }

  if (!results.size) {
    throw new Error("No relative-strength symbols available");
  }

  const missingMacroBases = RELATIVE_STRENGTH_SECTOR_ETFS.filter(
    (base) => !macroResults.has(`${base}/USD`),
  );

  return {
    source: "binance+yahoo",
    updatedAt: Date.now(),
    interval: "15m",
    count: 96,
    requestedBases: RELATIVE_STRENGTH_BASES,
    requestedMacroBases: RELATIVE_STRENGTH_SECTOR_ETFS,
    missingBases: missing,
    missingMacroBases,
    symbols: Object.fromEntries(results.entries()),
  };
}

async function handleMarketRelativeStrength(bypassCache) {
  const key = "market:relative-strength";
  const data = bypassCache
    ? await cachedWithBypass(
        key,
        relativeStrengthTtlMs,
        async () => fetchRelativeStrengthBinance(),
        true,
      )
    : await cachedWithStaleRevalidate(
        key,
        relativeStrengthTtlMs,
        10 * 60 * 1000, // serve stale up to 10m while refreshing
        async () => fetchRelativeStrengthBinance(),
      );
  return jsonResponse(data);
}

async function proxyToRemote(req, targetUrl) {
  try {
    const headers = new Headers(req.headers);
    headers.delete("host");
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : req.body,
      redirect: "follow",
    });
    const responseHeaders = new Headers(upstream.headers);
    // Bun/Fetch may return a decoded body while preserving upstream encoding
    // headers; strip them to avoid browser double-decoding failures.
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");
    withUnloadAllowedPermissionsPolicy(responseHeaders);
    responseHeaders.set("x-proxy-origin", REMOTE_ORIGIN);

    const contentType = upstream.headers.get("content-type") ?? "";
    if (req.method !== "HEAD" && contentType.includes("text/html")) {
      const html = await upstream.text();
      const injected = injectUnloadGuardEarly(html);
      responseHeaders.set("content-type", "text/html; charset=utf-8");
      return new Response(injected, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return jsonResponse({ error: `Upstream proxy failed: ${String(error)}` }, 502);
  }
}

const UNLOAD_GUARD_INJECT = `<script>
(() => {
  const origAdd = EventTarget && EventTarget.prototype && EventTarget.prototype.addEventListener;
  if (!origAdd) return;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === "unload") return;
    return origAdd.call(this, type, listener, options);
  };
})();
</script>`;

function injectUnloadGuardEarly(html) {
  if (
    html.includes(
      "EventTarget.prototype.addEventListener = function(type, listener, options)",
    )
  ) {
    return html;
  }

  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${UNLOAD_GUARD_INJECT}`);
  }

  return html.replace("</head>", `${UNLOAD_GUARD_INJECT}</head>`);
}

async function handleApi(req, url) {
  if (req.method !== "GET") {
    return null;
  }

  const bypassCache = shouldBypassCache(url);

  if (url.pathname.startsWith("/api/ratios/")) {
    const symbol = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    try {
      return await handleBreakoutRatios(symbol, bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname.startsWith("/api/open-interest/")) {
    const symbol = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    try {
      return await handleBreakoutOpenInterest(symbol, bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname.startsWith("/api/klines/")) {
    const symbol = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    try {
      return await handleSymbolKlines(symbol, url, bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname.startsWith("/api/depth/")) {
    const symbol = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    try {
      return await handleSymbolDepth(symbol, bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname.startsWith("/api/asset-header/")) {
    const symbol = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    try {
      return await handleAssetHeader(symbol, bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/snapshot") {
    try {
      return await handleBreakoutSnapshot(bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/news") {
    try {
      return await handleBreakoutNews(url, bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/image-proxy") {
    return handleImageProxy(url);
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

  if (url.pathname === "/api/market/ratios") {
    try {
      return await handleMarketRatios(bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/market/open-interest") {
    try {
      return await handleMarketOpenInterest(bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/market/snapshot") {
    try {
      return await handleMarketSnapshot(bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/market/depth") {
    try {
      return await handleMarketDepth(bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/market/relative-strength") {
    try {
      return await handleMarketRelativeStrength(bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  if (url.pathname === "/api/market/binance-24h") {
    try {
      return await handleMarketBinance24h(bypassCache);
    } catch (error) {
      return jsonResponse({ error: String(error) }, 502);
    }
  }

  return null;
}

const WALLET_PATH_REGEX = /^\/wallets\/(0x[a-fA-F0-9]{40})\/?$/;
const PRETTY_HTML_ROUTES = new Map([
  ["/about", "about.html"],
  ["/heatmap", "heatmap.html"],
  ["/liquidations", "liquidations.html"],
  ["/perpetuals", "perpetuals.html"],
  ["/settings", "settings.html"],
  ["/unstaking", "unstaking.html"],
  ["/wallet", "wallet.html"],
]);

function toLocalPath(pathname) {
  const normalized =
    pathname !== "/" && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  if (normalized === "/") return null;
  if (PRETTY_HTML_ROUTES.has(normalized)) {
    return PRETTY_HTML_ROUTES.get(normalized);
  }
  if (WALLET_PATH_REGEX.test(normalized)) {
    return "wallet.html";
  }
  const candidate = normalized.replace(/^\/+/, "");
  if (!candidate || candidate.includes("..")) return null;
  return candidate;
}

function fileResponse(file, localPath = "") {
  const headers = new Headers({
    "Content-Type": file.type || "application/octet-stream",
  });
  if (localPath === "liquidations.html") {
    headers.set("Cache-Control", "public, max-age=86400");
  }

  return new Response(file, { headers });
}

async function serveStatic(pathname) {
  const localPath = toLocalPath(pathname);
  if (!localPath) return null;

  const file = Bun.file(`${import.meta.dir}/${localPath}`);
  if (await file.exists()) {
    return fileResponse(file, localPath);
  }

  return null;
}

async function serveAssetApp() {
  const file = Bun.file(`${import.meta.dir}/web/dist/index.html`);
  if (!(await file.exists())) {
    return new Response(
      "Asset app not built. Run `bun run web:build` and reload this route.",
      { status: 503 },
    );
  }

  return new Response(file, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

Bun.serve({
  port: PORT,
  // Some endpoints (notably userFills backfill) may take >10s if upstream
  // rate-limits; keep the connection open longer.
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return serveAssetApp();
    }

    if (url.pathname === "/trade" || url.pathname.startsWith("/trade/")) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/" },
      });
    }

    if (url.pathname === "/tools" || url.pathname.startsWith("/tools/")) {
      return notFound();
    }
    if (url.pathname === "/calculator" || url.pathname.startsWith("/calculator/")) {
      return notFound();
    }

    if (url.pathname.startsWith("/api/")) {
      const localApiResponse = await handleApi(req, url);
      if (localApiResponse) return localApiResponse;
      return proxyToRemote(req, `${REMOTE_ORIGIN}${url.pathname}${url.search}`);
    }

    if (url.pathname === "/asset" || url.pathname.startsWith("/asset/")) {
      return notFound();
    }

    const localStaticResponse = await serveStatic(url.pathname);
    if (localStaticResponse) return localStaticResponse;

    return proxyToRemote(req, `${REMOTE_ORIGIN}${url.pathname}${url.search}`);
  },
});

console.log(`stats running on http://localhost:${PORT}`);
