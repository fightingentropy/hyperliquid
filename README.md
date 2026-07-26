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

Same-origin request checks are not user authentication. Treat the deployed
research endpoint as public, and put the Pages project behind Cloudflare Access
or add an abuse-protection policy before relying on it for a paid EODHD
allowance.

The interactive research path is deliberately bounded to one ticker, one SPY
benchmark series, and optional recent headlines per request. Larger multi-year,
multi-ticker backtests belong in a separate asynchronous Workflow rather than a
Pages request.
