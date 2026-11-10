import { describe, expect, it } from "vitest";
import {
  assetExposure,
  buildLeaderSignals,
  buildLeaders,
  cohortAverageEntry,
  exposureAmount,
  exposureSide,
  flowStyle,
} from "./flowLeaders";

const ADDR = (n) => `0x${String(n).padStart(40, "0")}`;

const BATCH = {
  topBuys: {
    top: [
      { wallet: ADDR(1), netUsd: 9_000_000, totalUsd: 9_000_000, netSize: 100_000, tradeCount: 500 },
      { wallet: ADDR(2), netUsd: 4_000_000, totalUsd: 20_000_000, netSize: 50_000, tradeCount: 9_000 },
    ],
  },
  topSells: {
    top: [{ wallet: ADDR(3), netUsd: -6_000_000, totalUsd: 6_000_000, netSize: -70_000, tradeCount: 800 }],
  },
  labels: { [ADDR(2)]: { name: "Wintermute" } },
};

function snapshotWith(positions) {
  return { positions };
}

describe("flowLeaders", () => {
  it("classifies one-sided and two-sided flow", () => {
    expect(flowStyle({ netUsd: 9, totalUsd: 9, tradeCount: 10 })).toBe("one-sided");
    expect(flowStyle({ netUsd: 4, totalUsd: 20, tradeCount: 9_000 })).toBe("two-sided");
    expect(flowStyle({ netUsd: 4, totalUsd: 20, tradeCount: 50 })).toBe("mixed");
  });

  it("builds buyers and sellers with labels and average entry", () => {
    const leaders = buildLeaders(BATCH);
    expect(leaders.map((leader) => [leader.cohort, leader.rank, leader.label, leader.style])).toEqual([
      ["buyer", 1, null, "one-sided"],
      ["buyer", 2, "Wintermute", "two-sided"],
      ["seller", 1, null, "one-sided"],
    ]);
    expect(leaders[0].avgEntry).toBe(90);
    expect(cohortAverageEntry(leaders.filter((leader) => leader.cohort === "buyer"))).toBeCloseTo(90, 6); // the two-sided wallet is excluded
    expect(leaders[1].avgEntry).toBeNull();
  });

  it("measures exposure to one asset across perps and spot", () => {
    const exposure = assetExposure({
      snapshot: snapshotWith([
        { coin: "HYPE", side: "SHORT", positionValueUsd: 1_000, unrealizedPnlUsd: -50, entryPrice: 80, markPrice: 84, leverage: 5, liquidationPrice: 120 },
        { coin: "BTC", side: "LONG", positionValueUsd: 5_000, unrealizedPnlUsd: 0 },
      ]),
      spotState: { balances: [{ coin: "HYPE", total: "10" }, { coin: "USDC", total: "999" }] },
      prices: new Map([["HYPE", 84]]),
      symbol: "HYPE",
    });
    // A $1K perp short against $840 of spot nets to -$160: hedged, not short.
    expect(exposure).toMatchObject({ perpUsd: -1_000, spotUsd: 840, netUsd: -160, side: "hedged", entryPrice: 80, liquidationPrice: 120 });
    expect(exposureAmount(exposure)).toBe(1_000);
    expect(assetExposure({ snapshot: snapshotWith([]), spotState: null, prices: new Map(), symbol: "HYPE" }).side).toBe("flat");
  });

  it("classifies sides by net exposure and spots hedges", () => {
    expect(exposureSide(5_000, 0)).toBe("long");
    expect(exposureSide(0, 2_000)).toBe("spot");
    expect(exposureSide(-5_000, 0)).toBe("short");
    expect(exposureSide(-5_000, 1_000)).toBe("short");
    expect(exposureSide(-5_000, 4_500)).toBe("hedged");
    expect(exposureSide(-5_000, 5_200)).toBe("hedged");
    expect(exposureSide(0, 0)).toBe("flat");
  });

  it("explains what buyers and sellers hold now", () => {
    const leaders = buildLeaders(BATCH);
    const exposures = new Map([
      [ADDR(1), { side: "long", perpUsd: 8_000_000, spotUsd: 0, netUsd: 8_000_000 }],
      // Short the perp but holding some spot: the short itself is what counts.
      [ADDR(2), { side: "short", perpUsd: -1_000_000, spotUsd: 300_000, netUsd: -700_000 }],
      [ADDR(3), { side: "long", perpUsd: 2_000_000, spotUsd: 0, netUsd: 2_000_000 }],
    ]);
    const signals = buildLeaderSignals({
      leaders,
      exposures,
      symbol: "HYPE",
      windowLabel: "24h",
      markPrice: 84,
      positioningByCohort: { buyer: [], seller: [] },
      myAddresses: new Set([ADDR(3)]),
    });
    const text = signals.map((signal) => signal.text).join("\n");
    expect(text).toContain("1 of 2 top HYPE buyers (24h) are net long HYPE now, $8.0M in total. 1 is still net short ($700K), so part of the buying was covering.");
    expect(text).toContain("0 of 1 top HYPE sellers are net short now ($0); 0 have no HYPE left. 1 still hold HYPE net long ($2.0M)");
    expect(text).toContain("likely market makers, including Wintermute");
    expect(text).toContain("Also on your tracked list:");
  });
});
