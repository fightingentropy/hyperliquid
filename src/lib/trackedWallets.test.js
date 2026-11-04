import { describe, expect, it } from "vitest";
import {
  buildBigMoves,
  buildCapitalFlows,
  buildFlowTimeline,
  buildLiquidationWatch,
  buildNetFlows,
  buildPositioning,
  buildSharedCounterparties,
  buildSignals,
  buildSpotPairNames,
  buildWalletSnapshot,
  describeCoin,
  isHyperEvmSystemAddress,
} from "./trackedWallets";

const A = { address: "0xaaaa000000000000000000000000000000000001", label: "Alpha" };
const B = { address: "0xbbbb000000000000000000000000000000000002", label: "Beta" };
const HOUR = 60 * 60 * 1000;
const NOW = 1_000 * HOUR;

const SPOT_META = [
  {
    tokens: [
      { name: "USDC", index: 0 },
      { name: "HYPE", index: 150 },
      { name: "UBTC", index: 197 },
    ],
    universe: [
      { name: "@107", tokens: [150, 0], index: 107 },
      { name: "@142", tokens: [197, 0], index: 142 },
    ],
  },
  [{ coin: "@107", midPx: "80" }],
];
const PAIRS = buildSpotPairNames(SPOT_META);

function fill(overrides) {
  return { coin: "HYPE", side: "B", sz: "100", px: "80", time: NOW - HOUR, closedPnl: "0", fee: "1", dir: "Open Long", oid: 1, ...overrides };
}

function position({ coin, szi, value, entry, liq = null, pnl = 0 }) {
  return {
    position: {
      coin,
      szi: String(szi),
      positionValue: String(value),
      entryPx: String(entry),
      unrealizedPnl: String(pnl),
      liquidationPx: liq === null ? null : String(liq),
      leverage: { value: 5 },
      returnOnEquity: "0",
      cumFunding: { sinceOpen: "0" },
      marginUsed: "0",
    },
  };
}

function snapshot(wallet, assetPositions, accountValue = 1_000_000) {
  return buildWalletSnapshot({
    wallet,
    clearinghouseEntries: [{ dex: "", state: { marginSummary: { accountValue: String(accountValue), totalNtlPos: "0" }, assetPositions } }],
    spotState: { balances: [] },
    stakingSummary: null,
    spotMetaAndAssetCtxs: SPOT_META,
    hypeMid: 80,
  });
}

describe("describeCoin", () => {
  it("maps spot pairs, HIP-3 markets and wrapped spot tokens", () => {
    expect(describeCoin("BTC", PAIRS)).toEqual({ symbol: "BTC", market: "perp" });
    expect(describeCoin("@107", PAIRS)).toEqual({ symbol: "HYPE", market: "spot" });
    expect(describeCoin("@142", PAIRS)).toEqual({ symbol: "BTC", market: "spot" });
    expect(describeCoin("PURR/USDC", PAIRS)).toEqual({ symbol: "PURR", market: "spot" });
    expect(describeCoin("xyz:NVDA", PAIRS)).toEqual({ symbol: "NVDA", market: "xyz" });
  });

  it("recognizes HyperEVM system addresses", () => {
    expect(isHyperEvmSystemAddress("0x2000000000000000000000000000000000000000")).toBe(true);
    expect(isHyperEvmSystemAddress("0x200000000000000000000000000000000000034b")).toBe(true);
    expect(isHyperEvmSystemAddress("0x2222222222222222222222222222222222222222")).toBe(true);
    expect(isHyperEvmSystemAddress(A.address)).toBe(false);
  });
});

describe("buildPositioning", () => {
  it("groups longs and shorts per asset across wallets, largest first", () => {
    const rows = buildPositioning([
      snapshot(A, [position({ coin: "HYPE", szi: 1000, value: 80_000, entry: 70 }), position({ coin: "xyz:NVDA", szi: -10, value: 2_000, entry: 210 })]),
      snapshot(B, [position({ coin: "HYPE", szi: -500, value: 40_000, entry: 90 })]),
    ]);
    expect(rows.map((row) => row.symbol)).toEqual(["HYPE", "NVDA"]);
    expect(rows[0]).toMatchObject({ longUsd: 80_000, shortUsd: 40_000, netUsd: 40_000, grossUsd: 120_000 });
    expect(rows[0].longs[0].name).toBe("Alpha");
    expect(rows[0].shorts[0].name).toBe("Beta");
    expect(rows[1].markets).toEqual(["xyz"]);
  });
});

