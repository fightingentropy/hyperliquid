import { describe, expect, it } from "vitest";
import { createLatestLoadGate } from "./usePollingResource";

describe("createLatestLoadGate", () => {
  it("only treats the most recently started load as current", () => {
    const gate = createLatestLoadGate();

    const slow = gate.begin();
    const fast = gate.begin();

    expect(gate.isLatest(slow)).toBe(false);
    expect(gate.isLatest(fast)).toBe(true);
  });
});
