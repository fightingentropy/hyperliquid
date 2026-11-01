// Core of the hl-liquidation-sweeper Worker, kept free of Worker globals beyond fetch and
// AbortSignal so it can be tested with a fake fetch and a SQLite-backed D1.
//
// Each run takes the next slice of the tracked wallet list, reads each wallet's perp positions
// from Hyperliquid's public info API and replaces that wallet's rows in D1.

export const INFO_URL = "https://api.hyperliquid.xyz/info";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 8_000;
// Stop starting new wallets after this long so a slow run cannot overlap the next cron tick.
const DEFAULT_BUDGET_MS = 45_000;
// Rows nobody refreshed for this long (wallet dropped from the list, or failing for hours) are
// deleted when a cycle completes.
const STALE_ROW_MS = 2 * 60 * 60 * 1000;

export interface LiquidationRow {
  coin: string;
  liquidationPx: number;
  /** Signed size in coin units; negative is a short. */
  size: number;
  positionUsd: number;
  snapshotTime: number;
}

export interface BatchSelection {
  start: number;
  addresses: string[];
}

export interface SweepOptions {
  db: D1Database;
  wallets: readonly string[];
  tracked: readonly string[];
  batchSize: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  concurrency?: number;
  timeoutMs?: number;
  budgetMs?: number;
}

export interface SweepResult {
  attempted: number;
  ok: number;
  failed: number;
  rateLimited: boolean;
  cursorBefore: number;
  cursorAfter: number;
  wrapped: boolean;
  rowsWritten: number;
  pricesWritten: number;
  error: string | null;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Maps a clearinghouseState response to rows for tracked coins. Positions without a liquidation
 * price (null, which Hyperliquid returns for well-collateralised positions) or with a
 * non-positive one are skipped. szi keeps its sign: negative is a short.
 */
export function mapPositions(
  state: unknown,
  tracked: ReadonlySet<string>,
  fallbackTime: number,
): LiquidationRow[] {
  const response = state as {
    time?: unknown;
    assetPositions?: { position?: Record<string, unknown> }[];
  } | null;
  const assetPositions = response?.assetPositions;
  if (!Array.isArray(assetPositions)) {
    return [];
  }

  const snapshotTime = toFiniteNumber(response?.time) ?? fallbackTime;
  // Keyed by coin: (address, coin) is the primary key, and one duplicate would roll back the
  // whole D1 batch.
  const byCoin = new Map<string, LiquidationRow>();

  for (const entry of assetPositions) {
    const position = entry?.position;
    const coin = position?.coin;
    if (typeof coin !== "string" || !tracked.has(coin)) {
      continue;
    }

    const size = toFiniteNumber(position?.szi);
    const liquidationPx = toFiniteNumber(position?.liquidationPx);
    const positionUsd = toFiniteNumber(position?.positionValue);
    if (
      size === null ||
      size === 0 ||
      liquidationPx === null ||
      liquidationPx <= 0 ||
      positionUsd === null
    ) {
      continue;
    }

    byCoin.set(coin, {
      coin,
      liquidationPx,
      size,
      positionUsd: Math.abs(positionUsd),
      snapshotTime,
    });
  }

  return [...byCoin.values()];
}

/** Clamps a stored cursor to an index into a list of `length` wallets. */
export function normalizeCursor(raw: unknown, length: number): number {
  const cursor = Math.floor(Number(raw));
  if (!Number.isFinite(cursor) || cursor < 0 || length <= 0) {
    return 0;
  }

  return cursor % length;
}

/** The next `batchSize` wallets starting at `cursor`, wrapping around the end of the list. */
export function selectBatch(
  wallets: readonly string[],
  cursor: unknown,
  batchSize: number,
): BatchSelection {
  const length = wallets.length;
  if (length === 0) {
    return { start: 0, addresses: [] };
  }

  const start = normalizeCursor(cursor, length);
  const count = Math.min(Math.max(Math.floor(batchSize) || 1, 1), length);
  const addresses = Array.from({ length: count }, (_, offset) => wallets[(start + offset) % length]);

  return { start, addresses };
}

/** Moves the cursor forward by `advanced` wallets; `wrapped` is true when it passed the end. */
export function advanceCursor(start: number, advanced: number, length: number) {
  if (length <= 0) {
    return { cursor: 0, wrapped: false };
  }

  const total = start + advanced;
  return { cursor: total % length, wrapped: advanced > 0 && total >= length };
}

class InfoRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

class RateLimitedError extends Error {}

async function postInfo(
  fetchImpl: typeof fetch,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  let lastError: unknown;

  // One retry for network errors, timeouts and 5xx. 429 is never retried: the caller stops.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(INFO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 429) {
        void response.body?.cancel().catch(() => {});
        throw new RateLimitedError("HTTP 429 from Hyperliquid");
      }

      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new InfoRequestError(`HTTP ${response.status} from Hyperliquid`, response.status >= 500);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof RateLimitedError) {
        throw error;
      }
      if (error instanceof InfoRequestError && !error.retryable) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type WalletOutcome =
  | { status: "skipped" }
  | { status: "rate_limited" }
  | { status: "failed"; message: string }
  | { status: "ok"; rows: LiquidationRow[] };

async function readMeta(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare("SELECT key, value FROM liq_meta").all<{
    key: string;
    value: string;
  }>();

  return new Map((results ?? []).map((row) => [row.key, row.value]));
}

