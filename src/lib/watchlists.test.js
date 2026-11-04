import { describe, expect, it } from "vitest";
import {
  addCoinToWatchlist,
  appendWatchlist,
  createDefaultWatchlistModel,
  getActiveWatchlist,
  normalizeSymbols,
  normalizeWatchlistModel,
  removeCoinFromWatchlist,
  removeWatchlist,
  renameWatchlist,
  setActiveWatchlist,
} from "./watchlists";

describe("watchlists", () => {
  it("normalizes symbols to uppercased unique values", () => {
    expect(normalizeSymbols(["btc", " BTC ", "eth", "BTC"])).toEqual(["BTC", "ETH"]);
  });

  it("falls back to a default model for invalid stored data", () => {
    const model = normalizeWatchlistModel({ lists: "nope" });
    expect(model.lists).toHaveLength(1);
    expect(model.lists[0].coins).toEqual(["BTC", "ETH", "SOL", "HYPE"]);
    expect(getActiveWatchlist(model).name).toBe("Favorites");
  });

  it("keeps a stored model that already looks valid", () => {
    const model = normalizeWatchlistModel({
      activeId: "wl-2",
      lists: [
        { id: "wl-1", name: "A", coins: ["btc"] },
        { id: "wl-2", name: "B", coins: [] },
      ],
    });
    expect(model.lists).toHaveLength(2);
    expect(model.activeId).toBe("wl-2");
    expect(model.lists[0].coins).toEqual(["BTC"]);
  });

  it("adds and removes coins without duplicates", () => {
    let model = createDefaultWatchlistModel();
    const id = model.lists[0].id;

    model = addCoinToWatchlist(model, id, "DOGE");
    model = addCoinToWatchlist(model, id, "doge");
    expect(model.lists[0].coins).toEqual(["BTC", "ETH", "SOL", "HYPE", "DOGE"]);

    model = removeCoinFromWatchlist(model, id, "DOGE");
    expect(model.lists[0].coins).toEqual(["BTC", "ETH", "SOL", "HYPE"]);
  });

  it("appends, renames and deletes lists", () => {
    let model = createDefaultWatchlistModel();

    model = appendWatchlist(model, "Majors");
    expect(model.lists).toHaveLength(2);
    expect(getActiveWatchlist(model).name).toBe("Majors");

    const majorsId = model.lists[1].id;
    model = renameWatchlist(model, majorsId, "Perps");
    expect(model.lists[1].name).toBe("Perps");

    model = removeWatchlist(model, majorsId);
    expect(model.lists).toHaveLength(1);
    expect(model.activeId).toBe(model.lists[0].id);
  });

  it("never deletes the last list and ignores unknown ids", () => {
    let model = createDefaultWatchlistModel();
    const id = model.lists[0].id;

    model = removeWatchlist(model, id);
    expect(model.lists).toHaveLength(1);

    model = setActiveWatchlist(model, "missing");
    expect(model.activeId).toBe(id);
  });
});
