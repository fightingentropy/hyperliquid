import { describe, expect, it, vi } from "vitest";
import { handleEquityResearchRequest } from "./equityResearchService";

function providerRows({ flat = false } = {}) {
  return Array.from({ length: 100 }, (_, index) => {
    const date = new Date("2025-01-01T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    const close = flat ? 100 : 100 + index;
    return {
      date: date.toISOString().slice(0, 10),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      adjusted_close: close,
      volume: 1_000 + index * 10,
    };
  });
}

function request(body, headers = {}) {
  return new Request("https://example.com/api/research/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("equity research service", () => {
  it("keeps the provider token server-side and returns the research contract", async () => {
    const fetchImpl = vi.fn(async (url) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get("api_token")).toBe("secret-token");

      if (parsed.pathname.endsWith("/news")) {
        return Response.json([
          {
            date: "2025-03-20T12:00:00Z",
            title: "Test company update",
            link: "https://example.com/update",
            s: "TEST.US",
          },
        ]);
      }

      return Response.json(
        parsed.pathname.includes("SPY.US") ? providerRows({ flat: true }) : providerRows(),
      );
    });

    const response = await handleEquityResearchRequest(
      request({ ticker: "TEST", as_of: "2025-04-10" }),
      {
        apiToken: "secret-token",
        fetchImpl,
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(payload.analysis.ticker).toBe("TEST");
    expect(payload.analysis.value).toBeGreaterThan(0);
    expect(payload.evidence.headlines).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("secret-token");
  });

  it("returns an actionable setup response when the secret is absent", async () => {
    const response = await handleEquityResearchRequest(
      request({ ticker: "TSLA", as_of: "2025-04-10" }),
      { apiToken: "" },
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("provider_not_configured");
  });

  it("rejects cross-origin browser requests", async () => {
    const response = await handleEquityResearchRequest(
      request(
        { ticker: "TSLA", as_of: "2025-04-10" },
        { Origin: "https://attacker.example" },
      ),
      { apiToken: "secret-token" },
    );

    expect(response.status).toBe(403);
  });

  it("treats optional headline failures as warnings", async () => {
    const fetchImpl = vi.fn(async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/news")) {
        return new Response("not entitled", { status: 403 });
      }
      return Response.json(
        parsed.pathname.includes("SPY.US") ? providerRows({ flat: true }) : providerRows(),
      );
    });
    const response = await handleEquityResearchRequest(
      request({ ticker: "TEST", as_of: "2025-04-10" }),
      {
        apiToken: "secret-token",
        fetchImpl,
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.evidence.headlines).toEqual([]);
    expect(payload.warnings[0]).toContain("deterministic score is unaffected");
  });

  it("enforces the body limit even when Content-Length is absent", async () => {
    const fetchImpl = vi.fn();
    const oversized = new Request("https://example.com/api/research/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ticker: "TSLA",
        as_of: "2025-04-10",
        padding: "x".repeat(5_000),
      }),
    });

    const response = await handleEquityResearchRequest(oversized, {
      apiToken: "secret-token",
      fetchImpl,
    });
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.error.code).toBe("request_too_large");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats Cache API failures as non-fatal", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = {
      match: vi.fn(async () => {
        throw new Error("cache read failed");
      }),
      put: vi.fn(async () => {
        throw new Error("cache write failed");
      }),
    };
    const fetchImpl = vi.fn(async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/news")) {
        return Response.json([]);
      }
      return Response.json(
        parsed.pathname.includes("SPY.US") ? providerRows({ flat: true }) : providerRows(),
      );
    });

    const response = await handleEquityResearchRequest(
      request({ ticker: "TEST", as_of: "2025-04-10" }),
      {
        apiToken: "secret-token",
        fetchImpl,
        cache,
      },
    );

    expect(response.status).toBe(200);
    expect(cache.match).toHaveBeenCalledTimes(3);
    expect(cache.put).toHaveBeenCalledTimes(3);
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});
