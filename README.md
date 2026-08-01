# hl-stats

This repo now serves the Qwantify Hyperliquid analytics workspace on the existing Cloudflare Pages project.
Deploys continue targeting the existing `hl-stats` Pages project, so the production URL stays the same.

- Local app dev: `npm run dev`
- Pages build output: `npm run pages:build`
- Pages local preview: `npm run pages:dev`
- Pages deploy: `npm run pages:deploy`

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
