-- Liquidation map data written by the hl-liquidation-sweeper Worker (workers/liq-sweeper) and
-- read by functions/api/liquidations/[coin].ts.

-- One row per (wallet, coin) with a finite liquidation price. WITHOUT ROWID keeps the primary
-- key as the table itself, which saves one D1 row write per insert and delete.
CREATE TABLE IF NOT EXISTS liq_positions (
  address TEXT NOT NULL,
  coin TEXT NOT NULL,
  liquidation_px REAL NOT NULL,
  -- Signed size in coin units: negative is a short.
  size REAL NOT NULL,
  position_usd REAL NOT NULL,
  -- Hyperliquid clearinghouseState time (ms) of the snapshot this row came from.
  snapshot_time INTEGER NOT NULL,
  PRIMARY KEY (address, coin)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_liq_positions_coin ON liq_positions (coin);

-- Latest mid price per tracked coin, from the sweeper's allMids call.
CREATE TABLE IF NOT EXISTS liq_prices (
  coin TEXT PRIMARY KEY,
  mid REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Sweeper state: cursor, last_run_at, last_full_cycle_at, wallets_total, last_error, ...
CREATE TABLE IF NOT EXISTS liq_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
