// Runs `task` over `items` with at most `limit` in flight, so pages that load
// many wallets don't fire hundreds of Hyperliquid requests at once.
export async function runWithConcurrency(items, limit, task) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}

export const DEFAULT_RETRY_DELAYS_MS = [3_000, 8_000];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries a failed load after each delay (Hyperliquid answers bursts with 429),
// giving up early once the caller no longer needs the result.
export async function withRetry(load, { isCancelled = () => false, delaysMs = DEFAULT_RETRY_DELAYS_MS } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      if (attempt >= delaysMs.length || isCancelled()) {
        throw error;
      }
      await wait(delaysMs[attempt]);
    }
  }
}
