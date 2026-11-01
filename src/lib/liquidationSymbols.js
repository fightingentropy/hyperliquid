// Hyperliquid perpetual markets shown on the liquidation map. This one list is shared by the
// page, the /api/liquidations/<coin> Pages Function and the liq-sweeper Worker, so the sweeper
// only stores what the API can serve. Names are Hyperliquid coin names and are case-sensitive
// (for example "kPEPE").
//
// MKR, IP and AI16Z were removed because Hyperliquid delisted them (meta isDelisted: true).
export const HYPERLIQUID_LIQUIDATION_SYMBOLS = [
  "ETH",
  "BTC",
  "LINK",
  "HYPE",
  "XRP",
  "SOL",
  "ADA",
  "SUI",
  "DOGE",
  "TIA",
  "LTC",
  "POPCAT",
  "ENA",
  "kPEPE",
  "TRUMP",
  "AVAX",
  "ONDO",
  "HBAR",
  "AAVE",
  "NEAR",
  "PURR",
  "KAITO",
  "XLM",
  "PNUT",
  "BERA",
  "FARTCOIN",
];

const TRACKED_SYMBOLS = new Set(HYPERLIQUID_LIQUIDATION_SYMBOLS);

export function isTrackedLiquidationSymbol(coin) {
  return typeof coin === "string" && TRACKED_SYMBOLS.has(coin);
}
