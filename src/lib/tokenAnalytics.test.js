import { describe, expect, it } from "vitest";
import {
  buildDistributionBuckets,
  computeDistributionStats,
  formatTokenAmount,
  listSpotTokens,
  parseGenesisBalances,
  parseHolderBalances,
} from "./tokenAnalytics";

describe("computeDistributionStats", () => {
  it("averages the two middle values for an even count", () => {
    const stats = computeDistributionStats([10, 1, 4, 3]);

    expect(stats).toEqual({ count: 4, min: 1, max: 10, median: 3.5, average: 4.5 });
  });

  it("takes the middle value for an odd count", () => {
    expect(computeDistributionStats([5, 1, 9]).median).toBe(5);
  });

  it("returns null without data", () => {
    expect(computeDistributionStats([])).toBeNull();
  });
});

describe("buildDistributionBuckets", () => {
  it("uses 1-2-5 log buckets when the spread is wide", () => {
    const values = [
      ...Array.from({ length: 5 }, () => 1.5), // (1, 2]
      ...Array.from({ length: 5 }, () => 30), // (20, 50]
      ...Array.from({ length: 5 }, () => 400), // (200, 500]
    ];

    const { buckets, scale } = buildDistributionBuckets(values);

    expect(scale).toBe("log");
    // The empty (0, 1] bucket is dropped; empty middle buckets merge forward.
    expect(buckets.map((bucket) => [bucket.label, bucket.count])).toEqual([
      ["1 – 2", 5],
      ["2 – 50", 5],
      ["50 – 500", 5],
    ]);
  });

  it("puts a value equal to an edge in the bucket that ends there", () => {
    const values = [...Array.from({ length: 5 }, () => 1), ...Array.from({ length: 5 }, () => 100)];

    const { buckets } = buildDistributionBuckets(values);

    expect(buckets[0]).toMatchObject({ start: 0, end: 1, count: 5, label: "0 – 1" });
  });

  it("folds a sparse tail into the previous bucket", () => {
    const values = [...Array.from({ length: 10 }, () => 3), 40_000];

    const { buckets } = buildDistributionBuckets(values);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ start: 2, end: 50_000, count: 11, label: "2 – 50K" });
  });

  it("tracks cumulative holder and supply share", () => {
    const values = [
      ...Array.from({ length: 5 }, () => 1),
      ...Array.from({ length: 5 }, () => 99),
    ];

    const { buckets } = buildDistributionBuckets(values);
    const last = buckets[buckets.length - 1];

    expect(buckets[0].cumulativeHoldersPct).toBe(50);
    expect(buckets[0].cumulativeSupplyPct).toBeCloseTo(1, 6);
    expect(last.cumulativeHoldersPct).toBe(100);
    expect(last.cumulativeSupplyPct).toBeCloseTo(100, 6);
  });

  it("uses nice linear steps when the spread is narrow", () => {
    const values = Array.from({ length: 100 }, (_, index) => 10 + index * 0.1);

    const { buckets, scale } = buildDistributionBuckets(values);

    expect(scale).toBe("linear");
    expect(buckets.every((bucket) => bucket.count >= 5)).toBe(true);
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(100);
    // max 19.9 / 40 buckets -> 0.5 steps; the lone value in (9.5, 10] merges
    // forward until the bucket holds five entries.
    expect(buckets[0]).toMatchObject({ start: 9.5, end: 10.5, count: 6 });
  });

  it("thins edges to at most 40 buckets", () => {
    // 1e-3 .. 1e17 spans enough decades to need thinning.
    const values = Array.from({ length: 21 }, (_, index) => 10 ** (index - 3));

    const { buckets } = buildDistributionBuckets(values);

    expect(buckets.length).toBeLessThanOrEqual(40);
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(21);
  });

  it("handles empty and all-zero input", () => {
    expect(buildDistributionBuckets([])).toEqual({ buckets: [], scale: "linear" });

    const { buckets } = buildDistributionBuckets([0, 0, 0]);

    expect(buckets).toHaveLength(1);
    expect(buckets[0].count).toBe(3);
  });
});

describe("parsers", () => {
  it("reads genesis allocations as numbers", () => {
    const payload = {
      num_recipients: 3,
      genesis: {
        userBalances: [
          ["0xa", "437.36"],
          ["0xb", "12"],
          ["0xc", "not-a-number"],
        ],
      },
    };

    expect(parseGenesisBalances(payload)).toEqual([437.36, 12]);
    expect(parseGenesisBalances({ genesis: null })).toEqual([]);
  });

  it("keeps only positive holder balances", () => {
    expect(parseHolderBalances({ balances: [10, 0, 1e-8, -1, Number.NaN] })).toEqual([10, 1e-8]);
    expect(parseHolderBalances(null)).toEqual([]);
  });

  it("lists the spot tokens from the symbol maps", () => {
    const symbolMaps = { indexByToken: { USDC: 0, PURR: 1, hype: 150 } };

    expect(listSpotTokens(symbolMaps)).toEqual(["HYPE", "PURR", "USDC"]);
    expect(listSpotTokens(undefined)).toEqual([]);
  });
});

describe("formatTokenAmount", () => {
  it("formats like the Qwantify stat cards", () => {
    expect(formatTokenAmount(2692.8579, "KNTQ")).toBe("2,692.86 KNTQ");
    expect(formatTokenAmount(100_000, "KNTQ")).toBe("100,000 KNTQ");
    expect(formatTokenAmount(53_439_867.59, "HYPE")).toBe("53.44M HYPE");
    expect(formatTokenAmount(0.11, "HYPE")).toBe("0.11 HYPE");
    expect(formatTokenAmount(Number.NaN, "HYPE")).toBe("—");
  });
});
