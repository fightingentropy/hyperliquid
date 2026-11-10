import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "./[[path]].ts";

const request = () => new Request("https://example.com/api/entities");

afterEach(() => vi.unstubAllGlobals());

describe("api proxy caching", () => {
  it("caches successful upstream responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const res = await onRequest({ request: request() });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("does not cache upstream errors", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await onRequest({ request: request() });
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock.mock.calls[0][1].cf.cacheTtlByStatus["500-599"] ?? fetchMock.mock.calls[0][1].cf.cacheTtlByStatus["300-599"]).toBe(-1);
  });

  it("returns an uncached 502 when the upstream fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    const res = await onRequest({ request: request() });
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
