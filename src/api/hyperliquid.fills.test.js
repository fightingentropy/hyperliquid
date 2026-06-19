import { describe, expect, it } from "vitest";
import { fetchAllUserFills } from "./hyperliquid";

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
    const calls = [];
    const fetchPage = async ({ startTime }) => {
      calls.push(startTime);
      return pages.shift() ?? [];
    };

    const all = await fetchAllUserFills({ user: "0xabc", fetchPage });

    expect(all).toHaveLength(4500);
    // First call starts at 0; each subsequent call advances past the previous max time.
    expect(calls[0]).toBe(0);
    expect(calls[1]).toBe(3000); // 2999 + 1
    expect(calls[2]).toBe(5000); // 4999 + 1
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
});
