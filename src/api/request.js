const REQUEST_CACHE = new Map();
const IN_FLIGHT_REQUESTS = new Map();
const REQUEST_CACHE_MAX_ENTRIES = 200;

function buildRequestCacheKey(url, init) {
  const method = String(init?.method ?? "GET").toUpperCase();
  const headers = init?.headers ? JSON.stringify(init.headers) : "";
  const body =
    typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : "";

  return `${method}:${url}:${headers}:${body}`;
}

function readCachedJson(cacheKey) {
  const cachedEntry = REQUEST_CACHE.get(cacheKey);
  if (!cachedEntry) {
    return undefined;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    REQUEST_CACHE.delete(cacheKey);
    return undefined;
  }

  return cachedEntry.data;
}

function writeCachedJson(cacheKey, data, cacheTtlMs) {
  REQUEST_CACHE.set(cacheKey, {
    data,
    expiresAt: Date.now() + cacheTtlMs,
  });

  pruneRequestCache();
}

function pruneRequestCache() {
  const now = Date.now();

  for (const [cacheKey, cachedEntry] of REQUEST_CACHE.entries()) {
    if (cachedEntry.expiresAt <= now) {
      REQUEST_CACHE.delete(cacheKey);
    }
  }

  if (REQUEST_CACHE.size <= REQUEST_CACHE_MAX_ENTRIES) {
    return;
  }

  const oldestEntries = [...REQUEST_CACHE.entries()].sort(
    (left, right) => left[1].expiresAt - right[1].expiresAt,
  );
  const removeCount = REQUEST_CACHE.size - REQUEST_CACHE_MAX_ENTRIES;

  oldestEntries.slice(0, removeCount).forEach(([cacheKey]) => {
    REQUEST_CACHE.delete(cacheKey);
  });
}

export async function requestJson(url, init, options = {}) {
  const { cacheTtlMs = 0, dedupe = true } = options;
  const cacheKey = cacheTtlMs > 0 || dedupe ? buildRequestCacheKey(url, init) : null;

  if (cacheKey && cacheTtlMs > 0) {
    const cachedData = readCachedJson(cacheKey);
    if (cachedData !== undefined) {
      return cachedData;
    }
  }

  if (cacheKey && dedupe) {
    const inFlightRequest = IN_FLIGHT_REQUESTS.get(cacheKey);
    if (inFlightRequest) {
      return inFlightRequest;
    }
  }

  const requestPromise = fetch(url, init).then(async (response) => {
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(message);
    }

    const payload = await response.json();
    if (cacheKey && cacheTtlMs > 0) {
      writeCachedJson(cacheKey, payload, cacheTtlMs);
    }

    return payload;
  });

  if (cacheKey && dedupe) {
    IN_FLIGHT_REQUESTS.set(cacheKey, requestPromise);
    const cleanup = () => {
      if (IN_FLIGHT_REQUESTS.get(cacheKey) === requestPromise) {
        IN_FLIGHT_REQUESTS.delete(cacheKey);
      }
    };
    requestPromise.then(cleanup, cleanup);
  }

  return requestPromise;
}

async function readErrorMessage(response) {
  try {
    const payload = await response.text();
    if (!payload) {
      return `${response.status} ${response.statusText}`;
    }

    try {
      const parsed = JSON.parse(payload);
      return parsed?.message || payload || `${response.status} ${response.statusText}`;
    } catch {
      return payload || `${response.status} ${response.statusText}`;
    }
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export function withQuery(pathname, query) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, `${value}`);
    }
  });

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}
