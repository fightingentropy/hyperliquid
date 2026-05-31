import { describe, expect, it } from "vitest";
import { buildPositionSnapshot, buildWalletMetrics } from "./wallet";

describe("wallet model builders", () => {
  it("aggregates position exposure without losing side or funding data", () => {
    const snapshot = buildPositionSnapshot([
      {
        dex: "",
        state: {
          marginSummary: {
            accountValue: "100",
            totalNtlPos: "20",
          },
          withdrawable: "80",
          assetPositions: [
            {
              position: {
                coin: "HYPE",
                szi: "2",
                positionValue: "20",
                entryPx: "8",
                unrealizedPnl: "3",
                returnOnEquity: "0.1",
                cumFunding: { sinceOpen: "-0.5" },
                liquidationPx: "5",
                leverage: { value: "3" },
                marginUsed: "7",
              },
            },
          ],
        },
      },
    ]);

    expect(snapshot.longExposureUsd).toBe(20);
    expect(snapshot.shortExposureUsd).toBe(0);
    expect(snapshot.positions[0]).toMatchObject({
      coin: "HYPE",
      side: "LONG",
      markPrice: 10,
      fundingUsd: 0.5,
    });
  });

  it("keeps unknown realized percentage deltas as null", () => {
    const metrics = buildWalletMetrics({
      portfolio: {},
      holdingsSnapshot: {
        totalValueUsd: 0,
      },
      stakingSummary: {},
      hypeMid: 0,
      positionSnapshot: buildPositionSnapshot([]),
    });

    expect(metrics.realizedDelta24hPct).toBeNull();
    expect(metrics.realizedDelta7dPct).toBeNull();
  });
});
