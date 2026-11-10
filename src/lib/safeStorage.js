// localStorage can throw (blocked site data, private modes, quota). Reads and
// writes fall back to an in-memory copy for the rest of the visit instead of
// throwing during render or in event handlers.
const memoryFallback = new Map();

export function readStorageItem(key) {
  if (memoryFallback.has(key)) {
    return memoryFallback.get(key);
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorageItem(key, value) {
  try {
    window.localStorage.setItem(key, value);
    memoryFallback.delete(key);
  } catch {
    memoryFallback.set(key, value);
  }
}

export function resetStorageFallbackForTests() {
  memoryFallback.clear();
}
