import { isTrackedLiquidationSymbol } from "../lib/liquidationSymbols.js";

// Read side of the liquidation map: serves what workers/liq-sweeper wrote to D1.

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function jsonResponse(body, status, headers = {}, method = "GET") {
  return new Response(method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function errorResponse(code, message, status, headers = {}, method = "GET") {
  return jsonResponse({ code, message }, status, { "Cache-Control": "no-store", ...headers }, method);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function decodeCoin(rawCoin) {
  const value = Array.isArray(rawCoin) ? rawCoin[0] : rawCoin;
  if (typeof value !== "string") {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export async function handleLiquidationRequest(request, { coin: rawCoin, db }) {
  const method = request.method;

  if (method !== "GET" && method !== "HEAD") {
    return errorResponse("method_not_allowed", "Method not allowed.", 405, { Allow: "GET, HEAD" });
  }

  const coin = decodeCoin(rawCoin);
  if (!isTrackedLiquidationSymbol(coin)) {
    return errorResponse("unknown_coin", "Unknown liquidation-map coin.", 404, {}, method);
  }

  const unavailable = () =>
    errorResponse(
      "liquidations_unavailable",
      "Liquidation data is not available yet: the liquidation sweeper has not written any data. Apply migration 0002 and deploy hl-liquidation-sweeper, then retry in a few minutes.",
      503,
      { "Retry-After": "60" },
      method,
    );

  if (!db) {
    return unavailable();
  }

  let results;
  try {
    results = await db.batch([
      db.prepare("SELECT mid, updated_at FROM liq_prices WHERE coin = ?1").bind(coin),
      db
        .prepare(
          "SELECT liquidation_px, size, position_usd, snapshot_time FROM liq_positions WHERE coin = ?1 ORDER BY liquidation_px ASC",
        )
        .bind(coin),
      db.prepare(
        "SELECT key, value FROM liq_meta WHERE key IN ('wallets_total', 'last_full_cycle_at')",
      ),
    ]);
  } catch {
    // Most likely migration 0002 has not been applied to this database yet.
    return unavailable();
  }

  const price = results[0]?.results?.[0];
  const mid = toNumber(price?.mid);
  if (mid === null) {
    return unavailable();
  }

  const meta = new Map((results[2]?.results ?? []).map((row) => [row.key, row.value]));
  const rows = (results[1]?.results ?? []).map((row) => ({
    liquidationPrice: Number(row.liquidation_px),
    size: Number(row.size),
    positionUsd: Number(row.position_usd),
    updateTime: Number(row.snapshot_time),
  }));

  return jsonResponse(
    {
      symbol: coin,
      price: mid,
      rows,
      asOf: toNumber(price.updated_at),
      source: "Hyperliquid",
      walletsTracked: toNumber(meta.get("wallets_total")),
      lastFullCycleAt: toNumber(meta.get("last_full_cycle_at")),
    },
    200,
    { "Cache-Control": "public, max-age=60" },
    method,
  );
}
