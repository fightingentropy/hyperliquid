import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
const publicRoot = path.join(projectRoot, "public");

const SITE_HOST = "www.qwantify.io";
const SITE_ORIGIN = `https://${SITE_HOST}`;
const API_HOST = "api.qwantify.io";
const API_ORIGIN = `https://${API_HOST}`;
const PROXIED_STATIC_PREFIXES = ["/assets/", "/research/"];
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);
const STRIPPED_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-security-policy",
  "content-security-policy-report-only",
  "date",
  "server",
  "x-frame-options",
]);
const CLOUDFLARE_PATTERNS = [
  /<!-- Cloudflare Pages Analytics -->.*?<!-- Cloudflare Pages Analytics -->/gs,
  /<script>\(function\(\)\{function c\(\).*?<\/script>/gs,
];
const INJECTED_SITE_SCRIPT = `
<script>
(() => {
  const API_PREFIX = "https://api.qwantify.io/api";
  const LOCAL_API_PREFIX = \`\${window.location.origin}/api\`;

  const rewriteUrl = (value) => {
    const raw = value instanceof URL ? value.toString() : String(value ?? "");
    return raw.startsWith(API_PREFIX) ? \`\${LOCAL_API_PREFIX}\${raw.slice(API_PREFIX.length)}\` : value;
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" || input instanceof URL) {
      return originalFetch(rewriteUrl(input), init);
    }

    if (input instanceof Request) {
      const nextUrl = rewriteUrl(input.url);
      return originalFetch(nextUrl === input.url ? input : new Request(nextUrl, input), init);
    }

    return originalFetch(input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return originalOpen.call(this, method, rewriteUrl(url), ...rest);
  };

  const blockedTextPatterns = [
    /Use our Hyperliquid referral/i,
    /^Support$/i,
    /^Privacy$/i,
    /^SIGN IN$/i,
    /^SIGN UP$/i,
    /Support Qwantify/i,
  ];

  const hideUnwantedUi = () => {
    for (const el of document.querySelectorAll("a, button, [role='button'], div, section, aside")) {
      const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
      if (!text || !blockedTextPatterns.some((pattern) => pattern.test(text))) {
        continue;
      }

      const target =
        /Use our Hyperliquid referral/i.test(text)
          ? el.closest("a, div, section, aside") || el
          : /Support Qwantify/i.test(text)
            ? el.closest("section, aside, div") || el
            : el;

      target.style.display = "none";
    }

    for (const el of document.querySelectorAll('a[href="https://app.hyperliquid.xyz/join/QWANTIFY"]')) {
      (el.closest("div, section, aside") || el).style.display = "none";
    }
  };

  let rafId = 0;
  const scheduleCleanup = () => {
    if (rafId) {
      return;
    }

    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      hideUnwantedUi();
    });
  };

  const start = () => {
    hideUnwantedUi();
    new MutationObserver(scheduleCleanup).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
</script>
`.trim();

function decodePathname(url) {
  return decodeURIComponent(new URL(url, "http://127.0.0.1").pathname);
}

function hasLocalPublicFile(pathname) {
  const relativePath = pathname.replace(/^\/+/, "");
  if (!relativePath) {
    return false;
  }

  const candidate = path.resolve(publicRoot, relativePath);
  if (!candidate.startsWith(`${publicRoot}${path.sep}`) && candidate !== publicRoot) {
    return false;
  }

  return fs.existsSync(candidate);
}

function shouldProxyMissingSiteAsset(pathname) {
  if (!PROXIED_STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }

  return !hasLocalPublicFile(pathname);
}

function rewriteLocationHeader(value) {
  if (value.startsWith(SITE_ORIGIN)) {
    return value.slice(SITE_ORIGIN.length) || "/";
  }

  return value;
}

function rewriteSiteHtml(payload) {
  let text = payload;
  for (const pattern of CLOUDFLARE_PATTERNS) {
    text = text.replace(pattern, "");
  }

  if (!text.includes(INJECTED_SITE_SCRIPT)) {
    text = text.replace("</body>", `${INJECTED_SITE_SCRIPT}\n</body>`);
  }

  return text;
}

function buildUpstreamHeaders(req, { host, origin, referer }) {
  const headers = new Headers();

  for (const [header, value] of Object.entries(req.headers)) {
    const headerName = header.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(headerName)) {
      continue;
    }
    if (headerName === "host" || headerName === "content-length") {
      continue;
    }
    if (headerName.startsWith("sec-")) {
      continue;
    }
    if (typeof value === "undefined") {
      continue;
    }

    if (headerName === "origin") {
      headers.set(header, origin);
      continue;
    }
    if (headerName === "referer") {
      headers.set(header, referer);
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(header, value.join(", "));
      continue;
    }

    headers.set(header, value);
  }

  headers.set("Host", host);
  headers.set("Origin", origin);
  headers.set("Referer", referer);
  headers.set("X-Forwarded-Host", req.headers.host ?? "");
  headers.set("X-Forwarded-Proto", "http");
  headers.set("Accept-Encoding", "identity");

  return headers;
}

async function sendProxyResponse(req, res, targetUrl, options) {
  const upstreamHeaders = buildUpstreamHeaders(req, options);
  let upstreamResponse;

  try {
    upstreamResponse = await fetch(targetUrl, {
      method: req.method,
      headers: upstreamHeaders,
      redirect: "manual",
    });
  } catch (error) {
    const message = `Upstream proxy error: ${error}\n`;
    res.statusCode = 502;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(message));
    res.end(req.method === "HEAD" ? undefined : message);
    return;
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isHtml = contentType.toLowerCase().includes("text/html");
  let payloadBuffer;

  if (req.method !== "HEAD") {
    if (isHtml) {
      const text = rewriteSiteHtml(await upstreamResponse.text());
      payloadBuffer = Buffer.from(text, "utf8");
    } else {
      payloadBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
    }
  } else {
    payloadBuffer = Buffer.alloc(0);
  }

  res.statusCode = upstreamResponse.status;
  res.statusMessage = upstreamResponse.statusText;

  for (const [header, value] of upstreamResponse.headers) {
    const headerName = header.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(headerName) || STRIPPED_RESPONSE_HEADERS.has(headerName)) {
      continue;
    }
    if (headerName === "location") {
      res.setHeader(header, rewriteLocationHeader(value));
      continue;
    }

    res.setHeader(header, value);
  }

  res.setHeader("Content-Length", payloadBuffer.length);
  res.setHeader("X-Local-Proxy", "qwantify-market-flow");
  res.end(req.method === "HEAD" ? undefined : payloadBuffer);
}

