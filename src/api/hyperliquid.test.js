import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllClearinghouseStates } from "./hyperliquid";

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
