import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./request";

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

describe("requestJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cleans up failed deduped requests so retries can run", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(requestJson("/dedupe-retry")).rejects.toThrow("network down");
    await expect(requestJson("/dedupe-retry")).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
