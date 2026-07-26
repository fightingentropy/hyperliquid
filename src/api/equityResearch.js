import { normalizeIsoDate, normalizeTicker } from "../lib/equityResearch";

export class EquityResearchApiError extends Error {
  constructor(message, { code = "research_error", status = 500 } = {}) {
    super(message);
    this.name = "EquityResearchApiError";
    this.code = code;
    this.status = status;
  }
}

export async function runEquityResearch({ ticker, asOf, signal } = {}) {
  const normalizedTicker = normalizeTicker(ticker);
  const normalizedAsOf = normalizeIsoDate(asOf);
  const response = await fetch("/api/research/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ticker: normalizedTicker,
      as_of: normalizedAsOf,
    }),
    credentials: "same-origin",
    signal,
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new EquityResearchApiError("The research service returned invalid JSON.", {
      code: "invalid_response",
      status: response.status,
    });
  }

  if (!response.ok) {
    throw new EquityResearchApiError(
      payload?.error?.message ?? "The research request failed.",
      {
        code: payload?.error?.code ?? "request_failed",
        status: response.status,
      },
    );
  }

  return validateResearchPayload(payload);
}

function validateResearchPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new EquityResearchApiError("The research response is malformed.", {
      code: "invalid_response",
      status: 502,
    });
  }

  const valid =
    payload.schema_version === 1 &&
    typeof payload.run?.run_id === "string" &&
    typeof payload.run?.generated_at === "string" &&
    typeof payload.analysis?.ticker === "string" &&
    typeof payload.analysis?.date === "string" &&
    Number.isFinite(payload.analysis?.value) &&
    ["bullish", "bearish", "neutral"].includes(payload.factor_model?.direction) &&
    Array.isArray(payload.factor_model?.factors) &&
    Array.isArray(payload.series?.ticker) &&
    Array.isArray(payload.series?.benchmark);

  if (!valid) {
    throw new EquityResearchApiError("The research response is malformed.", {
      code: "invalid_response",
      status: 502,
    });
  }

  return payload;
}
