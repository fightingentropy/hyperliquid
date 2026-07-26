const STORAGE_KEY = "hl-stats.equity-research-history.v1";
const MAX_RUNS = 24;

export function getResearchHistory(storage = browserStorage()) {
  if (!storage) {
    return [];
  }

  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (value?.schema_version !== 1 || !Array.isArray(value.items)) {
      return [];
    }

    return value.items
      .filter(isHistoryItem)
      .map((item) => ({
        ...item,
        score: item.direction === "neutral" ? 0 : item.score,
      }))
      .sort((left, right) => right.generated_at.localeCompare(left.generated_at))
      .slice(0, MAX_RUNS);
  } catch {
    return [];
  }
}

export function recordResearchRun(payload, storage = browserStorage()) {
  const item = {
    schema_version: 1,
    run_id: payload.run.run_id,
    generated_at: payload.run.generated_at,
    ticker: payload.analysis.ticker,
    as_of: payload.analysis.date,
    direction: payload.factor_model.direction,
    score: payload.analysis.value,
    reasoning: payload.analysis.reasoning,
  };
  const next = [
    item,
    ...getResearchHistory(storage).filter((run) => run.run_id !== item.run_id),
  ].slice(0, MAX_RUNS);

  writeHistory(next, storage);
  return next;
}

export function clearResearchHistory(storage = browserStorage()) {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Browser persistence is optional.
  }
}

function writeHistory(items, storage) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schema_version: 1,
        items,
      }),
    );
  } catch {
    // Browser persistence is optional.
  }
}

function isHistoryItem(value) {
  return (
    value?.schema_version === 1 &&
    typeof value.run_id === "string" &&
    typeof value.generated_at === "string" &&
    typeof value.ticker === "string" &&
    typeof value.as_of === "string" &&
    ["bullish", "bearish", "neutral"].includes(value.direction) &&
    Number.isFinite(value.score) &&
    typeof value.reasoning === "string"
  );
}

function browserStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
