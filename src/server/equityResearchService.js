import {
  EquityResearchError,
  buildResearchPayload,
  normalizeIsoDate,
  normalizeTicker,
  parsePriceRows,
  sanitizeHeadlines,
  subtractCalendarDays,
  toEodhdSymbol,
} from "../lib/equityResearch.js";

const EODHD_BASE_URL = "https://eodhd.com/api";
const MAX_REQUEST_BYTES = 4_096;
const PRICE_LOOKBACK_DAYS = 370;
const NEWS_LOOKBACK_DAYS = 30;
const NEWS_LIMIT = 10;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_RETRIES = 2;

/**
 * @param {Request} request
 * @param {any} options
 */
export async function handleEquityResearchRequest(
  request,
  {
    apiToken,
    fetchImpl = fetch,
    cache = null,
    waitUntil = null,
    principal = null,
    providerControl = null,
    upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS,
    sleepImpl = sleep,
    randomImpl = Math.random,
  } = {},
) {
  if (request.method !== "POST") {
    return jsonResponse(
      { error: { code: "method_not_allowed", message: "Method not allowed." } },
      405,
      { Allow: "POST" },
    );
  }

  const originError = validateBrowserOrigin(request);
  if (originError) {
    return originError;
  }

  if (!principal) {
    return jsonResponse(
      { error: { code: "authentication_required", message: "Authentication is required." } },
      401,
    );
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse(
      { error: { code: "request_too_large", message: "The request body is too large." } },
      413,
    );
  }

  if (!String(apiToken ?? "").trim()) {
    return jsonResponse(
      {
        error: {
          code: "provider_not_configured",
          message:
            "Equity research is not configured yet. Add the EODHD_API_TOKEN Cloudflare secret.",
        },
      },
      503,
    );
  }

  try {
    const body = await readJsonBody(request);
    const ticker = normalizeTicker(body?.ticker);
    const asOf = normalizeIsoDate(body?.as_of);
    const benchmark = "SPY";
    const startDate = subtractCalendarDays(asOf, PRICE_LOOKBACK_DAYS);
    const newsStartDate = subtractCalendarDays(asOf, NEWS_LOOKBACK_DAYS);

    const [tickerResult, benchmarkResult, newsResult] = await Promise.all([
      fetchEodhdJson({
        path: `/eod/${encodeURIComponent(toEodhdSymbol(ticker))}`,
        params: {
          from: startDate,
          to: asOf,
          period: "d",
          fmt: "json",
        },
        apiToken,
        fetchImpl,
        cache,
        waitUntil,
        cacheTtlSeconds: historicalCacheTtl(asOf),
        providerControl,
        upstreamTimeoutMs,
        sleepImpl,
        randomImpl,
      }),
      fetchEodhdJson({
        path: `/eod/${encodeURIComponent(toEodhdSymbol(benchmark))}`,
        params: {
          from: startDate,
          to: asOf,
          period: "d",
          fmt: "json",
        },
        apiToken,
        fetchImpl,
        cache,
        waitUntil,
        cacheTtlSeconds: historicalCacheTtl(asOf),
        providerControl,
        upstreamTimeoutMs,
        sleepImpl,
        randomImpl,
      }),
      fetchEodhdJson({
        path: "/news",
        params: {
          s: toEodhdSymbol(ticker),
          from: newsStartDate,
          to: asOf,
          limit: String(NEWS_LIMIT * 3),
          fmt: "json",
        },
        apiToken,
        fetchImpl,
        cache,
        waitUntil,
        cacheTtlSeconds: historicalCacheTtl(asOf),
        optional: true,
        providerControl,
        upstreamTimeoutMs,
        sleepImpl,
        randomImpl,
      }),
    ]);

    const prices = parsePriceRows(tickerResult.rows, asOf);
    const benchmarkPrices = parsePriceRows(benchmarkResult.rows, asOf);
    const headlines = sanitizeHeadlines(newsResult.rows, {
      ticker,
      asOf,
      startDate: newsStartDate,
      limit: NEWS_LIMIT,
    });
    const payload = buildResearchPayload({
      ticker,
      asOf,
      prices,
      benchmarkPrices,
      headlines,
      benchmark,
    });

    return jsonResponse({
      ...payload,
      warnings: newsResult.warning ? [newsResult.warning] : [],
    });
  } catch (error) {
    if (error instanceof EquityResearchError) {
      return jsonResponse(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(
      JSON.stringify({
        message: "equity research request failed",
        error: redactProviderDetails(message),
        path: new URL(request.url).pathname,
      }),
    );
    return jsonResponse(
      {
        error: {
          code: "research_unavailable",
          message: "Equity research is temporarily unavailable.",
        },
      },
      500,
    );
  }
}

async function fetchEodhdJson({
  path,
  params,
  apiToken,
  fetchImpl,
  cache,
  waitUntil,
  cacheTtlSeconds,
  optional = false,
  providerControl = null,
  upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS,
  sleepImpl = sleep,
  randomImpl = Math.random,
}) {
  const sanitizedQuery = new URLSearchParams(params);
  const cacheUrl = `https://equity-research-cache.invalid${path}?${sanitizedQuery.toString()}`;
  const cacheRequest = new Request(cacheUrl);

  if (cache) {
    const cached = await safeCacheMatch(cache, cacheRequest, path);
    if (cached) {
      return {
        rows: await cached.json(),
        warning: null,
      };
    }
  }

  const upstreamQuery = new URLSearchParams(params);
  upstreamQuery.set("api_token", String(apiToken).trim());
  let response = null;
  let lastTransportError = null;

  for (let attempt = 0; attempt <= MAX_PROVIDER_RETRIES; attempt += 1) {
    try {
      await providerControl?.beforeCall?.();
      response = await fetchWithTimeout(
        fetchImpl,
        `${EODHD_BASE_URL}${path}?${upstreamQuery.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "hl-stats-equity-research/1.0",
          },
        },
        upstreamTimeoutMs,
      );
      lastTransportError = null;
    } catch (error) {
      if (error instanceof EquityResearchError) throw error;
      lastTransportError = error;
      await providerControl?.failure?.();
      if (attempt < MAX_PROVIDER_RETRIES) {
        await sleepImpl(retryDelayMs(null, attempt, randomImpl));
        continue;
      }
      break;
    }

    if (response.ok) {
      await providerControl?.success?.();
      break;
    }

    if ((response.status === 429 || response.status >= 500) && attempt < MAX_PROVIDER_RETRIES) {
      await providerControl?.failure?.();
      await cancelResponseBody(response);
      await sleepImpl(retryDelayMs(response.headers.get("Retry-After"), attempt, randomImpl));
      response = null;
      continue;
    }
    break;
  }

  if (!response && lastTransportError) {
    if (optional) {
      return {
        rows: [],
        warning: "Headline context could not be loaded; the deterministic score is unaffected.",
      };
    }
    const timedOut = lastTransportError?.name === "AbortError";
    throw new EquityResearchError(
      timedOut ? "The market-data provider timed out." : "The market-data provider could not be reached.",
      { code: timedOut ? "provider_timeout" : "provider_unreachable", status: 502 },
    );
  }

  if (!response.ok) {
    if (optional) {
      return {
        rows: [],
        warning: "Headline context is unavailable for this run; the deterministic score is unaffected.",
      };
    }

    const status =
      response.status === 429
        ? 429
        : response.status === 401 || response.status === 403
          ? 503
          : 502;
    const code =
      response.status === 429
        ? "provider_rate_limited"
        : response.status === 401 || response.status === 403
          ? "provider_access_denied"
          : "provider_error";
    const message =
      response.status === 429
        ? "The market-data provider is rate-limited. Try again shortly."
        : response.status === 401 || response.status === 403
          ? "The configured market-data subscription cannot access this endpoint."
          : "The market-data provider returned an error.";

    throw new EquityResearchError(message, { code, status });
  }

  let payload;
  try {
    payload = await readBoundedJsonResponse(response, MAX_PROVIDER_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof EquityResearchError) throw error;
    throw new EquityResearchError("The market-data provider returned invalid JSON.", {
      code: "invalid_provider_payload",
      status: 502,
    });
  }

  if (!Array.isArray(payload)) {
    if (optional) {
      return {
        rows: [],
        warning: "Headline context returned an invalid payload; the deterministic score is unaffected.",
      };
    }
    throw new EquityResearchError("The market-data provider returned an invalid payload.", {
      code: "invalid_provider_payload",
      status: 502,
    });
  }

  if (cache) {
    const write = cache.put(
      cacheRequest,
      jsonResponse(payload, 200, {
        "Cache-Control": `public, max-age=${cacheTtlSeconds}`,
      }),
    );
    const guardedWrite = write.catch(() => {
      logCacheWarning("write", path);
    });

    if (typeof waitUntil === "function") {
      waitUntil(guardedWrite);
    } else {
      await guardedWrite;
    }
  }

  return {
    rows: payload,
    warning: null,
  };
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedJsonResponse(response, maxBytes) {
  const contentLength = Number(response.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelResponseBody(response);
    throw new EquityResearchError("The market-data provider response is too large.", {
      code: "provider_response_too_large",
      status: 502,
    });
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new EquityResearchError("The market-data provider response is too large.", {
        code: "provider_response_too_large",
        status: 502,
      });
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

async function cancelResponseBody(response) {
  await response.body?.cancel().catch(() => undefined);
}

function retryDelayMs(retryAfter, attempt, randomImpl) {
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(2_000, retryAfterSeconds * 1_000);
  }
  return Math.min(2_000, 250 * (2 ** attempt) + Math.floor(randomImpl() * 100));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJsonBody(request) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new EquityResearchError("Send the request as application/json.", {
      code: "invalid_content_type",
      status: 415,
    });
  }

  let text;
  try {
    text = await readBoundedBodyText(request);
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof EquityResearchError) {
      throw error;
    }
    throw new EquityResearchError("The request body is not valid JSON.", {
      code: "invalid_json",
      status: 400,
    });
  }
}

async function readBoundedBodyText(request) {
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new EquityResearchError("The request body is too large.", {
        code: "request_too_large",
        status: 413,
      });
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function safeCacheMatch(cache, request, path) {
  try {
    return await cache.match(request);
  } catch {
    logCacheWarning("read", path);
    return null;
  }
}

function logCacheWarning(operation, path) {
  console.warn(
    JSON.stringify({
      message: `equity research cache ${operation} failed`,
      path,
    }),
  );
}

function validateBrowserOrigin(request) {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  const requestOrigin = new URL(request.url).origin;

  if (origin && origin !== requestOrigin) {
    return jsonResponse(
      { error: { code: "forbidden_origin", message: "Cross-origin requests are not allowed." } },
      403,
    );
  }

  if (fetchSite === "cross-site") {
    return jsonResponse(
      { error: { code: "forbidden_origin", message: "Cross-site requests are not allowed." } },
      403,
    );
  }

  return null;
}

function historicalCacheTtl(asOf) {
  return asOf < new Date().toISOString().slice(0, 10) ? 30 * 24 * 60 * 60 : 15 * 60;
}

function redactProviderDetails(value) {
  return String(value)
    .replace(/api_token=[^&\s]+/gi, "api_token=[redacted]")
    .replace(/https?:\/\/\S+/gi, "[provider-url]");
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
