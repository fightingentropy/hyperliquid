import { describe, expect, it } from "vitest";
import {
  buildFlowLayout,
  buildMonthComparison,
  buildMonthTiles,
  buildSummaryClauses,
  classifyWallet,
  formatCompactToken,
  formatDelta,
  formatTokenAmount,
  formatUsdValue,
  monthShortLabel,
  normalizeWalletRow,
  normalizeWalletRows,
  sortWalletRows,
  summarizeWallets,
} from "./teamDistribution";

function rawWallet(address, { received, spot = 0, staked = 0, sent = 0, sold = 0, sentUsd = 0 }) {
  return {
    wallet: { id: `id-${address}`, address, globalLabel: null },
    memberLabel: null,
    receivedFromHyperLabs: `${received}`,
    sentOutTotal: `${sent}`,
    sentOutUsd: `${sentUsd}`,
    soldToken: `${sold}`,
    soldUsd: "0",
    currentBalance: `${spot}`,
    currentStakedBalance: `${staked}`,
    currentTotalBalance: `${spot + staked}`,
    currentUsdValue: "0",
  };
}

// Rows taken from the live team-wallets payload, one or two per category.
const RAW_WALLETS = [
  rawWallet("0xsent", { received: 750_000, sent: 750_000, sentUsd: 66_142_125.24 }),
  rawWallet("0xsentdust", { received: 50_000, sent: 49_999.33, spot: 0.67 }),
  rawWallet("0xsentsold", { received: 75_000, sent: 65_000, sold: 10_000 }),
  rawWallet("0xsold", { received: 75_000, sent: 15_000, sold: 60_000 }),
  rawWallet("0xsoldstake", { received: 50_000, sold: 49_247.25, staked: 752.75 }),
  rawWallet("0xkeptsome", { received: 170_620, sent: 4_909, sold: 154_178.26057353, spot: 11_532.73942647 }),
  rawWallet("0xtenpct", { received: 2_000, sold: 200, staked: 1_800 }),
  rawWallet("0xstaked", { received: 75_000, staked: 75_000 }),
  rawWallet("0xkept", { received: 9_375, sold: 10, spot: 9_365 }),
];

describe("team distribution wallet categories", () => {
  it("classifies wallets the same way qwantify does", () => {
    const categories = normalizeWalletRows(RAW_WALLETS).map((row) => [row.address, row.category]);

    expect(categories).toEqual([
      ["0xsent", "sent"],
      ["0xsentdust", "sent"],
      ["0xsentsold", "sentSold"],
      ["0xsold", "sold"],
      ["0xsoldstake", "sold"],
      ["0xkeptsome", "keptSome"],
      ["0xtenpct", "keptSome"],
      ["0xstaked", "staked"],
      ["0xkept", "kept"],
    ]);
  });

  it("treats a wallet that received nothing as kept", () => {
    expect(classifyWallet({ received: 0, kept: 0, staked: 0, sent: 0, sold: 0 })).toBe("kept");
  });

  it("parses string amounts and derives held and out share", () => {
    const row = normalizeWalletRow(RAW_WALLETS[5]);

    expect(row.received).toBe(170_620);
    expect(row.held).toBeCloseTo(11_532.7394, 4);
    expect(row.outShare).toBeCloseTo(0.9324, 4);
  });
});

describe("team distribution summaries", () => {
  const summary = summarizeWallets(normalizeWalletRows(RAW_WALLETS));

  it("totals every outcome and stays balanced", () => {
    const { received, kept, staked, sent, sold } = summary.totals;

    expect(summary.walletCount).toBe(9);
    expect(received).toBe(1_256_995);
    expect(kept + staked + sent + sold).toBeCloseTo(received, 6);
  });

  it("counts wallets and tokens per category", () => {
    const byKey = Object.fromEntries(
      summary.categories.map((category) => [category.key, [category.count, category.received]]),
    );

    expect(byKey).toEqual({
      sent: [2, 800_000],
      sentSold: [1, 75_000],
      sold: [2, 125_000],
      keptSome: [2, 172_620],
      staked: [1, 75_000],
      kept: [1, 9_375],
    });
  });

  it("leads the summary sentence with the two largest categories", () => {
    const clauses = buildSummaryClauses(summary);

    expect(clauses.map((clause) => [clause.key, clause.count])).toEqual([
      ["sent", 2],
      ["keptSome", 2],
    ]);
    expect(clauses[0].verb).toBe("sent it all away");
    expect(clauses[0].share).toBeCloseTo(800_000 / 1_256_995, 6);
  });

  it("lays out a flow where every link fits its nodes", () => {
    const layout = buildFlowLayout(summary, { width: 1152, height: 320 });

    expect(layout.categories.map((node) => node.key)).toEqual([
      "sent",
      "sentSold",
      "sold",
      "keptSome",
      "staked",
      "kept",
    ]);
    expect(layout.outcomes.map((node) => node.key)).toEqual(["sent", "sold", "staked", "kept"]);
    layout.categories.concat(layout.outcomes).forEach((node) => {
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y + node.height).toBeLessThanOrEqual(320);
    });
    // One link into each category, then one per non-empty category → outcome pair.
    expect(layout.links.filter((link) => link.outcome === null)).toHaveLength(6);
    expect(layout.links.find((link) => link.key === "sentSold:sold")).toBeTruthy();
    expect(layout.links.find((link) => link.key === "sent:sold")).toBeUndefined();
  });

  it("returns no layout without distributed tokens", () => {
    expect(buildFlowLayout(summarizeWallets([]))).toBeNull();
  });
});

