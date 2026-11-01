# hyperliquid

Qwantify (https://www.qwantify.io) is my own Hyperliquid analytics site. This repo serves a React
rebuild of some of its pages at https://hyperliquid.erlin.org, on the same Qwantify API
(`api.qwantify.io`), which the app reaches through the same-origin Pages Function in
`functions/api/[[path]].ts`. The market-flow, token-analytics and team-wallet pages follow their
Qwantify counterparts, and the wallet positions page was matched to Qwantify's.
Deploys target the Cloudflare Pages project `hl-stats`, which keeps its original name because
Pages projects can't be renamed.

Unofficial: not affiliated with Hyperliquid. Analytics only, not investment advice.

- Local app dev: `npm run dev`
- Pages build output: `npm run pages:build`
- Pages local preview: `npm run pages:dev`
- Pages deploy: `npm run pages:deploy`

## Liquidation map

`/app/liquidations` shows where large Hyperliquid wallets would be liquidated, per coin, as
cumulative long and short size around the current price. It uses only Hyperliquid's official
public API (`https://api.hyperliquid.xyz/info`):

- **Wallet list.** `workers/liq-sweeper/src/wallets.json` holds the accounts on Hyperliquid's
  official leaderboard dump (`https://stats-data.hyperliquid.xyz/Mainnet/leaderboard`) with an
  account value of at least $1M and weekly volume above zero, sorted by account value (about
  1,040 addresses at the time of writing). These are public leaderboard addresses.
- **Sweeper.** The `hl-liquidation-sweeper` Worker (`workers/liq-sweeper`) runs every minute. It
  reads `allMids` once and `clearinghouseState` for the next 210 wallets (4 at a time, 8 s
  timeout, one retry, stopping early on HTTP 429), then replaces those wallets' rows in D1. A
  full pass over the list takes about 5 minutes. A run weighs about 422 of the documented
  1,200 requests per minute per IP, and it makes about 211 subrequests, so it needs Workers
  Paid (the Free plan allows 50).
- **API.** `functions/api/liquidations/[coin].ts` serves `/api/liquidations/<coin>` from the
  `RESEARCH_CONTROL_DB` D1 binding with `Cache-Control: public, max-age=60`. It answers 503
  until the sweeper has written data.

The tables are `liq_positions` (one row per wallet and coin with a liquidation price),
`liq_prices` (latest mid per tracked coin) and `liq_meta` (cursor, `last_run_at`,
`last_full_cycle_at`, `wallets_total`, `last_error`). Check `last_error` there if the data goes
stale; a `429` from Hyperliquid is recorded in it.

**Coverage.** The map covers the tracked large wallets only, not every position on
Hyperliquid, and each wallet's snapshot can be up to about 5 minutes old. Positions that
Hyperliquid reports without a liquidation price (well collateralised) are not shown. Only the
coins in `src/lib/liquidationSymbols.js` are stored.

Set up and deploy, in this order:

```bash
# 1. Create the tables in the remote D1 database (needs the Cloudflare login the cf CLI uses).
cf d1 migrations apply c261604c-2f39-493a-b178-50328f348413
# wrangler equivalent:
npx wrangler d1 migrations apply RESEARCH_CONTROL_DB --remote

# 2. Deploy the sweeper. liq:dry-run builds and stops before uploading anything.
npm run liq:dry-run
npm run liq:deploy

# 3. Deploy the site as usual (pushing main deploys the Pages project).
```

Refresh the wallet list now and then, since accounts come and go. This downloads the roughly
40 MB leaderboard, rewrites `wallets.json`, and needs a redeploy of the sweeper to take effect:

```bash
npm run liq:wallets          # or: npm run liq:wallets -- --input leaderboard.json
git diff --stat workers/liq-sweeper/src/wallets.json
npm run liq:deploy
```

Locally, `npm run dev` proxies every `/api` request to Qwantify, which has no liquidation
route, so the page only works against a Pages Function runtime: run `npm run pages:build`,
apply the migrations to the local D1 with `npx wrangler d1 migrations apply RESEARCH_CONTROL_DB
--local`, then `npx wrangler pages dev .cloudflare/pages`. It shows the 503 message until a
sweeper run has filled the local tables.

The sweeper's cursor lives in D1, so a new list simply continues from the same index. Rows
that no run has refreshed for 2 hours (for example wallets dropped from the list) are deleted
when a pass completes.

## Equity Research

`/app/research` absorbs the deterministic market-factor research tool from the
AI Hedge Fund project into the Hyperliquid interface. It keeps the documented
equities/SPY methodology, normalized price chart, factor attribution, evidence
dates, headline metadata, and browser-local run history. It does not place
trades or expose provider credentials to the browser.

The provider adapter is a same-origin Cloudflare Pages Function written for the
Workers runtime. For local development:

```bash
cp .dev.vars.example .dev.vars
# Add the local EODHD token to .dev.vars, then:
npm run dev
```

For the deployed `hl-stats` Pages project, configure the token as an encrypted
secret before deployment:

```bash
npx wrangler pages secret put EODHD_API_TOKEN --project-name=hl-stats
npm run pages:deploy
```

The endpoint now fails closed unless it can verify a Cloudflare Access JWT.
Configure a Pages Access application, then add `CF_ACCESS_TEAM_DOMAIN` (for
example, `https://your-team.cloudflareaccess.com`) and `CF_ACCESS_AUD` as Pages
environment variables. Bind a D1 database as `RESEARCH_CONTROL_DB` and apply
`migrations/0001_research_control.sql`. The D1 control plane enforces per-user,
per-IP and global daily provider budgets and opens a short circuit breaker after
repeated upstream failures. Optional limits are `RESEARCH_USER_DAILY_LIMIT`,
`RESEARCH_IP_DAILY_LIMIT` and `RESEARCH_PROVIDER_DAILY_BUDGET`.

`RESEARCH_ALLOW_LOCAL_DEV=true` bypasses Access only for literal `localhost` or
`127.0.0.1`; `npm run pages:dev` supplies a local D1 binding. Do not enable that
variable in production.

The interactive research path is deliberately bounded to one ticker, one SPY
benchmark series, and optional recent headlines per request. Larger multi-year,
multi-ticker backtests belong in a separate asynchronous Workflow rather than a
Pages request.

Every stored result carries the SHA-256 hash of the exact factor-model
definition and identifies the model as an unvalidated hypothesis. The model is
frozen as `market-factor-v2`; v2 fixes the v1 registry definition so its recorded
weights exactly match the implemented scorer.

The separate walk-forward evaluator accepts point-in-time observations and
strict temporal folds, rejects look-ahead outcomes and delistings without a
terminal return, and reports benchmark-relative gross/net performance,
turnover and transaction costs, information coefficient, rank stability,
calibration buckets, regimes, factor-weight sensitivity and a seeded bootstrap
confidence interval:

```bash
npm run research:validate -- point-in-time-input.json report.json
```

The input must contain `observations`, `folds`, and optional
`transactionCostBps`, `bootstrapSamples`, and `bootstrapSeed` fields matching
the contract tested in `src/lib/equityResearchWalkForward.test.js`. Passing the
synthetic regression fixture proves the evaluator mechanics, not predictive
power. Keep the model's `unvalidated_hypothesis` label until a licensed,
survivorship-complete historical universe has been evaluated and reviewed.
