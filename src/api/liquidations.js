import { requestJson } from "./request";

export { HYPERLIQUID_LIQUIDATION_SYMBOLS } from "../lib/liquidationSymbols";

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLiquidationRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => ({
      liquidationPrice: toFiniteNumber(row?.liquidationPrice),
      size: toFiniteNumber(row?.size),
      positionUsd: toFiniteNumber(row?.positionUsd),
      updateTime: toFiniteNumber(row?.updateTime),
    }))
    .filter(
      (row) =>
        row.liquidationPrice !== null &&
        row.liquidationPrice > 0 &&
        row.size !== null &&
        row.size !== 0,
    );
}

export function normalizeLiquidationMap(payload, symbol) {
  const price = toFiniteNumber(payload?.price);

  if (price === null || price <= 0) {
    throw new Error("The liquidation map response has no current price.");
  }

  return {
    symbol,
    price,
    rows: normalizeLiquidationRows(payload?.rows),
    asOf: toFiniteNumber(payload?.asOf),
    source: typeof payload?.source === "string" ? payload.source : "Hyperliquid",
    walletsTracked: toFiniteNumber(payload?.walletsTracked),
    lastFullCycleAt: toFiniteNumber(payload?.lastFullCycleAt),
  };
}

export async function fetchLiquidationMap({ symbol }) {
  const payload = await requestJson(`/api/liquidations/${encodeURIComponent(symbol)}`, {
    headers: { Accept: "application/json" },
  });

  return normalizeLiquidationMap(payload, symbol);
}
