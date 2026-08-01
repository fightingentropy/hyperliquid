import { EquityResearchError } from "../lib/equityResearch.js";

const DEFAULT_USER_REQUESTS_PER_DAY = 20;
const DEFAULT_IP_REQUESTS_PER_DAY = 40;
const DEFAULT_PROVIDER_CALLS_PER_DAY = 300;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60_000;

/**
 * @param {any} db
 * @param {any} options
 */
export function createD1ResearchControl(
  db,
  {
    userRequestsPerDay = DEFAULT_USER_REQUESTS_PER_DAY,
    ipRequestsPerDay = DEFAULT_IP_REQUESTS_PER_DAY,
    providerCallsPerDay = DEFAULT_PROVIDER_CALLS_PER_DAY,
    now = () => Date.now(),
  } = {},
) {
  if (!db?.prepare) throw new Error("RESEARCH_CONTROL_DB binding is required");
  const userLimit = positiveInteger(userRequestsPerDay, DEFAULT_USER_REQUESTS_PER_DAY);
  const ipLimit = positiveInteger(ipRequestsPerDay, DEFAULT_IP_REQUESTS_PER_DAY);
  const providerLimit = positiveInteger(providerCallsPerDay, DEFAULT_PROVIDER_CALLS_PER_DAY);

  return {
    async admitRequest({ principal, ip }) {
      const day = dayFromEpoch(now());
      const userPath = jsonPath(await sha256(String(principal)));
      const ipPath = jsonPath(await sha256(String(ip || principal)));
      await ensureUsageDay(db, day);
      const row = await db.prepare(
        `UPDATE research_daily_usage
         SET user_counts = json_set(user_counts, ?, COALESCE(json_extract(user_counts, ?), 0) + 1),
             ip_counts = json_set(ip_counts, ?, COALESCE(json_extract(ip_counts, ?), 0) + 1)
         WHERE day = ?
           AND COALESCE(json_extract(user_counts, ?), 0) < ?
           AND COALESCE(json_extract(ip_counts, ?), 0) < ?
         RETURNING provider_calls`,
      ).bind(
        userPath,
        userPath,
        ipPath,
        ipPath,
        day,
        userPath,
        userLimit,
        ipPath,
        ipLimit,
      ).first();
      if (!row) {
        throw new EquityResearchError("The daily research request quota has been reached.", {
          code: "research_quota_exhausted",
          status: 429,
        });
      }
    },

    providerControl: {
      async beforeCall() {
        const currentTime = now();
        const circuit = await db.prepare(
          "SELECT failures, opened_until FROM research_provider_circuit WHERE service = ?",
        ).bind("eodhd").first();
        if (Number(circuit?.opened_until ?? 0) > currentTime) {
          throw new EquityResearchError("The market-data provider circuit is temporarily open.", {
            code: "provider_circuit_open",
            status: 503,
          });
        }

        const day = dayFromEpoch(currentTime);
        await ensureUsageDay(db, day);
        const row = await db.prepare(
          `UPDATE research_daily_usage
           SET provider_calls = provider_calls + 1
           WHERE day = ? AND provider_calls < ?
           RETURNING provider_calls`,
        ).bind(day, providerLimit).first();
        if (!row) {
          throw new EquityResearchError("The daily provider budget has been exhausted.", {
            code: "provider_budget_exhausted",
            status: 429,
          });
        }
      },

      async failure() {
        const currentTime = now();
        await db.prepare(
          `INSERT INTO research_provider_circuit(service, failures, opened_until)
           VALUES (?, 1, 0)
           ON CONFLICT(service) DO UPDATE SET
             failures = failures + 1,
             opened_until = CASE
               WHEN failures + 1 >= ? THEN ?
               ELSE opened_until
             END`,
        ).bind("eodhd", CIRCUIT_FAILURE_THRESHOLD, currentTime + CIRCUIT_OPEN_MS).run();
      },

      async success() {
        await db.prepare(
          `INSERT INTO research_provider_circuit(service, failures, opened_until)
           VALUES (?, 0, 0)
           ON CONFLICT(service) DO UPDATE SET failures = 0, opened_until = 0`,
        ).bind("eodhd").run();
      },
    },
  };
}

async function ensureUsageDay(db, day) {
  await db.prepare(
    `INSERT OR IGNORE INTO research_daily_usage(day, provider_calls, user_counts, ip_counts)
     VALUES (?, 0, '{}', '{}')`,
  ).bind(day).run();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function dayFromEpoch(epoch) {
  return new Date(epoch).toISOString().slice(0, 10);
}

function jsonPath(hash) {
  return `$."${hash}"`;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
