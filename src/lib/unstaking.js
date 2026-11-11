import { pad2 } from "./formatters";

// Transforms for the network-wide HYPE unstaking queue, the same feed behind
// hypurrscan.io/staking#unstaking. HYPE withdrawn from staking waits 7 days
// before it reaches the wallet's spot balance. Each feed entry is one such
// release: `time` is when it unlocks (ms), `wei` the HYPE amount. The feed also
// keeps roughly the past week of releases that already happened.

// HyperCore token amounts are integers scaled by 10^weiDecimals; HYPE uses 8.
const HYPE_WEI_SCALE = 1e8;
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const UNSTAKING_WINDOWS = [
  { key: "1h", label: "1h", ms: HOUR_MS },
  { key: "24h", label: "24h", ms: DAY_MS },
  { key: "7d", label: "7d", ms: 7 * DAY_MS },
];

// Feed entries -> { time, user, amount } sorted by unlock time. A response that
// is not a list is an error rather than an empty queue, so an outage never reads
// as "nothing is unstaking".
export function normalizeUnstakingQueue(payload) {
  if (!Array.isArray(payload)) {
    throw new Error("Unexpected unstaking queue response.");
  }

  return payload
    .map((entry) => {
      const time = Number(entry?.time);
      const wei = Number(entry?.wei);
      const user = typeof entry?.user === "string" ? entry.user.trim().toLowerCase() : "";

      if (!Number.isFinite(time) || !Number.isFinite(wei) || wei <= 0 || !user) {
        return null;
      }

      return { time, user, amount: wei / HYPE_WEI_SCALE };
    })
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
}

// HypurrScan's address -> name map, keyed by lowercase address.
export function normalizeAliases(payload) {
  const aliases = new Map();

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return aliases;
  }

  Object.entries(payload).forEach(([address, name]) => {
    if (typeof name === "string" && name.trim()) {
      aliases.set(address.toLowerCase(), name.trim());
    }
  });

  return aliases;
}

// Validator address -> name, from Hyperliquid's validatorSummaries. Validators
// unstaking their own HYPE show up in the queue under this address.
export function normalizeValidatorNames(payload) {
  const names = new Map();

  (Array.isArray(payload) ? payload : []).forEach((validator) => {
    const address = typeof validator?.validator === "string" ? validator.validator : "";
    const name = typeof validator?.name === "string" ? validator.name.trim() : "";
    if (address && name) {
      names.set(address.toLowerCase(), name);
    }
  });

  return names;
}

// Address -> { name, isValidator } for the wallets the page can name. The
// user's own saved labels win, then validator names, then HypurrScan's aliases.
export function buildWalletNames({ aliases, validators, savedWallets } = {}) {
  const names = new Map();
  const validatorNames = validators ?? new Map();

  const add = (address, name) => {
    const key = address.toLowerCase();
    names.set(key, { name, isValidator: validatorNames.has(key) });
  };

  (aliases ?? []).forEach((name, address) => add(address, name));
  validatorNames.forEach((name, address) => add(address, name));
  (Array.isArray(savedWallets) ? savedWallets : []).forEach((wallet) => {
    const label = typeof wallet?.label === "string" ? wallet.label.trim() : "";
    if (label && wallet?.address) {
      add(wallet.address, label);
    }
  });

  return names;
}

// HYPE unlocking within each window ahead of `now`, and HYPE that unlocked
// within each window before it, plus counts for what is still pending. An entry
// whose unlock time has been reached counts as released.
export function summarizeUnstakingQueue(entries, now) {
  const upcoming = {};
  const past = {};
  UNSTAKING_WINDOWS.forEach((span) => {
    upcoming[span.key] = 0;
    past[span.key] = 0;
  });

  let pendingCount = 0;
  let pendingAmount = 0;
  const pendingWallets = new Set();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const offset = entry.time - now;

    if (offset > 0) {
      pendingCount += 1;
      pendingAmount += entry.amount;
      pendingWallets.add(entry.user);
    }

    for (const span of UNSTAKING_WINDOWS) {
      if (offset > 0 && offset <= span.ms) {
        upcoming[span.key] += entry.amount;
      } else if (offset <= 0 && -offset < span.ms) {
        past[span.key] += entry.amount;
      }
    }
  }

  return {
    upcoming,
    past,
    pendingCount,
    pendingAmount,
    pendingWalletCount: pendingWallets.size,
  };
}

export const UNSTAKING_VIEWS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Released" },
];

export const UNSTAKING_SORTS = {
  upcoming: [
    { value: "time", label: "Soonest" },
    { value: "amount", label: "Largest" },
  ],
  past: [
    { value: "time", label: "Latest" },
    { value: "amount", label: "Largest" },
  ],
};

// Rows for the table: pending releases soonest first, or past releases most
// recent first; "amount" sorts either list largest first.
export function selectUnstakingRows(entries, now, { view = "upcoming", sort = "time" } = {}) {
  const isUpcoming = view !== "past";
  const rows = (Array.isArray(entries) ? entries : []).filter((entry) =>
    isUpcoming ? entry.time > now : entry.time <= now,
  );

  if (sort === "amount") {
    return rows.sort((left, right) => right.amount - left.amount || left.time - right.time);
  }

  return isUpcoming
    ? rows.sort((left, right) => left.time - right.time)
    : rows.sort((left, right) => right.time - left.time);
}

// Countdown text for a gap in ms: "42s", "12m 05s", "5h 12m", "3d 4h".
export function formatUnstakingDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Math.abs(ms) / SECOND_MS));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${pad2(totalSeconds % 60)}s`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return `${totalHours}h ${pad2(totalMinutes % 60)}m`;
  }

  return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
}
