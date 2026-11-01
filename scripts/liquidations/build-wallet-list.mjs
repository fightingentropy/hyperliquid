// Builds workers/liq-sweeper/src/wallets.json from Hyperliquid's official leaderboard dump.
//
//   npm run liq:wallets
//   npm run liq:wallets -- --input leaderboard.json   # use a local copy instead of downloading
//
// Keeps accounts with accountValue >= --min-account-value (default 1,000,000) that traded in the
// last week (week vlm > 0), sorted by accountValue descending. The leaderboard is public.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
export const DEFAULT_MIN_ACCOUNT_VALUE = 1_000_000;
const MIN_PLAUSIBLE_WALLETS = 100;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_OUTPUT_PATH = path.join(projectRoot, "workers/liq-sweeper/src/wallets.json");

function weekVolume(windowPerformances) {
  if (!Array.isArray(windowPerformances)) {
    return 0;
  }

  const week = windowPerformances.find((entry) => Array.isArray(entry) && entry[0] === "week");
  const volume = Number(week?.[1]?.vlm);
  return Number.isFinite(volume) ? volume : 0;
}

// Returns lowercase addresses sorted by accountValue descending (ties by address).
export function selectWallets(rows, { minAccountValue = DEFAULT_MIN_ACCOUNT_VALUE } = {}) {
  const accountValueByAddress = new Map();

  for (const row of rows) {
    const address = typeof row?.ethAddress === "string" ? row.ethAddress.trim().toLowerCase() : "";
    const accountValue = Number(row?.accountValue);

    if (
      !ADDRESS_PATTERN.test(address) ||
      !Number.isFinite(accountValue) ||
      accountValue < minAccountValue ||
      !(weekVolume(row.windowPerformances) > 0)
    ) {
      continue;
    }

    accountValueByAddress.set(
      address,
      Math.max(accountValue, accountValueByAddress.get(address) ?? 0),
    );
  }

  return [...accountValueByAddress.entries()]
    .sort(([leftAddress, left], [rightAddress, right]) =>
      right - left || (leftAddress < rightAddress ? -1 : 1),
    )
    .map(([address]) => address);
}

export function formatWalletList({ generatedAt, minAccountValue, addresses }) {
  const lines = addresses.map((address) => `    ${JSON.stringify(address)}`).join(",\n");

  return [
    "{",
    `  "generatedAt": ${JSON.stringify(generatedAt)},`,
    `  "minAccountValue": ${JSON.stringify(minAccountValue)},`,
    '  "addresses": [',
    lines,
    "  ]",
    "}",
    "",
  ].join("\n");
}

async function loadLeaderboard(inputPath) {
  if (inputPath) {
    return JSON.parse(fs.readFileSync(inputPath, "utf8"));
  }

  const response = await fetch(LEADERBOARD_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Leaderboard request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      out: { type: "string", default: DEFAULT_OUTPUT_PATH },
      "min-account-value": { type: "string", default: String(DEFAULT_MIN_ACCOUNT_VALUE) },
    },
  });
  const minAccountValue = Number(values["min-account-value"]);

  if (!Number.isFinite(minAccountValue) || minAccountValue < 0) {
    throw new Error("--min-account-value must be a non-negative number.");
  }

  const leaderboard = await loadLeaderboard(values.input);
  if (!Array.isArray(leaderboard?.leaderboardRows)) {
    throw new Error("Unexpected leaderboard shape: leaderboardRows is missing.");
  }

  const addresses = selectWallets(leaderboard.leaderboardRows, { minAccountValue });
  if (addresses.length < MIN_PLAUSIBLE_WALLETS) {
    throw new Error(
      `Only ${addresses.length} wallets matched; refusing to overwrite the list (leaderboard format change?).`,
    );
  }

  const generatedAt = new Date().toISOString();
  fs.writeFileSync(values.out, formatWalletList({ generatedAt, minAccountValue, addresses }));
  console.log(
    `Wrote ${addresses.length} wallets (accountValue >= ${minAccountValue}, week vlm > 0) to ${path.relative(process.cwd(), values.out)}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