function qwantifyAssetProxyPlugin() {
  return {
    name: "qwantify-asset-dev-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.url ?? "/";
        const pathname = decodePathname(requestUrl);

        if (shouldProxyMissingSiteAsset(pathname)) {
          const targetUrl = `${SITE_ORIGIN}${requestUrl}`;
          await sendProxyResponse(req, res, targetUrl, {
            host: SITE_HOST,
            origin: SITE_ORIGIN,
            referer: SITE_ORIGIN,
          });
          return;
        }

        next();
      });
    },
  };
}

function manualChunks(id) {
  if (!id.includes("node_modules")) {
    return undefined;
  }

  if (
    id.includes("/recharts/") ||
    id.includes("/d3-") ||
    id.includes("/internmap/") ||
    id.includes("/robust-predicates/") ||
    id.includes("/victory-vendor/")
  ) {
    return "charting";
  }

  if (
    id.includes("/react-router/") ||
    id.includes("/react-router-dom/")
  ) {
    return "router";
  }

  if (
    id.includes("/react/") ||
    id.includes("/react-dom/") ||
    id.includes("/scheduler/")
  ) {
    return "react-vendor";
  }

  if (id.includes("/lucide-react/")) {
    return "icons";
  }

  return "vendor";
}

export default defineConfig({
  plugins: [react(), qwantifyAssetProxyPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": {
        target: API_ORIGIN,
        changeOrigin: true,
        headers: {
          Origin: SITE_ORIGIN,
          Referer: `${SITE_ORIGIN}/app/market-flow/`,
          "X-Forwarded-Proto": "http",
        },
      },
    },
  },
});
