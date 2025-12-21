# hl-stats

Small Bun server that proxies Hyperliquid stats/info endpoints, adds light caching, and serves a static frontend from `public/`.

## What it does

- Serves a simple web UI from `public/`.
- Exposes a few JSON endpoints under `/api/` that wrap Hyperliquid APIs.
- Normalizes leaderboard rows and window stats for consistent client usage.
- Caches responses in-memory for 24 hours to reduce upstream calls.

## API endpoints

All endpoints are GET-only and return JSON. Add `refresh=1` to bypass cache.

### `GET /api/leaderboard`

Returns the top accounts by account value for the configured chain.

Query params:
- `limit` (default `500`, max `5000`): number of rows returned.

Response fields:
- `chain`: chain name (from `HL_CHAIN`).
- `limit`: resolved limit.
- `updatedAt`: epoch ms.
- `rows`: list of ranked accounts with `ethAddress`, `displayName`, `accountValue`, and `windows` (`day`, `week`, `month`, `allTime`).

### `GET /api/positions/:address`

Returns the clearinghouse state for the address (positions/balances).

### `GET /api/fills/:address`

Returns only liquidation fills for the address.

Query params:
- `days` (default `30`, max `90`): lookback window.

### `GET /api/mids`

Returns current mid prices for all markets.

## Configuration

Environment variables:
- `PORT` (default `3000`): server port.
- `HL_CHAIN` (default `Mainnet`): chain used for leaderboard data.

## Local development

```bash
bun install
bun run dev
```

The server logs the local URL on startup.

## Notes

- Upstream sources: `https://api.hyperliquid.xyz/info` and `https://stats-data.hyperliquid.xyz`.
- Cache TTLs are 24 hours by default and in-memory only.
