import { bindings, defineConfig, triggers } from "cf/config";

// Sweeps large-wallet liquidation levels from Hyperliquid's public API into D1 every minute.
// The D1 database is the one the Pages project binds as RESEARCH_CONTROL_DB.
export default defineConfig({
  worker: {
    name: "hl-liquidation-sweeper",
    compatibilityDate: "2026-07-26",
    entrypoint: "src/index.ts",
    workersDev: false,
    previewUrls: false,
    observability: {
      enabled: true,
    },
    triggers: [triggers.scheduled({ schedule: "* * * * *" })],
    env: {
      DB: bindings.d1({
        name: "hl-stats-research-control",
        id: "c261604c-2f39-493a-b178-50328f348413",
      }),
      BATCH_SIZE: bindings.text("210"),
    },
  },
});
