import { describe, expect, it } from "vitest";
import { createSqliteD1 } from "../test-support/sqliteD1.js";
import { handleLiquidationRequest } from "./liquidations";

function get(coin, db, init = {}) {
  return handleLiquidationRequest(
    new Request(`https://example.com/api/liquidations/${coin}`, init),
    { coin, db },
  );
}

function seed(db) {
  const insert = db.sqlite.prepare(
    "INSERT INTO liq_positions (address, coin, liquidation_px, size, position_usd, snapshot_time) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insert.run("0xaa", "BTC", 90000.5, -2, 180000, 1_800_000_050_000);
  insert.run("0xbb", "BTC", 60000, 3.5, 245000, 1_800_000_020_000);
  insert.run("0xcc", "ETH", 2500, 10, 31000, 1_800_000_030_000);
  db.sqlite
    .prepare("INSERT INTO liq_prices (coin, mid, updated_at) VALUES (?, ?, ?)")
    .run("BTC", 70000.5, 1_800_000_060_000);
  const meta = db.sqlite.prepare("INSERT INTO liq_meta (key, value) VALUES (?, ?)");
  meta.run("wallets_total", "1040");
  meta.run("last_full_cycle_at", "1800000055000");
  meta.run("cursor", "17");
}

describe("handleLiquidationRequest", () => {
  it("returns the liquidation map for a coin, sorted by price", async () => {
    const db = createSqliteD1();
    seed(db);

    const response = await get("BTC", db);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({
      symbol: "BTC",
      price: 70000.5,
      rows: [
        { liquidationPrice: 60000, size: 3.5, positionUsd: 245000, updateTime: 1_800_000_020_000 },
        { liquidationPrice: 90000.5, size: -2, positionUsd: 180000, updateTime: 1_800_000_050_000 },
      ],
      asOf: 1_800_000_060_000,
      source: "Hyperliquid",
      walletsTracked: 1040,
      lastFullCycleAt: 1_800_000_055_000,
    });
  });

  it("returns an empty row list when no tracked wallet has a liquidation price in the coin", async () => {
    const db = createSqliteD1();
    seed(db);
    db.sqlite.prepare("INSERT INTO liq_prices (coin, mid, updated_at) VALUES ('SOL', 150, 1)").run();

    const body = await (await get("SOL", db)).json();

    expect(body).toMatchObject({ symbol: "SOL", price: 150, rows: [] });
  });

  it("reports a null full-cycle time before the first cycle completes", async () => {
    const db = createSqliteD1();
    seed(db);
    db.sqlite.prepare("DELETE FROM liq_meta WHERE key = 'last_full_cycle_at'").run();

    const body = await (await get("BTC", db)).json();

    expect(body.lastFullCycleAt).toBeNull();
  });

  it("returns 404 for coins that are not tracked, case-sensitively", async () => {
    const db = createSqliteD1();
    seed(db);

    for (const coin of ["MKR", "IP", "AI16Z", "btc", "KPEPE", "kpepe", "../etc", "BTC%2F", ""]) {
      const response = await get(coin, db);
      expect(response.status, coin).toBe(404);
      expect((await response.json()).code).toBe("unknown_coin");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("accepts mixed-case Hyperliquid names exactly as listed", async () => {
    const db = createSqliteD1();
    db.sqlite.prepare("INSERT INTO liq_prices (coin, mid, updated_at) VALUES ('kPEPE', 0.005, 1)").run();

    const response = await get("kPEPE", db);

    expect(response.status).toBe(200);
    expect((await response.json()).symbol).toBe("kPEPE");
  });

  it("returns 503 with a clear message while the tables are empty", async () => {
    const db = createSqliteD1();

    const response = await get("BTC", db);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("liquidations_unavailable");
    expect(body.message).toMatch(/sweeper has not written any data/i);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("returns 503 when the coin has no price yet even though other coins do", async () => {
    const db = createSqliteD1();
    seed(db);

    expect((await get("HYPE", db)).status).toBe(503);
  });

  it("returns 503 when the migration has not been applied or the binding is missing", async () => {
    const withoutTables = createSqliteD1({ migrations: [] });

    expect((await get("BTC", withoutTables)).status).toBe(503);
    expect((await get("BTC", undefined)).status).toBe(503);
  });

  it("supports HEAD without a body and rejects other methods", async () => {
    const db = createSqliteD1();
    seed(db);

    const head = await get("BTC", db, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const post = await get("BTC", db, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET, HEAD");
  });
});