export async function runSweep(options: SweepOptions): Promise<SweepResult> {
  const {
    db,
    wallets,
    tracked,
    batchSize,
    fetchImpl = fetch,
    now = Date.now,
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    budgetMs = DEFAULT_BUDGET_MS,
  } = options;
  const startedAt = now();
  const trackedSet = new Set(tracked);
  const meta = await readMeta(db);
  const { start, addresses } = selectBatch(wallets, meta.get("cursor"), batchSize);
  const problems: string[] = [];
  if (wallets.length === 0) {
    problems.push("wallet list is empty");
  }

  let mids: Record<string, unknown> | null = null;
  let rateLimited = false;

  try {
    const payload = await postInfo(fetchImpl, { type: "allMids" }, timeoutMs);
    if (payload && typeof payload === "object") {
      mids = payload as Record<string, unknown>;
    }
  } catch (error) {
    rateLimited = error instanceof RateLimitedError;
    problems.push(`allMids: ${errorMessage(error)}`);
  }

  const outcomes: WalletOutcome[] = addresses.map(() => ({ status: "skipped" }));

  if (!rateLimited) {
    let nextIndex = 0;
    let stopped = false;
    let outOfTime = false;

    const worker = async () => {
      while (!stopped) {
        if (now() - startedAt > budgetMs) {
          stopped = true;
          outOfTime = true;
          return;
        }

        const index = nextIndex;
        nextIndex += 1;
        if (index >= addresses.length) {
          return;
        }

        try {
          const state = await postInfo(
            fetchImpl,
            { type: "clearinghouseState", user: addresses[index] },
            timeoutMs,
          );
          outcomes[index] = { status: "ok", rows: mapPositions(state, trackedSet, now()) };
        } catch (error) {
          if (error instanceof RateLimitedError) {
            outcomes[index] = { status: "rate_limited" };
            rateLimited = true;
            stopped = true;
          } else {
            outcomes[index] = { status: "failed", message: errorMessage(error) };
          }
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(Math.max(concurrency, 1), addresses.length) }, worker),
    );

    if (outOfTime) {
      problems.push(`time budget of ${budgetMs} ms exhausted`);
    }
  }

  // The cursor only moves over the leading run of wallets that were really handled (ok or
  // failed), so a wallet that hit 429 or was never started is picked up again next run.
  let advanced = 0;
  while (
    advanced < outcomes.length &&
    (outcomes[advanced].status === "ok" || outcomes[advanced].status === "failed")
  ) {
    advanced += 1;
  }

  const okCount = outcomes.filter((outcome) => outcome.status === "ok").length;
  const failedMessages = outcomes.flatMap((outcome) =>
    outcome.status === "failed" ? [outcome.message] : [],
  );
  if (rateLimited) {
    problems.push(`rate limited (HTTP 429) after ${advanced} of ${addresses.length} wallets`);
  }
  if (failedMessages.length > 0) {
    problems.push(`${failedMessages.length} wallet requests failed (first: ${failedMessages[0]})`);
  }

  const { cursor: cursorAfter, wrapped } = advanceCursor(start, advanced, wallets.length);
  const runAt = now();
  const error = problems.length > 0 ? problems.join("; ") : null;

  const statements: D1PreparedStatement[] = [];
  const deleteWallet = db.prepare("DELETE FROM liq_positions WHERE address = ?1");
  const insertRow = db.prepare(
    "INSERT INTO liq_positions (address, coin, liquidation_px, size, position_usd, snapshot_time) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  );
  let rowsWritten = 0;

  // Wallets that errored are left out, so they keep their previous rows.
  outcomes.forEach((outcome, index) => {
    if (outcome.status !== "ok") {
      return;
    }

    statements.push(deleteWallet.bind(addresses[index]));
    for (const row of outcome.rows) {
      statements.push(
        insertRow.bind(
          addresses[index],
          row.coin,
          row.liquidationPx,
          row.size,
          row.positionUsd,
          row.snapshotTime,
        ),
      );
      rowsWritten += 1;
    }
  });

  let pricesWritten = 0;
  if (mids) {
    const upsertPrice = db.prepare(
      "INSERT INTO liq_prices (coin, mid, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(coin) DO UPDATE SET mid = excluded.mid, updated_at = excluded.updated_at",
    );

    for (const coin of trackedSet) {
      const mid = toFiniteNumber(mids[coin]);
      if (mid !== null && mid > 0) {
        statements.push(upsertPrice.bind(coin, mid, runAt));
        pricesWritten += 1;
      }
    }
  }

  if (wrapped) {
    statements.push(
      db.prepare("DELETE FROM liq_positions WHERE snapshot_time < ?1").bind(runAt - STALE_ROW_MS),
    );
  }

  const upsertMeta = db.prepare(
    "INSERT INTO liq_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const metaValues: [string, string][] = [
    ["cursor", String(cursorAfter)],
    ["last_run_at", String(runAt)],
    ["wallets_total", String(wallets.length)],
    ["last_error", error ?? ""],
    [
      "last_run_stats",
      JSON.stringify({ attempted: advanced, ok: okCount, failed: failedMessages.length, rateLimited }),
    ],
  ];
  if (wrapped) {
    metaValues.push(["last_full_cycle_at", String(runAt)]);
  }
  for (const [key, value] of metaValues) {
    statements.push(upsertMeta.bind(key, value));
  }

  // One batch is one transaction: readers see the old rows or the new ones, never a mix.
  await db.batch(statements);

  return {
    attempted: advanced,
    ok: okCount,
    failed: failedMessages.length,
    rateLimited,
    cursorBefore: start,
    cursorAfter,
    wrapped,
    rowsWritten,
    pricesWritten,
    error,
  };
}
