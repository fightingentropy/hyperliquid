import CryptoJS from "crypto-js";
import pako from "pako";
import { withQuery } from "./request";

const COINGLASS_LIQUIDATION_MAP_API =
  "https://capi.coinglass.com/api/hyperliquid/topPosition/liqMap";

const FIRST_KEY_SEEDS = {
  55: "170b070da9654622",
  66: "d6537d845a964081",
  77: "863f08689c97435b",
};

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
  "MKR",
  "ENA",
  "kPEPE",
  "TRUMP",
  "AVAX",
  "ONDO",
  "HBAR",
  "AAVE",
  "IP",
  "AI16Z",
  "NEAR",
  "PURR",
  "KAITO",
  "XLM",
  "PNUT",
  "BERA",
  "FARTCOIN",
];

function getBase64Prefix(value) {
  return btoa(value).slice(0, 16);
}

function normalizeCoinGlassUrl(url) {
  return url.replace(/^https:\/\/[fc]api\.coinglass\.com/i, "");
}

function getInitialDecryptKey({ responseHeaders, requestUrl, requestCacheTimestamp }) {
  const version = responseHeaders.get("v");
  const seed = version === "0"
    ? requestCacheTimestamp
    : version === "1"
      ? normalizeCoinGlassUrl(requestUrl)
      : version === "2"
        ? responseHeaders.get("time") ?? ""
        : FIRST_KEY_SEEDS[version] ?? "";

  if (!seed) {
    throw new Error("Unsupported CoinGlass encryption response.");
  }

  return getBase64Prefix(seed);
}

function decryptCompressedValue(encryptedValue, key) {
  const decryptedHex = CryptoJS.AES.decrypt(encryptedValue, CryptoJS.enc.Utf8.parse(key), {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Hex);

  if (!decryptedHex) {
    throw new Error("CoinGlass payload could not be decrypted.");
  }

  const compressedBytes = new Uint8Array(
    decryptedHex.match(/[\da-f]{2}/gi).map((part) => Number.parseInt(part, 16)),
  );
  let text = pako.inflate(compressedBytes, { to: "string" });

  if (text.startsWith('"')) {
    text = text.slice(1);
  }
  if (text.endsWith('"')) {
    text = text.slice(0, -1);
  }

  return text;
}

function maybeParseJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function decryptCoinGlassData({ payload, responseHeaders, requestUrl, requestCacheTimestamp }) {
  if (responseHeaders.get("encryption") !== "true") {
    return payload.data;
  }

  const encryptedUserKey = responseHeaders.get("user");
  if (!encryptedUserKey || typeof payload.data !== "string") {
    throw new Error("CoinGlass returned an incomplete encrypted response.");
  }

  const initialKey = getInitialDecryptKey({
    responseHeaders,
    requestUrl,
    requestCacheTimestamp,
  });
  const payloadKey = decryptCompressedValue(encryptedUserKey, initialKey);
  const decryptedText = decryptCompressedValue(payload.data, payloadKey);

  return maybeParseJson(decryptedText);
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLiquidationRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => ({
      liquidationPrice: toFiniteNumber(row?.liquidationPrice),
      size: toFiniteNumber(row?.size),
      positionUsd: toFiniteNumber(row?.positionUsd),
      updateTime: toFiniteNumber(row?.updateTime),
    }))
    .filter(
      (row) =>
        row.liquidationPrice !== null &&
        row.liquidationPrice > 0 &&
        row.size !== null &&
        row.size !== 0,
    );
}

export async function fetchHyperliquidLiquidationMap({ symbol }) {
  const requestCacheTimestamp = `${Date.now()}`;
  const requestUrl = withQuery(COINGLASS_LIQUIDATION_MAP_API, { symbol });
  const response = await fetch(requestUrl, {
    headers: {
      Accept: "application/json",
      "cache-ts-v2": requestCacheTimestamp,
      encryption: "true",
      language: "en",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const payload = await response.json();

  if (String(payload?.code) === "40000") {
    throw new Error("CoinGlass requires login for this liquidation map right now.");
  }

  if (String(payload?.code) !== "0") {
    throw new Error(payload?.msg || "CoinGlass liquidation map request failed.");
  }

  const data = decryptCoinGlassData({
    payload,
    responseHeaders: response.headers,
    requestUrl,
    requestCacheTimestamp,
  });

  const price = toFiniteNumber(data?.price);
  const rows = normalizeLiquidationRows(data?.list);
  const latestUpdateTime = rows.reduce(
    (latest, row) => Math.max(latest, row.updateTime ?? 0),
    0,
  );

  if (price === null || rows.length === 0) {
    throw new Error("CoinGlass returned no liquidation map rows.");
  }

  return {
    symbol,
    price,
    rows,
    asOf: latestUpdateTime || Date.now(),
    source: "CoinGlass",
    endpoint: "/api/hyperliquid/topPosition/liqMap",
  };
}
