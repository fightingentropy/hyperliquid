import { HYPERLIQUID_LIQUIDATION_SYMBOLS } from "../../../src/lib/liquidationSymbols.js";
import { runSweep } from "./sweep";
import walletList from "./wallets.json";

interface SweeperEnv {
  DB: D1Database;
  BATCH_SIZE?: string;
}

const DEFAULT_BATCH_SIZE = 210;

function parseBatchSize(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

export default {
  async scheduled(_controller, env) {
    const result = await runSweep({
      db: env.DB,
      wallets: walletList.addresses,
      tracked: HYPERLIQUID_LIQUIDATION_SYMBOLS,
      batchSize: parseBatchSize(env.BATCH_SIZE),
    });

    console.log(JSON.stringify({ message: "liquidation sweep", ...result }));
  },
} satisfies ExportedHandler<SweeperEnv>;
