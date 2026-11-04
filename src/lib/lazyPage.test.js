import { describe, expect, it, vi } from "vitest";
import { loadWithReloadOnce } from "./lazyPage";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe("loadWithReloadOnce", () => {
  it("returns the module when the import succeeds", async () => {
    const reload = vi.fn();
    const module = { default: () => null };
    await expect(
      loadWithReloadOnce(() => Promise.resolve(module), { storage: memoryStorage(), reload }),
    ).resolves.toBe(module);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once when the import fails", async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const pending = loadWithReloadOnce(() => Promise.reject(new Error("stale chunk")), {
      storage,
      reload,
      now: () => 1_000_000,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem("qf-page-load-reload-at")).toBe("1000000");
    expect(pending).toBeInstanceOf(Promise);
  });

  it("rethrows instead of reloading again within the cooldown", async () => {
    const storage = memoryStorage();
    storage.setItem("qf-page-load-reload-at", "1000000");
    const reload = vi.fn();

    await expect(
      loadWithReloadOnce(() => Promise.reject(new Error("still broken")), {
        storage,
        reload,
        now: () => 1_005_000,
      }),
    ).rejects.toThrow("still broken");
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads again once the cooldown has passed", async () => {
    const storage = memoryStorage();
    storage.setItem("qf-page-load-reload-at", "1000000");
    const reload = vi.fn();

    loadWithReloadOnce(() => Promise.reject(new Error("stale chunk")), {
      storage,
      reload,
      now: () => 1_020_000,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
