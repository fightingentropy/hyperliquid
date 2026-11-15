import { describe, expect, it } from "vitest";
import { TWAP_SLICE_FILLS_LIMIT, fetchAllUserFills, fetchRecentUserFills, mergeTwapSliceFills } from "./hyperliquid";

function makePage(startTid, count, startTime) {
  return Array.from({ length: count }, (_, i) => ({
    tid: startTid + i,
    time: startTime + i,
    coin: "HYPE",
  }));
}

describe("fetchAllUserFills pagination", () => {
  it("pages forward by time until a partial page and dedupes by tid", async () => {
    const pages = [
      makePage(1, 2000, 1_000), // times 1000..2999
      makePage(2001, 2000, 3_000), // times 3000..4999
      makePage(4001, 500, 5_000), // partial -> stop
    ];
    // Each page after the first restarts at the previous max time, so it also
    // returns the boundary fill again (deduped by tid).
    const calls = [];
    const fetchPage = async ({ startTime }) => {
      calls.push(startTime);
      return pages.shift() ?? [];
    };

    const all = await fetchAllUserFills({ user: "0xabc", fetchPage });

    expect(all).toHaveLength(4500);
    // First call starts at 0; each subsequent call advances past the previous max time.
    expect(calls[0]).toBe(0);
    expect(calls[1]).toBe(2999); // restarts at the last ms seen
    expect(calls[2]).toBe(4999);
    expect(calls).toHaveLength(3);
  });

  it("stops at maxPages even if full pages keep coming", async () => {
    let tid = 1;
    let t = 1_000;
    const fetchPage = async () => {
      const page = makePage(tid, 2000, t);
      tid += 2000;
      t += 2000;
      return page;
    };

    const all = await fetchAllUserFills({ user: "0xabc", maxPages: 3, fetchPage });
    expect(all).toHaveLength(6000);
  });

  it("breaks when a page repeats the same fills (no forward progress)", async () => {
    const fetchPage = async () => makePage(1, 2000, 1_000); // identical every time
    const all = await fetchAllUserFills({ user: "0xabc", maxPages: 5, fetchPage });
    // Second page adds nothing new -> loop stops; deduped to one page.
    expect(all).toHaveLength(2000);
  });

  it("keeps fills that share the boundary millisecond across a page cut", async () => {
    // 2500 fills, the last 3 of the first page share ms 5000 with 2 more that
    // did not fit in the page.
    const all = [
      ...Array.from({ length: 1997 }, (_, i) => ({ tid: i + 1, time: 1_000 + i })),
      ...Array.from({ length: 5 }, (_, i) => ({ tid: 2000 + i, time: 5_000 })),
      ...Array.from({ length: 10 }, (_, i) => ({ tid: 3000 + i, time: 6_000 + i })),
    ];
    const fetchPage = async ({ startTime }) =>
      all.filter((fill) => fill.time >= startTime).slice(0, 2000);

    const result = await fetchAllUserFills({ user: "0xabc", fetchPage });
    expect(result).toHaveLength(all.length);
  });
});

describe("mergeTwapSliceFills", () => {
  it("adds TWAP slices inside the window, tags them and sorts oldest first", () => {
    const fills = [
      { tid: 1, time: 5_000, coin: "BTC" },
      { tid: 2, time: 9_000, coin: "BTC" },
    ];
    const slices = [
      { twapId: 77, fill: { tid: 10, time: 7_000, coin: "BTC", twapId: null } },
      { twapId: 77, fill: { tid: 11, time: 1_000, coin: "BTC", twapId: null } }, // before the window
      { twapId: 78, fill: { tid: 2, time: 9_000, coin: "BTC", twapId: null } }, // already present
    ];

    const merged = mergeTwapSliceFills(fills, slices, { since: 4_000 });

    expect(merged.fills.map((fill) => fill.tid)).toEqual([1, 10, 2]);
    expect(merged.fills[1].twapId).toBe(77);
    expect(merged.fills[2].twapId).toBeUndefined();
    expect(merged.twapFillsFrom).toBeNull();
  });

  it("reports where TWAP coverage starts when the slice feed is capped inside the window", () => {
    const slices = Array.from({ length: TWAP_SLICE_FILLS_LIMIT }, (_, i) => ({
      twapId: 1,
      fill: { tid: 100 + i, time: 6_000 + i, coin: "BTC" },
    }));

    expect(mergeTwapSliceFills([], slices, { since: 4_000 }).twapFillsFrom).toBe(6_000);
    // Capped, but the oldest slice predates the window: nothing is missing.
    expect(mergeTwapSliceFills([], slices, { since: 6_000 }).twapFillsFrom).toBeNull();
  });

  it("tolerates missing inputs", () => {
    expect(mergeTwapSliceFills(null, undefined)).toEqual({ fills: [], twapFillsFrom: null });
  });
});

