import { lazy } from "react";
import { getBrowserStorage } from "./safeStorage.js";

const RELOAD_KEY = "qf-page-load-reload-at";
const RELOAD_COOLDOWN_MS = 10_000;

// A tab still running an old build asks for page files that a newer deploy
// removed. The host answers with index.html, the import fails, and React
// unmounts the whole app, leaving a blank page. Reloading once picks up the
// new build; the cooldown stops a reload loop when the failure is real.
export function loadWithReloadOnce(load, { storage, reload, now = Date.now } = {}) {
  return load().catch((error) => {
    let lastReloadAt = 0;
    try {
      lastReloadAt = Number(storage?.getItem(RELOAD_KEY)) || 0;
    } catch {
      // Storage can be unavailable; fall through and reload anyway.
    }

    if (!reload || now() - lastReloadAt < RELOAD_COOLDOWN_MS) {
      throw error;
    }

    try {
      storage?.setItem(RELOAD_KEY, String(now()));
    } catch {
      // Without storage the cooldown can't be recorded; still reload once.
    }
    reload();
    return new Promise(() => {});
  });
}

export function lazyPage(load) {
  return lazy(() =>
    loadWithReloadOnce(load, {
      storage: getBrowserStorage("sessionStorage"),
      reload: typeof window !== "undefined" ? () => window.location.reload() : null,
    }),
  );
}