describe("team distribution months", () => {
  const overview = {
    walletCount: 3,
    totals: {
      distributedFromHyperLabs: "1100",
      sentOutTotal: "800",
      soldToken: "100",
      currentSpotBalance: "150",
      currentStakedBalance: "50",
    },
    months: [
      {
        id: "sep",
        label: "September 2026",
        startAt: "2026-08-24T21:34:00.000Z",
        endAt: "2026-09-30T21:34:00.000Z",
        distributedFromHyperLabs: "100",
        sentOutTotal: "0",
        soldToken: "0",
        currentSpotBalance: "100",
        currentStakedBalance: "0",
      },
      {
        id: "oct",
        label: "October 2026",
        startAt: "2026-09-27T11:39:00.000Z",
        endAt: "2026-11-01T12:39:00.000Z",
        distributedFromHyperLabs: "1000",
        sentOutTotal: "800",
        soldToken: "100",
        currentSpotBalance: "50",
        currentStakedBalance: "50",
      },
    ],
  };
  const monthsMeta = [
    { id: "oct", walletCount: 2 },
    { id: "sep", walletCount: 1 },
  ];
  const tiles = buildMonthTiles(overview, monthsMeta, Date.parse("2026-10-19T12:00:00.000Z"));

  it("puts All months first, then months newest to oldest", () => {
    expect(tiles.map((tile) => [tile.id, tile.shortLabel, tile.walletCount, tile.isOpen])).toEqual([
      ["all", "All months", 3, false],
      ["oct", "Oct ’26", 2, true],
      ["sep", "Sep ’26", 1, false],
    ]);
    expect(tiles[0].rangeLabel).toBe("September 2026 – October 2026");
    expect(tiles[0].heldShare).toBeCloseTo(200 / 1100, 6);
  });

  it("compares a month with the one before it", () => {
    const comparison = buildMonthComparison(tiles[1], tiles[2]);

    expect(comparison.previousLabel).toBe("September 2026");
    expect(formatDelta(comparison.heldDeltaPp, "pp")).toBe("↓ -90.0pp");
    expect(formatDelta(comparison.soldDeltaPp, "pp")).toBe("↑ +10.0pp");
    expect(formatDelta(comparison.distributedChangePct, "%")).toBe("↑ +900%");
    expect(buildMonthComparison(tiles[2], undefined)).toBeNull();
  });

  it("drops the arrow for changes that round to nothing", () => {
    expect(formatDelta(0.2, "pp")).toBe("+0.2pp");
    expect(formatDelta(-0.01, "pp")).toBe("-0.0pp");
    expect(formatDelta(0.09, "%")).toBe("+0%");
  });

  it("shortens month labels", () => {
    expect(monthShortLabel("December 2025")).toBe("Dec ’25");
  });
});

describe("team distribution table helpers", () => {
  it("sorts by a column and keeps ties in payload order", () => {
    const rows = normalizeWalletRows(RAW_WALLETS);
    const byOut = sortWalletRows(rows, "outShare", "desc").map((row) => row.address);

    expect(byOut.slice(0, 3)).toEqual(["0xsent", "0xsentsold", "0xsold"]);
    expect(sortWalletRows(rows, "received", "asc")[0].address).toBe("0xtenpct");
    expect(sortWalletRows(rows, "status", "asc").at(-1).address).toBe("0xkept");
  });

  it("formats token and USD amounts like qwantify", () => {
    expect(formatTokenAmount(187_525.26223228)).toBe("187,525.2622");
    expect(formatCompactToken(9_542_470)).toBe("9.54M");
    expect(formatCompactToken(693.68998689)).toBe("693.69");
    expect(formatUsdValue(0.17)).toBe("$0.17");
    expect(formatUsdValue(865_600)).toBe("$865.6K");
    expect(formatUsdValue(14_650_000)).toBe("$14.65M");
  });
});
