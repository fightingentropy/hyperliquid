import { handleLiquidationRequest } from "../../../src/server/liquidations.js";

type LiquidationEnv = Env & {
  RESEARCH_CONTROL_DB?: D1Database;
};

// More specific than functions/api/[[path]].ts, so this route wins for /api/liquidations/<coin>
// and the Qwantify proxy catch-all stays in charge of every other /api path.
export const onRequest: PagesFunction<LiquidationEnv> = async (context) =>
  handleLiquidationRequest(context.request, {
    coin: context.params.coin,
    db: context.env.RESEARCH_CONTROL_DB,
  });
