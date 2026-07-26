import { describe, expect, it } from "vitest";
import {
  clearResearchHistory,
  getResearchHistory,
  recordResearchRun,
} from "./equityResearchHistory";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function payload(runId, generatedAt) {
  return {
    run: {
      run_id: runId,
      generated_at: generatedAt,
    },
    analysis: {
      ticker: "TSLA",
      date: "2025-03-21",
      value: 0.42,
      reasoning: "Deterministic research summary.",
    },
    factor_model: {
      direction: "bullish",
      raw_score: 0.42,
    },
  };
}

describe("equity research history", () => {
  it("stores recent safe summaries and deduplicates run ids", () => {
    const storage = memoryStorage();

    recordResearchRun(payload("one", "2025-03-21T10:00:00Z"), storage);
    recordResearchRun(payload("two", "2025-03-21T11:00:00Z"), storage);
    recordResearchRun(payload("one", "2025-03-21T12:00:00Z"), storage);

    const history = getResearchHistory(storage);
    expect(history.map((run) => run.run_id)).toEqual(["one", "two"]);
    expect(history[0]).not.toHaveProperty("api_token");
  });

  it("clears local history", () => {
    const storage = memoryStorage();
    recordResearchRun(payload("one", "2025-03-21T10:00:00Z"), storage);

    clearResearchHistory(storage);

    expect(getResearchHistory(storage)).toEqual([]);
  });

  it("stores neutral signals at their deadbanded value", () => {
    const storage = memoryStorage();
    const neutral = payload("neutral", "2025-03-21T12:00:00Z");
    neutral.analysis.value = 0;
    neutral.factor_model.direction = "neutral";
    neutral.factor_model.raw_score = 0.08;

    recordResearchRun(neutral, storage);

    expect(getResearchHistory(storage)[0].score).toBe(0);
  });
});
