import { describe, expect, it } from "vitest";
import { buildRelativeStrengthModel } from "./relativeStrength";

describe("relative-strength model builder", () => {
  it("rebases asset prices and ranks by latest relative change", () => {
    const model = buildRelativeStrengthModel(
      [
        {
          symbol: "SLOW",
          dayNotionalVolume: 100,
          points: [
            { timestamp: 1, closePrice: 100 },
            { timestamp: 2, closePrice: 95 },
          ],
        },
        {
          symbol: "FAST",
          dayNotionalVolume: 50,
          points: [
            { timestamp: 1, closePrice: 100 },
            { timestamp: 2, closePrice: 110 },
          ],
        },
      ],
      "24h",
    );

    expect(model.assets.map((asset) => asset.symbol)).toEqual(["FAST", "SLOW"]);
    expect(model.chartData.at(-1).FAST).toBeCloseTo(10);
    expect(model.chartData.at(-1).SLOW).toBeCloseTo(-5);
  });
});
