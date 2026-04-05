import { requestJson, withQuery } from "./request";

export function fetchMarketFlowBatch({ marketId, chartWindow, participantsWindow, limit }) {
  return requestJson(
    withQuery("/api/analytics/market-flow/batch", {
      marketId,
      chartWindow,
      participantsWindow,
      limit,
    }),
  );
}

export function fetchMarketFlowSummaries({ marketIds, window }) {
  return requestJson(
    withQuery("/api/analytics/market-flow/summaries", {
      marketIds: marketIds.join(","),
      window,
    }),
  );
}
