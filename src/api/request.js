const REQUEST_CACHE = new Map();
const IN_FLIGHT_REQUESTS = new Map();

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
    requestPromise.finally(() => {
      if (IN_FLIGHT_REQUESTS.get(cacheKey) === requestPromise) {
        IN_FLIGHT_REQUESTS.delete(cacheKey);
      }
    });
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
