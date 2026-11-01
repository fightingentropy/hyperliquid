import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLiquidationMap,
  HYPERLIQUID_LIQUIDATION_SYMBOLS,
  normalizeLiquidationMap,
} from "./liquidations";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchLiquidationMap", () => {
  it("requests the same-origin endpoint with the coin URL-encoded and normalizes the payload", async () => {
    const fetchMock = stubFetch(
      Response.json({
        symbol: "kPEPE",
        price: "0.0049",
        rows: [
          { liquidationPrice: "0.004", size: "-1500000", positionUsd: "7400", updateTime: 1_800_000_000_000 },
          { liquidationPrice: 0.006, size: 250000, positionUsd: 1200, updateTime: null },
        ],
        asOf: 1_800_000_060_000,
        source: "Hyperliquid",
        walletsTracked: 1040,
        lastFullCycleAt: null,
      }),
    );

    const map = await fetchLiquidationMap({ symbol: "kPEPE" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/liquidations/kPEPE");
    expect(map).toEqual({
      symbol: "kPEPE",
      price: 0.0049,
      rows: [
        { liquidationPrice: 0.004, size: -1_500_000, positionUsd: 7400, updateTime: 1_800_000_000_000 },
        { liquidationPrice: 0.006, size: 250_000, positionUsd: 1200, updateTime: null },
      ],
      asOf: 1_800_000_060_000,
      source: "Hyperliquid",
      walletsTracked: 1040,
      lastFullCycleAt: null,
    });
  });

  it("surfaces the API's error message, such as the 503 before the sweeper has run", async () => {
    stubFetch(
      Response.json(
        { code: "liquidations_unavailable", message: "Liquidation data is not available yet." },
        { status: 503 },
      ),
    );

    await expect(fetchLiquidationMap({ symbol: "HYPE" })).rejects.toThrow(
      "Liquidation data is not available yet.",
    );
  });

  it("rejects a response without a usable price", async () => {
    stubFetch(Response.json({ rows: [], price: null }));

    await expect(fetchLiquidationMap({ symbol: "SUI" })).rejects.toThrow(/no current price/);
  });
});

describe("normalizeLiquidationMap", () => {
  it("drops rows without a positive liquidation price or a non-zero size", () => {
    const map = normalizeLiquidationMap(
      {
        price: 100,
        rows: [
          { liquidationPrice: 0, size: 1 },
          { liquidationPrice: -5, size: 1 },
          { liquidationPrice: 90, size: 0 },
          { liquidationPrice: "nope", size: 1 },
          { liquidationPrice: 80, size: -2, positionUsd: 160 },
          null,
        ],
      },
      "BTC",
    );

    expect(map.rows).toEqual([
      { liquidationPrice: 80, size: -2, positionUsd: 160, updateTime: null },
    ]);
    expect(map.source).toBe("Hyperliquid");
    expect(map.walletsTracked).toBeNull();
    expect(map.asOf).toBeNull();
  });

  it("tolerates a missing rows array", () => {
    expect(normalizeLiquidationMap({ price: 5 }, "BTC").rows).toEqual([]);
  });
});

describe("HYPERLIQUID_LIQUIDATION_SYMBOLS", () => {
  it("has no duplicates and excludes coins Hyperliquid delisted", () => {
    expect(new Set(HYPERLIQUID_LIQUIDATION_SYMBOLS).size).toBe(HYPERLIQUID_LIQUIDATION_SYMBOLS.length);
    for (const delisted of ["MKR", "IP", "AI16Z"]) {
      expect(HYPERLIQUID_LIQUIDATION_SYMBOLS).not.toContain(delisted);
    }
    expect(HYPERLIQUID_LIQUIDATION_SYMBOLS).toContain("kPEPE");
  });
});
