import { useState } from "react";

// Token icons saved under public/hyperliquid/coins/. Crypto perps come from
// Hyperliquid (app.hyperliquid.xyz/coins/<COIN>.svg); xyz__ tradfi perps from
// HypurrScan (hypurrscan.io/perps/<NAME>.svg). Keep this in sync with the files
// in that directory — names that aren't listed fall back to a colored badge.
const LOCAL_TOKEN_ICONS = new Set([
  "AAVE",
  "ADA",
  "AERO",
  "AI16Z",
  "ALGO",
  "APE",
  "APT",
  "ARB",
  "ASTER",
  "ATOM",
  "AVAX",
  "AXS",
  "BCH",
  "BERA",
  "BLUR",
  "BNB",
  "BONK",
  "BTC",
  "CHZ",
  "COMP",
  "CRV",
  "DOGE",
  "DOT",
  "DYDX",
  "EIGEN",
  "ENA",
  "ENS",
  "ETH",
  "FARTCOIN",
  "FET",
  "FIL",
  "GALA",
  "GAS",
  "GMX",
  "GOAT",
  "HBAR",
  "HYPE",
  "IMX",
  "INJ",
  "JTO",
  "JUP",
  "KAS",
  "LDO",
  "LINK",
  "LIT",
  "LTC",
  "ME",
  "MKR",
  "MOODENG",
  "MORPHO",
  "MOVE",
  "NEAR",
  "NEIRO",
  "ONDO",
  "OP",
  "ORDI",
  "PENGU",
  "PEPE",
  "PNUT",
  "POL",
  "POPCAT",
  "PYTH",
  "RENDER",
  "RUNE",
  "S",
  "SAND",
  "SEI",
  "SNX",
  "SOL",
  "STRK",
  "STX",
  "SUI",
  "SUSHI",
  "TAO",
  "TIA",
  "TON",
  "TRX",
  "TURBO",
  "UNI",
  "VIRTUAL",
  "W",
  "WIF",
  "WLD",
  "XLM",
  "XMR",
  "XRP",
  "YGG",
  "ZEC",
  "ZK",
  "ZRO",
  "xyz__AAPL",
  "xyz__AMD",
  "xyz__AMZN",
  "xyz__COIN",
  "xyz__GOOGL",
  "xyz__HIMS",
  "xyz__HOOD",
  "xyz__LLY",
  "xyz__META",
  "xyz__MSFT",
  "xyz__MSTR",
  "xyz__MU",
  "xyz__NFLX",
  "xyz__NVDA",
  "xyz__PLTR",
  "xyz__SP500",
  "xyz__TSLA",
  "xyz__XYZ100",
]);

const TOKEN_FALLBACKS = {
  NEAR: {
    "--token-bg": "#be35cf",
    "--token-highlight": "#f08aff",
    "--token-fg": "#05020a",
  },
  WLD: {
    "--token-bg": "#335fe2",
    "--token-highlight": "#83a5ff",
    "--token-fg": "#050713",
  },
  XMR: {
    "--token-bg": "#3e36d3",
    "--token-highlight": "#8d6cff",
    "--token-fg": "#050513",
  },
};

function getTokenFallbackStyle(normalizedCoin) {
  const preset = TOKEN_FALLBACKS[normalizedCoin.toUpperCase()];
  if (preset) {
    return preset;
  }

  return {
    "--token-hue": `${Math.abs(
      normalizedCoin.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0),
    ) % 360}deg`,
  };
}

export default function TokenMark({ coin }) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedCoin = String(coin ?? "").replace(/^[a-z0-9]+:/i, "").trim().toUpperCase();
  const label = normalizedCoin.slice(0, normalizedCoin.length <= 3 ? 2 : 1).toUpperCase();
  const rawCoin = String(coin ?? "").trim();
  const rawIconName = rawCoin.replace(/^xyz:/i, "xyz__").replace(/[/:]/g, "__");
  const iconName = rawIconName.startsWith("xyz__")
    ? `xyz__${rawIconName.slice("xyz__".length).toUpperCase()}`
    : rawIconName.toUpperCase();
  const iconSrc = iconName ? `/hyperliquid/coins/${iconName}.svg` : "";
  const hasLocalIcon = LOCAL_TOKEN_ICONS.has(iconName);

  if (hasLocalIcon && iconSrc && !imageFailed) {
    return (
      <span className="qf-position-token qf-position-token--image">
        <img
          src={iconSrc}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className="qf-position-token"
      style={getTokenFallbackStyle(normalizedCoin)}
      aria-hidden="true"
    >
      {label || "?"}
    </span>
  );
}
