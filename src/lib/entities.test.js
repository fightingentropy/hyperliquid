import { describe, expect, it } from "vitest";
import {
  filterEntities,
  isLinkText,
  normalizeEntities,
  normalizeEntityWallets,
  runWithConcurrency,
  summarizeEntityBalances,
  summarizeWalletBalance,
} from "./entities";

const RAW_ENTITIES = [
  {
    id: "a",
    name: "CoinSpot",
    entityType: "organization",
    description: "CEX hot-wallet cluster for CoinSpot",
    twitterHandle: "@coinspotau",
    twitterUrl: "https://x.com/coinspotau",
    isActive: true,
    trackingConfig: { trackFills: false },
  },
  {
    id: "b",
    name: "KoolKrypto",
    entityType: "person",
    description: "",
    twitterHandle: "@koolkrypto223",
    isActive: true,
    trackingConfig: { trackFills: true },
  },
  { id: "c", name: "Gone", entityType: "person", isActive: false },
];

// HYPE/USDC is spot pair @107 priced at 80; USDC is a stable at 1.
const SPOT_META = [
  {
    tokens: [
      { name: "USDC", index: 0 },
      { name: "HYPE", index: 150 },
    ],
    universe: [{ tokens: [150, 0], index: 107 }],
  },
  [{ coin: "@107", midPx: "80" }],
];

describe("entities", () => {
  it("normalizes entities and drops inactive ones", () => {
    const entities = normalizeEntities(RAW_ENTITIES);
    expect(entities.map((entity) => entity.id)).toEqual(["a", "b"]);
    expect(entities[0]).toMatchObject({
      name: "CoinSpot",
      type: "organization",
      twitterHandle: "@coinspotau",
      trackFills: false,
    });
    expect(entities[1].trackFills).toBe(true);
    expect(normalizeEntities(null)).toEqual([]);
  });

  it("filters by type and searches name, description and handle", () => {
    const entities = normalizeEntities(RAW_ENTITIES);
    expect(filterEntities(entities, { type: "person" }).map((e) => e.id)).toEqual(["b"]);
    expect(filterEntities(entities, { query: "hot-wallet" }).map((e) => e.id)).toEqual(["a"]);
    expect(filterEntities(entities, { query: "KOOL" }).map((e) => e.id)).toEqual(["b"]);
    expect(filterEntities(entities, { query: "coinspot", type: "person" })).toEqual([]);
  });

  it("recognizes bare URLs in descriptions", () => {
    expect(isLinkText("https://hermeneutic.com")).toBe(true);
    expect(isLinkText("CEX hot-wallet cluster")).toBe(false);
  });

  it("normalizes linked wallets and drops duplicates and bad addresses", () => {
    const wallets = normalizeEntityWallets([
      {
        wallet: { address: "0x60f9e80d0d40b2958ac39006635de782096866c3", type: "exchange", globalLabel: null },
        relationType: "owned",
      },
      { wallet: { address: "0x60F9E80D0D40B2958AC39006635DE782096866C3" }, relationType: "owned" },
      { wallet: { address: "not-an-address" } },
    ]);
    expect(wallets).toEqual([
      {
        address: "0x60f9e80d0d40b2958ac39006635de782096866c3",
        type: "exchange",
        label: null,
        relation: "owned",
      },
    ]);
  });

  it("sums perps, spot and staked HYPE for one wallet", () => {
    const balance = summarizeWalletBalance({
      clearinghouseEntries: [
        {
          dex: "",
          state: {
            marginSummary: { accountValue: "1000", totalNtlPos: "5000" },
            assetPositions: [
              { position: { coin: "BTC", szi: "0.05", positionValue: "5000", entryPx: "90000", unrealizedPnl: "500" } },
            ],
          },
        },
        { dex: "xyz", state: { marginSummary: { accountValue: "200", totalNtlPos: "0" }, assetPositions: [] } },
      ],
      spotState: {
        balances: [
          { coin: "USDC", total: "300", hold: "0", entryNtl: "0" },
          { coin: "HYPE", total: "2", hold: "0", entryNtl: "100" },
        ],
      },
      stakingSummary: { delegated: "10", undelegated: "1", totalPendingWithdrawal: "1" },
      spotMetaAndAssetCtxs: SPOT_META,
      hypeMid: 80,
    });

    expect(balance).toMatchObject({
      perpsUsd: 1200,
      spotUsd: 460,
      stakedHype: 12,
      stakedUsd: 960,
      totalUsd: 2620,
      openPositions: 1,
      notionalUsd: 5000,
      unrealizedPnlUsd: 500,
    });
  });

  it("leaves staking empty until it has loaded", () => {
    const balance = summarizeWalletBalance({
      clearinghouseEntries: [],
      spotState: { balances: [{ coin: "USDC", total: "50", hold: "0", entryNtl: "0" }] },
      stakingSummary: null,
      spotMetaAndAssetCtxs: SPOT_META,
      hypeMid: 80,
    });
    expect(balance.stakedHype).toBeNull();
    expect(balance.totalUsd).toBe(50);
  });

  it("totals loaded wallets and counts staking separately", () => {
    const summary = summarizeEntityBalances([
      { perpsUsd: 100, spotUsd: 10, stakedHype: 5, stakedUsd: 400, totalUsd: 510, openPositions: 2, notionalUsd: 900, unrealizedPnlUsd: -20 },
      null,
      { perpsUsd: 0, spotUsd: 5, stakedHype: null, stakedUsd: null, totalUsd: 5, openPositions: 0, notionalUsd: 0, unrealizedPnlUsd: 0 },
    ]);
    expect(summary).toMatchObject({
      loadedCount: 2,
      stakingLoadedCount: 1,
      stakingWalletCount: 1,
      perpsUsd: 100,
      spotUsd: 15,
      stakedHype: 5,
      totalUsd: 515,
      openPositions: 2,
    });
  });

  it("never runs more tasks at once than the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const done = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push(item);
      inFlight -= 1;
    });
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
