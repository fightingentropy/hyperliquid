import { describe, expect, it } from "vitest";
import { buildIntervalSeries } from "./marketFlow";

describe("market-flow series builders", () => {
  it("rolls 30d hourly flow into four-hour buckets", () => {
    const summary = {
      hourly: [
        {
          hourStart: "2026-05-01T00:00:00.000Z",
          netUsd: 1,
          buyUsd: 2,
          sellUsd: 1,
        },
        {
          hourStart: "2026-05-01T03:00:00.000Z",
          netUsd: 3,
          buyUsd: 4,
          sellUsd: 1,
        },
        {
          hourStart: "2026-05-01T04:00:00.000Z",
          netUsd: -2,
          buyUsd: 1,
          sellUsd: 3,
        },
      ],
    };
    const candles = [
      {
        timestamp: Date.parse("2026-05-01T03:00:00.000Z"),
        closePrice: 10,
      },
      {
        timestamp: Date.parse("2026-05-01T04:00:00.000Z"),
        closePrice: 12,
      },
    ];

    const series = buildIntervalSeries(summary, "30d", candles);

    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({
      bucketStart: "2026-05-01T00:00:00.000Z",
      netUsd: 4,
      buyUsd: 6,
      sellUsd: 2,
      closePrice: 10,
    });
    expect(series[1]).toMatchObject({
      bucketStart: "2026-05-01T04:00:00.000Z",
      netUsd: -2,
      closePrice: 12,
    });
  });
});
