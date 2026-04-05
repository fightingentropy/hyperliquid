const QWANTIFY_API = "https://api.qwantify.io/api";

const FORWARDED_ENDPOINTS = [
  /^\/api\/wallets\/resolve$/,
  /^\/api\/wallets\/[^/]+\/notional-deltas$/,
  /^\/api\/analytics\/market-flow\/batch$/,
  /^\/api\/analytics\/market-flow\/summaries$/,
];

function isForwardedPath(pathname: string) {
  return FORWARDED_ENDPOINTS.some((pattern) => pattern.test(pathname));
}

function buildUpstreamUrl(requestUrl: URL) {
  return `${QWANTIFY_API}${requestUrl.pathname.slice("/api".length)}${requestUrl.search}`;
}

function applyCors(headers: Headers, origin: string | null) {
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Vary", "Origin");
}

export async function onRequest(context: { request: Request }) {
  const { request } = context;
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    const headers = new Headers();
    applyCors(headers, origin);
    return new Response(null, { status: 204, headers });
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    const headers = new Headers({ "Content-Type": "application/json" });
    applyCors(headers, origin);
    return new Response(JSON.stringify({ message: "Method not allowed" }), {
      status: 405,
      headers,
    });
  }

  if (!isForwardedPath(url.pathname)) {
    const headers = new Headers({ "Content-Type": "application/json" });
    applyCors(headers, origin);
    return new Response(JSON.stringify({ message: "Not found" }), {
      status: 404,
      headers,
    });
  }

  const upstreamResponse = await fetch(buildUpstreamUrl(url), {
    method: request.method,
    headers: {
      Accept: "application/json",
    },
    cf: {
      cacheEverything: true,
      cacheTtl: 60,
    },
  });

  const headers = new Headers(upstreamResponse.headers);
  headers.set("Cache-Control", "public, max-age=60");
  applyCors(headers, origin);

  return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
}
