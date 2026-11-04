export const WATCHLISTS_STORAGE_KEY = "hl-stats.watchlists.v1";
export const DEFAULT_WATCHLIST_ID = "favorites";
export const DEFAULT_WATCH_SYMBOLS = ["BTC", "ETH", "SOL", "HYPE"];

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `wl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createWatchlist(name, coins = []) {
  return {
    id: randomId(),
    name: String(name ?? "").trim() || "Untitled",
    coins: normalizeSymbols(coins),
  };
}

export function normalizeSymbols(symbols) {
  return Array.from(
    new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((symbol) => String(symbol ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

export function normalizeWatchlistModel(raw) {
  const fallback = createDefaultWatchlistModel();
  const lists = Array.isArray(raw?.lists) ? raw.lists : [];

  const normalized = lists
    .filter((list) => list && typeof list === "object")
    .map((list) => ({
      id: String(list.id ?? "").trim() || randomId(),
      name: String(list.name ?? "").trim() || "Untitled",
      coins: normalizeSymbols(list.coins),
    }));

  if (!normalized.length) {
    return fallback;
  }

  const activeId = normalized.some((list) => list.id === raw?.activeId)
    ? raw.activeId
    : normalized[0].id;

  return { activeId, lists: normalized };
}

export function createDefaultWatchlistModel() {
  const favorites = {
    id: DEFAULT_WATCHLIST_ID,
    name: "Favorites",
    coins: normalizeSymbols(DEFAULT_WATCH_SYMBOLS),
  };
  return { activeId: favorites.id, lists: [favorites] };
}

export function readStoredWatchlistModel(storage) {
  if (!storage) {
    return createDefaultWatchlistModel();
  }

  try {
    const parsed = JSON.parse(storage.getItem(WATCHLISTS_STORAGE_KEY));
    if (!parsed || typeof parsed !== "object") {
      return createDefaultWatchlistModel();
    }
    return normalizeWatchlistModel(parsed);
  } catch {
    return createDefaultWatchlistModel();
  }
}

export function writeStoredWatchlistModel(model, storage) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(WATCHLISTS_STORAGE_KEY, JSON.stringify(model));
  } catch {
    // Storage can be unavailable (private mode, quota); watchlists stay in memory.
  }
}

export function getActiveWatchlist(model) {
  return model.lists.find((list) => list.id === model.activeId) ?? model.lists[0];
}

export function addCoinToWatchlist(model, listId, symbol) {
  const normalized = String(symbol ?? "").trim().toUpperCase();
  if (!normalized) {
    return model;
  }

  return {
    ...model,
    lists: model.lists.map((list) =>
      list.id === listId && !list.coins.includes(normalized)
        ? { ...list, coins: [...list.coins, normalized] }
        : list,
    ),
  };
}

export function removeCoinFromWatchlist(model, listId, symbol) {
  const normalized = String(symbol ?? "").trim().toUpperCase();
  return {
    ...model,
    lists: model.lists.map((list) =>
      list.id === listId
        ? { ...list, coins: list.coins.filter((coin) => coin !== normalized) }
        : list,
    ),
  };
}

export function appendWatchlist(model, name) {
  const list = createWatchlist(name);
  return {
    activeId: list.id,
    lists: [...model.lists, list],
  };
}

export function renameWatchlist(model, listId, name) {
  const next = String(name ?? "").trim();
  if (!next) {
    return model;
  }

  return {
    ...model,
    lists: model.lists.map((list) => (list.id === listId ? { ...list, name: next } : list)),
  };
}

export function removeWatchlist(model, listId) {
  if (model.lists.length <= 1) {
    return model;
  }

  const lists = model.lists.filter((list) => list.id !== listId);
  return {
    activeId: model.activeId === listId ? lists[0].id : model.activeId,
    lists,
  };
}

export function setActiveWatchlist(model, listId) {
  if (!model.lists.some((list) => list.id === listId)) {
    return model;
  }
  return { ...model, activeId: listId };
}