describe("buildNetFlows", () => {
  const walletFills = [
    {
      wallet: A,
      fills: [
        fill({ side: "B", sz: "1000", px: "80" }),
        fill({ coin: "@107", side: "B", sz: "100", px: "80", oid: 2 }),
        fill({ side: "A", sz: "250", px: "80", closedPnl: "500", oid: 3, dir: "Close Long" }),
        fill({ side: "B", sz: "999", px: "80", time: NOW - 30 * HOUR, oid: 4 }),
      ],
    },
    { wallet: B, fills: [fill({ coin: "BTC", side: "A", sz: "1", px: "90000", oid: 5, dir: "Open Short" })] },
  ];

  it("nets buys against sells per asset inside the window, spot and perp together", () => {
    const flows = buildNetFlows(walletFills, { since: NOW - 24 * HOUR, spotPairNames: PAIRS });
    const hype = flows.assets.find((asset) => asset.symbol === "HYPE");
    expect(hype).toMatchObject({ buyUsd: 88_000, sellUsd: 20_000, netUsd: 68_000, spotNetUsd: 8_000, perpNetUsd: 60_000, trades: 3 });
    expect(flows.assets[0].symbol).toBe("BTC");
    expect(flows.byWallet[0]).toMatchObject({ name: "Alpha", netUsd: 68_000, realizedPnlUsd: 500, trades: 3 });
    expect(flows.totals.netUsd).toBe(-22_000);
  });

  it("buckets flow over time for one asset", () => {
    const buckets = buildFlowTimeline(walletFills, { since: NOW - 24 * HOUR, until: NOW, bucketMs: 6 * HOUR, symbol: "HYPE", spotPairNames: PAIRS });
    const total = buckets.reduce((sum, bucket) => sum + bucket.netUsd, 0);
    expect(total).toBe(68_000);
    expect(buckets.every((bucket) => bucket.start % (6 * HOUR) === 0)).toBe(true);
  });

  it("merges runs of same-direction fills into moves and splits on long gaps", () => {
    const moves = buildBigMoves(
      [
        {
          wallet: A,
          fills: [
            fill({ oid: 1, sz: "100", time: NOW - 5 * HOUR }),
            fill({ oid: 2, sz: "50", time: NOW - 4 * HOUR }),
            fill({ oid: null, twapId: 7, sz: "10", time: NOW - 3.5 * HOUR }),
            fill({ oid: 3, sz: "40", time: NOW - 0.5 * HOUR }),
            fill({ oid: 4, sz: "30", side: "A", dir: "Close Long", time: NOW - 4 * HOUR }),
          ],
        },
      ],
      { since: NOW - 24 * HOUR, spotPairNames: PAIRS },
    );
    expect(moves).toHaveLength(3);
    expect(moves[0]).toMatchObject({ dir: "Open Long", size: 160, notionalUsd: 12_800, fills: 3, isTwap: true, avgPrice: 80 });
    expect(moves[1]).toMatchObject({ dir: "Open Long", size: 40, fills: 1 });
    expect(moves[2]).toMatchObject({ dir: "Close Long", size: 30 });
  });
});

