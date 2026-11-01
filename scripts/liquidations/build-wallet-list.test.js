import { describe, expect, it } from "vitest";
import { formatWalletList, selectWallets } from "./build-wallet-list.mjs";

const address = (n) => `0x${n.toString(16).padStart(40, "0")}`;

function row(n, accountValue, weekVlm, extra = {}) {
  return {
    ethAddress: address(n),
    accountValue: String(accountValue),
    windowPerformances: [
      ["day", { pnl: "0", roi: "0", vlm: "1" }],
      ["week", { pnl: "0", roi: "0", vlm: String(weekVlm) }],
      ["month", { pnl: "0", roi: "0", vlm: "1" }],
    ],
    ...extra,
  };
}

describe("selectWallets", () => {
  it("keeps accounts at or above the threshold with weekly volume, sorted by account value", () => {
    const rows = [
      row(1, 2_000_000, 10),
      row(2, 1_000_000, 5),
      row(3, 999_999.99, 5),
      row(4, 5_000_000, 0),
      row(5, 9_000_000, 1),
    ];

    expect(selectWallets(rows)).toEqual([address(5), address(1), address(2)]);
  });

  it("lowercases addresses, drops malformed ones and de-duplicates", () => {
    const upper = `0x${"AB".repeat(20)}`;
    const rows = [
      row(1, 3_000_000, 1, { ethAddress: upper }),
      row(2, 4_000_000, 1, { ethAddress: upper.toLowerCase() }),
      row(3, 5_000_000, 1, { ethAddress: "0x123" }),
      row(4, 5_000_000, 1, { ethAddress: null }),
      null,
    ];

    expect(selectWallets(rows)).toEqual([upper.toLowerCase()]);
  });

  it("treats a missing or malformed week window as no volume", () => {
    const rows = [
      row(1, 2_000_000, 1, { windowPerformances: [["day", { vlm: "9" }]] }),
      row(2, 2_000_000, 1, { windowPerformances: null }),
      row(3, 2_000_000, "not-a-number"),
    ];

    expect(selectWallets(rows)).toEqual([]);
  });

  it("breaks account value ties by address and honours a custom threshold", () => {
    const rows = [row(9, 500, 1), row(7, 500, 1), row(8, 400, 1)];

    expect(selectWallets(rows, { minAccountValue: 450 })).toEqual([address(7), address(9)]);
  });
});

describe("formatWalletList", () => {
  it("writes valid JSON with one address per line", () => {
    const text = formatWalletList({
      generatedAt: "2026-11-01T00:00:00.000Z",
      minAccountValue: 1_000_000,
      addresses: [address(1), address(2)],
    });

    expect(JSON.parse(text)).toEqual({
      generatedAt: "2026-11-01T00:00:00.000Z",
      minAccountValue: 1_000_000,
      addresses: [address(1), address(2)],
    });
    expect(text.split("\n").filter((line) => line.includes("0x"))).toHaveLength(2);
    expect(text.endsWith("\n")).toBe(true);
  });
});
