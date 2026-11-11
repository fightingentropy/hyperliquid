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

  it("times out a stalled request so the deduped entry is released", async () => {
    vi.useFakeTimers();
    try {
      const stalledFetch = (url, init) =>
        new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal.reason));
        });
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(stalledFetch)
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      vi.stubGlobal("fetch", fetchMock);

      const first = requestJson("/stalled");
      const second = requestJson("/stalled");
      const firstResult = expect(first).rejects.toBeDefined();
      const secondResult = expect(second).rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(15_001);
      await firstResult;
      await secondResult;

      await expect(requestJson("/stalled")).resolves.toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes its abort listener from a caller signal once the request settles", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, "addEventListener");
    const remove = vi.spyOn(caller.signal, "removeEventListener");

    await requestJson("/caller-signal", { signal: caller.signal });

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
  });

  it("still aborts the request when the caller signal aborts", async () => {
    const stalledFetch = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(stalledFetch));
    const caller = new AbortController();

    const pending = requestJson("/caller-abort", { signal: caller.signal });
    const result = expect(pending).rejects.toThrow("stop");
    caller.abort(new Error("stop"));
    await result;
  });
});