describe("fetchRecentUserFills", () => {
  const neverPage = async () => {
    throw new Error("should not page");
  };

  it("needs one request when the latest page reaches back past the window", async () => {
    // Short page: this is everything the wallet has.
    const quiet = await fetchRecentUserFills({
      user: "0xabc",
      startTime: 1_200,
      fetchLatest: async () => makePage(1, 500, 1_000).reverse(),
      fetchPage: neverPage,
    });
    expect(quiet.fillsFrom).toBeNull();
    expect(quiet.fills).toHaveLength(300);
    expect(quiet.fills[0].time).toBe(1_200); // oldest first, window applied

    // Full page that starts before the window.
    const busy = await fetchRecentUserFills({
      user: "0xabc",
      startTime: 2_000,
      fetchLatest: async () => makePage(1, 2000, 1_000),
      fetchPage: neverPage,
    });
    expect(busy.fillsFrom).toBeNull();
    expect(busy.fills).toHaveLength(1000);
  });

  it("pages across the gap between the window start and the latest page", async () => {
    const calls = [];
    const pages = [makePage(1, 2000, 6_000), makePage(2001, 1001, 8_000)]; // times 6000..7999, 8000..9000
    const result = await fetchRecentUserFills({
      user: "0xabc",
      startTime: 6_000,
      fetchLatest: async () => makePage(3001, 2000, 9_000), // times 9000..10999
      fetchPage: async ({ startTime, endTime }) => {
        calls.push([startTime, endTime]);
        return pages.shift() ?? [];
      },
    });
    expect(calls).toEqual([
      [6_000, 9_000],
      [7_999, 9_000],
    ]);
    expect(result.fillsFrom).toBeNull();
    expect(result.fills).toHaveLength(5000); // the boundary fill at 9000 is deduped
    expect(result.fills[0].time).toBe(6_000);
    expect(result.fills.at(-1).time).toBe(10_999);
  });

  it("keeps only the latest page for a wallet that trades too fast", async () => {
    // 2000 fills in 2 seconds, window 10x longer: far past the page budget.
    const result = await fetchRecentUserFills({
      user: "0xabc",
      startTime: 0,
      fetchLatest: async () => makePage(1, 2000, 20_000),
      fetchPage: neverPage,
    });
    expect(result.fillsFrom).toBe(20_000);
    expect(result.fills).toHaveLength(2000);
  });

  it("still covers a bursty wallet whose earlier trading was light", async () => {
    // The latest page's pace alone says ~4 more pages, but the gap holds 3 fills.
    const result = await fetchRecentUserFills({
      user: "0xabc",
      startTime: 0,
      fetchLatest: async () => makePage(1, 2000, 8_000),
      fetchPage: async () => makePage(5001, 3, 100),
    });
    expect(result.fillsFrom).toBeNull();
    expect(result.fills).toHaveLength(2003);
  });

  it("stops paging once the gap is clearly out of reach", async () => {
    let calls = 0;
    const result = await fetchRecentUserFills({
      user: "0xabc",
      startTime: 0,
      fetchLatest: async () => makePage(1, 2000, 9_000), // times 9000..10999
      fetchPage: async () => {
        calls += 1;
        // Nothing is held before 5000, then 2000 fills in 100ms: ~39 pages to go.
        return Array.from({ length: 2000 }, (_, i) => ({ tid: 10_000 + i, time: 5_000 + (i % 100) }));
      },
    });
    expect(calls).toBe(1);
    expect(result.fillsFrom).toBe(9_000);
    expect(result.fills).toHaveLength(2000);
  });
});