describe("buildCapitalFlows", () => {
  it("separates bridge, HyperEVM and wallet-to-wallet moves and skips self transfers", () => {
    const self = A.address;
    const at = NOW - HOUR;
    const [row] = buildCapitalFlows(
      [
        {
          wallet: A,
          ledger: [
            { time: at, delta: { type: "deposit", usdc: "1000" } },
            { time: at, delta: { type: "withdraw", usdc: "400" } },
            { time: at, delta: { type: "send", user: self, destination: "0x2000000000000000000000000000000000000000", token: "USDC", amount: "300", usdcValue: "300" } },
            { time: at, delta: { type: "spotTransfer", user: "0x200000000000000000000000000000000000034b", destination: self, token: "DRV", amount: "10", usdcValue: "50" } },
            { time: at, delta: { type: "send", user: self, destination: self, token: "USDC", amount: "999" } },
            { time: at, delta: { type: "send", user: self, destination: B.address, token: "HYPE", amount: "2" } },
            { time: at, delta: { type: "cStakingTransfer", token: "HYPE", amount: "5", isDeposit: false } },
            { time: NOW - 48 * HOUR, delta: { type: "deposit", usdc: "77777" } },
          ],
        },
      ],
      { since: NOW - 24 * HOUR, prices: new Map([["HYPE", 80]]) },
    );
    expect(row).toMatchObject({
      bridgeInUsd: 1000,
      bridgeOutUsd: 400,
      evmOutUsd: 300,
      evmInUsd: 50,
      transferOutUsd: 160,
      unstakedHype: 5,
      inUsd: 1050,
      outUsd: 860,
      netUsd: 190,
    });
  });
});

describe("buildSharedCounterparties", () => {
  it("finds an outside address that funded two tracked wallets", () => {
    const funder = "0x6b9e773128f453f5c2c60935ee2de2cbc5390a24";
    const at = NOW - HOUR;
    const flows = buildCapitalFlows(
      [
        { wallet: A, ledger: [{ time: at, delta: { type: "send", user: funder, destination: A.address, token: "USDC", amount: "600000", usdcValue: "600000" } }] },
        { wallet: B, ledger: [{ time: at, delta: { type: "send", user: funder, destination: B.address, token: "USDC", amount: "1000000", usdcValue: "1000000" } }] },
      ],
      { since: NOW - 24 * HOUR, prices: new Map() },
    );
    const [shared] = buildSharedCounterparties(flows);
    expect(shared).toMatchObject({ address: funder, inUsd: 1_600_000, outUsd: 0 });
    expect(shared.wallets.map((wallet) => wallet.name)).toEqual(["Alpha", "Beta"]);

    const signals = buildSignals({
      positioning: [],
      netFlows: buildNetFlows([], { since: 0 }),
      liquidationWatch: [],
      snapshots: [],
      capitalFlows: flows,
      windowLabel: "24h",
    });
    expect(signals.map((signal) => signal.text)).toContain("Shared counterparty: 0x6b9e…0a24 sent $1.6M to Alpha and Beta in 24h.");
  });
});

describe("buildLiquidationWatch", () => {
  it("measures distance from mark to liquidation for longs and shorts, closest first", () => {
    const rows = buildLiquidationWatch([
      snapshot(A, [position({ coin: "HYPE", szi: 1000, value: 83_500, entry: 38, liq: 74.69 })]),
      snapshot(B, [position({ coin: "BTC", szi: -1, value: 80_000, entry: 78_000, liq: 120_000 }), position({ coin: "ETH", szi: 1, value: 2_400, entry: 2_400 })]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe("HYPE");
    expect(rows[0].distancePct).toBeCloseTo(10.55, 1);
    expect(rows[1].distancePct).toBeCloseTo(50, 5);
  });
});

describe("buildSignals", () => {
  it("writes buy, split, risk and quiet-wallet findings", () => {
    const snapshots = [
      snapshot(A, [position({ coin: "HYPE", szi: 1000, value: 83_500, entry: 38, liq: 74.69 })]),
      snapshot(B, [position({ coin: "HYPE", szi: -1000, value: 83_500, entry: 90 })]),
    ];
    const netFlows = buildNetFlows(
      [
        { wallet: A, fills: [fill({ sz: "10000", px: "80" })] },
        { wallet: B, fills: [] },
      ],
      { since: NOW - 24 * HOUR, spotPairNames: PAIRS },
    );
    const signals = buildSignals({
      positioning: buildPositioning(snapshots),
      netFlows,
      liquidationWatch: buildLiquidationWatch(snapshots),
      snapshots,
      capitalFlows: [],
      windowLabel: "24h",
    });
    const text = signals.map((signal) => signal.text).join("\n");
    expect(text).toContain("Most net buying in 24h: $800K of HYPE, led by Alpha.");
    expect(text).toContain("Split on HYPE: 1 long");
    expect(text).toContain("Alpha's $84K HYPE long is 10.6% from liquidation at $74.69.");
    expect(text).toContain("Beta hasn't traded in 24h.");
  });
});
