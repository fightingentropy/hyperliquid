import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAllClearinghouseStates,
  fetchRelativeStrengthMarkets,
  fetchRelativeStrengthUniverse,
} from "./hyperliquid";

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function errorResponse(message) {
  return {
    ok: false,
    status: 502,
    statusText: "Bad Gateway",
    text: async () => message,
  };
}

function makeCandles(basePrice = 100) {
  return [0, 1, 2, 3].map((hour) => ({
    t: 1_700_000_000_000 + hour * 3_600_000,
    c: String(basePrice + hour),
  }));
}

function stubRelativeStrengthApi() {
  const fetchMock = vi.fn(async (_url, init) => {
    const payload = JSON.parse(init.body);

    if (payload.type === "metaAndAssetCtxs" && !payload.dex) {
      return jsonResponse([
        { universe: [{ name: "BTC" }, { name: "HYPE" }, { name: "ETH" }] },
        [
          { dayNtlVlm: "500000000", openInterest: "100", midPx: "90000" },
          { dayNtlVlm: "200000000", openInterest: "100", midPx: "30" },
          { dayNtlVlm: "150000000", openInterest: "100", midPx: "3000" },
        ],
      ]);
    }

    if (payload.type === "metaAndAssetCtxs" && payload.dex === "xyz") {
      return jsonResponse([
        {
          universe: [
            { name: "xyz:SNDK" },
            { name: "xyz:NVDA" },
            { name: "xyz:SP500" },
            { name: "xyz:AMZN" },
          ],
        },
        [
          { dayNtlVlm: "900000000", openInterest: "100", midPx: "80" },
          { dayNtlVlm: "400000000", openInterest: "100", midPx: "140" },
          { dayNtlVlm: "300000000", openInterest: "100", midPx: "6000" },
          { dayNtlVlm: "100000000", openInterest: "100", midPx: "200" },
        ],
      ]);
    }

    if (payload.type === "candleSnapshot") {
      return jsonResponse(makeCandles(100));
    }

    return errorResponse(`unexpected request: ${payload.type}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Hyperliquid aggregate API helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws instead of silently dropping failed DEX clearinghouse requests", async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);

      if (payload.dex === "xyz") {
        return errorResponse("xyz failed");
      }

      return jsonResponse({
        marginSummary: {
          accountValue: "0",
          totalNtlPos: "0",
        },
        withdrawable: "0",
        assetPositions: [],
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAllClearinghouseStates({
        user: "0x0000000000000000000000000000000000000001",
      }),
    ).rejects.toThrow("xyz");
  });
});

describe("Relative strength universe selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("omits SNDK from the auto universe even with top volume or a stale benchmark, while keeping it selectable", async () => {
    stubRelativeStrengthApi();

    const combined = await fetchRelativeStrengthUniverse({
      marketScope: "combined",
      limit: 5,
      benchmarkSymbol: "SNDK",
    });

    expect(combined.assets.map((asset) => asset.symbol)).not.toContain("SNDK");
    expect(combined.assets).toHaveLength(5);
    expect(combined.markets.map((market) => market.symbol)).toContain("SNDK");

    const tradfi = await fetchRelativeStrengthUniverse({
      marketScope: "tradfi",
      limit: 3,
      benchmarkSymbol: "SNDK",
    });

    expect(tradfi.assets.map((asset) => asset.symbol)).toEqual(["SPX", "NVDA", "AMZN"]);
    expect(tradfi.markets.map((market) => market.symbol)).toContain("SNDK");

    const available = await fetchRelativeStrengthMarkets({ marketScope: "combined" });
    expect(available.markets.map((market) => market.symbol)).toContain("SNDK");
  });

  it("still includes SNDK when explicitly added to a custom model", async () => {
    stubRelativeStrengthApi();

    const custom = await fetchRelativeStrengthUniverse({
      marketScope: "combined",
      benchmarkSymbol: "SNDK",
      includedSymbols: ["HYPE", "SNDK"],
    });

    expect(custom.assets.map((asset) => asset.symbol)).toEqual(["SNDK", "HYPE"]);
  });
});
