import { afterEach, describe, expect, it, vi } from "vitest";
import { readStorageItem, resetStorageFallbackForTests, writeStorageItem } from "./safeStorage";

function blockedStorage() {
  const blocked = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  return { getItem: blocked, setItem: blocked };
}

describe("safeStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStorageFallbackForTests();
  });

  it("does not throw when storage is blocked and keeps values in memory", () => {
    vi.stubGlobal("window", { localStorage: blockedStorage() });

    expect(readStorageItem("k")).toBeNull();
    expect(() => writeStorageItem("k", "1")).not.toThrow();
    expect(readStorageItem("k")).toBe("1");
  });

  it("does not throw when accessing window.localStorage itself throws", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    expect(readStorageItem("k")).toBeNull();
    expect(() => writeStorageItem("k", "1")).not.toThrow();
  });

  it("reads and writes through to working storage", () => {
    const data = new Map();
    vi.stubGlobal("window", {
      localStorage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) },
    });

    writeStorageItem("k", "2");
    expect(data.get("k")).toBe("2");
    expect(readStorageItem("k")).toBe("2");
  });
});
