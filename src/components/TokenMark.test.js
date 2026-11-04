import { describe, expect, it } from "vitest";
import { hyperliquidIconUrl } from "./TokenMark";

describe("hyperliquidIconUrl", () => {
  it("uses the market name as Hyperliquid spells it", () => {
    expect(hyperliquidIconUrl("BTC")).toBe("https://app.hyperliquid.xyz/coins/BTC.svg");
    expect(hyperliquidIconUrl("kPEPE")).toBe("https://app.hyperliquid.xyz/coins/kPEPE.svg");
    expect(hyperliquidIconUrl("xyz:SKHX")).toBe("https://app.hyperliquid.xyz/coins/xyz:SKHX.svg");
    expect(hyperliquidIconUrl("XYZ:BRENTOIL")).toBe("https://app.hyperliquid.xyz/coins/xyz:BRENTOIL.svg");
  });

  it("has no icon for spot pairs or empty names", () => {
    expect(hyperliquidIconUrl("@107")).toBe("");
    expect(hyperliquidIconUrl("PURR/USDC")).toBe("");
    expect(hyperliquidIconUrl("")).toBe("");
    expect(hyperliquidIconUrl(null)).toBe("");
  });
});
