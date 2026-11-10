import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { fetchWatchMarkets, fetchWatchSparklines } from "../api/hyperliquid";
import WatchSparkline from "../components/WatchSparkline";
import { usePollingResource } from "../hooks/usePollingResource";
import { getBrowserStorage } from "../lib/safeStorage";
import {
  formatCompactCurrency,
  formatCurrency,
  formatPrice,
  formatSignedPercent,
} from "../lib/formatters";
import {
  addCoinToWatchlist,
  appendWatchlist,
  getActiveWatchlist,
  readStoredWatchlistModel,
  removeCoinFromWatchlist,
  removeWatchlist,
  renameWatchlist,
  setActiveWatchlist,
  writeStoredWatchlistModel,
} from "../lib/watchlists";

const MARKET_REFRESH_MS = 15_000;
const SPARKLINE_REFRESH_MS = 120_000;
const MAX_COINS_PER_LIST = 40;

function sortRows(rows, sortKey, sortDirection) {
  if (!sortKey) {
    return rows;
  }

  const direction = sortDirection === "desc" ? -1 : 1;
  return [...rows].sort((left, right) => {
    const leftValue = left[sortKey];
    const rightValue = right[sortKey];

    if (leftValue == null && rightValue == null) {
      return 0;
    }
    if (leftValue == null) {
      return 1;
    }
    if (rightValue == null) {
      return -1;
    }
    if (typeof leftValue === "string") {
      return leftValue.localeCompare(rightValue) * direction;
    }
    return (leftValue - rightValue) * direction;
  });
}

function changePercent(row) {
  if (!Number.isFinite(row.markPx) || !Number.isFinite(row.prevDayPx) || row.prevDayPx <= 0) {
    return null;
  }
  return ((row.markPx - row.prevDayPx) / row.prevDayPx) * 100;
}

function ChangeBadge({ value }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">—</span>;
  }

  const isPositive = value >= 0;
  return (
    <span
      className="font-medium tabular-nums"
      style={{ color: isPositive ? "var(--profit)" : "var(--loss)" }}
    >
      {formatSignedPercent(value)}
    </span>
  );
}

function SparklineCell({ points, isLoading }) {
  if (isLoading && (!points || !points.length)) {
    return <span className="text-xs text-muted-foreground">···</span>;
  }
  return <WatchSparkline points={points} />;
}

export default function WatchPage() {
  const [model, setModel] = useState(() => readStoredWatchlistModel(getBrowserStorage("localStorage")));
  const [newListName, setNewListName] = useState("");
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [coinInput, setCoinInput] = useState("");
  const [coinError, setCoinError] = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDirection, setSortDirection] = useState("desc");

  const activeList = getActiveWatchlist(model);

  useEffect(() => {
    writeStoredWatchlistModel(model, getBrowserStorage("localStorage"));
  }, [model]);

  const marketsResource = usePollingResource(
    () => fetchWatchMarkets(),
    [],
    {
      intervalMs: MARKET_REFRESH_MS,
      cacheKey: "watch-markets",
      staleTimeMs: MARKET_REFRESH_MS,
    },
  );

  const markets = marketsResource.data?.markets ?? [];
  const marketBySymbol = useMemo(() => {
    const lookup = new Map();
    markets.forEach((market) => {
      lookup.set(market.symbol.toUpperCase(), market);
    });
    return lookup;
  }, [markets]);

  // Sparklines are keyed by Hyperliquid coin names (SPX displays as SPX but
  // its candle coin is "xyz:SP500"), so resolve them through the markets.
  const sparklineCoins = useMemo(
    () =>
      Array.from(
        new Set(
          activeList.coins
            .map((symbol) => marketBySymbol.get(symbol)?.coin)
            .filter(Boolean),
        ),
      ),
    [activeList.coins, marketBySymbol],
  );
  const sparklineKey = sparklineCoins.join(",");

  const sparklinesResource = usePollingResource(
    () => fetchWatchSparklines(sparklineCoins),
    [sparklineKey],
    {
      intervalMs: SPARKLINE_REFRESH_MS,
      cacheKey: `watch-sparklines:${sparklineKey}`,
      staleTimeMs: SPARKLINE_REFRESH_MS,
    },
  );

  const sparklines = sparklinesResource.data ?? {};

  const rows = useMemo(
    () =>
      activeList.coins.map((symbol) => {
        const market = marketBySymbol.get(symbol);
        return {
          symbol,
          marketType: market?.marketType ?? null,
          markPx: market?.markPx ?? null,
          changePct: market ? changePercent(market) : null,
          dayNtlVlm: market?.dayNtlVlm ?? null,
          openInterestNotional:
            market && Number.isFinite(market.openInterest)
              ? market.openInterest * market.markPx
              : null,
          fundingRate: market?.fundingRate ?? null,
          coin: market?.coin ?? null,
          found: Boolean(market),
        };
      }),
    [activeList.coins, marketBySymbol],
  );

  const visibleRows = useMemo(
    () => sortRows(rows, sortKey, sortDirection),
    [rows, sortKey, sortDirection],
  );

  const handleAddCoin = (event) => {
    event.preventDefault();
    const symbol = coinInput.trim().toUpperCase();
    if (!symbol) {
      return;
    }

    if (activeList.coins.length >= MAX_COINS_PER_LIST) {
      setCoinError(`Lists hold up to ${MAX_COINS_PER_LIST} symbols.`);
      return;
    }

    if (marketsResource.hasLoaded && !marketBySymbol.has(symbol)) {
      setCoinError(`Unknown symbol: ${symbol}`);
      return;
    }

    setCoinError("");
    setCoinInput("");
    setModel((current) => addCoinToWatchlist(current, activeList.id, symbol));
  };

  const handleCreateList = (event) => {
    event.preventDefault();
    const name = newListName.trim();
    if (!name) {
      return;
    }

    setModel((current) => appendWatchlist(current, name));
    setNewListName("");
    setIsCreatingList(false);
  };

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(key);
    setSortDirection("desc");
  };

  const sortIndicator = (key) =>
    sortKey === key ? (sortDirection === "desc" ? " ↓" : " ↑") : "";

  if (marketsResource.error && !marketsResource.data) {
    return (
      <div className="rounded-sm border border-border bg-card p-6 text-sm text-muted-foreground">
        Failed to load markets: {marketsResource.error.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {model.lists.map((list) => (
          <button
            key={list.id}
            type="button"
            onClick={() => setModel((current) => setActiveWatchlist(current, list.id))}
            className={
              list.id === activeList.id
                ? "rounded-sm bg-muted px-3 py-1.5 text-xs font-medium text-foreground"
                : "rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            }
          >
            {list.name}
          </button>
        ))}

        {isCreatingList ? (
          <form onSubmit={handleCreateList} className="flex items-center gap-1">
            <input
              autoFocus
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setIsCreatingList(false);
                  setNewListName("");
                }
              }}
              placeholder="List name"
              maxLength={32}
              className="h-8 w-36 rounded-sm border border-border bg-background px-2 text-xs outline-none focus:border-ring"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsCreatingList(true)}
            className="flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            aria-label="New watchlist"
          >
            <Plus className="size-3.5" />
            New list
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const name = activeList.name;
              const next = window.prompt("Rename watchlist", name);
              if (next != null) {
                setModel((current) => renameWatchlist(current, activeList.id, next));
              }
            }}
            className="rounded-sm px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            Rename
          </button>
          <button
            type="button"
            disabled={model.lists.length <= 1}
            onClick={() => setModel((current) => removeWatchlist(current, activeList.id))}
            className="flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Delete watchlist"
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        </div>
      </div>

      <form onSubmit={handleAddCoin} className="flex items-center gap-2">
        <input
          value={coinInput}
          onChange={(event) => setCoinInput(event.target.value.toUpperCase())}
          placeholder="Add symbol (e.g. BTC)"
          maxLength={16}
          className="h-9 w-56 rounded-sm border border-border bg-background px-3 text-sm outline-none focus:border-ring"
        />
        <button
          type="submit"
          className="flex h-9 items-center gap-1 rounded-sm border border-border px-3 text-xs font-medium transition-colors hover:bg-muted/50"
        >
          <Plus className="size-3.5" />
          Add
        </button>
        {coinError ? <span className="text-xs text-destructive">{coinError}</span> : null}
      </form>

      <div className="overflow-x-auto rounded-sm border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th
                className="cursor-pointer px-4 py-3 font-light"
                onClick={() => handleSort("symbol")}
              >
                Symbol{sortIndicator("symbol")}
              </th>
              <th className="px-4 py-3 text-right font-light">Last</th>
              <th
                className="cursor-pointer px-4 py-3 text-right font-light"
                onClick={() => handleSort("changePct")}
              >
                24h{sortIndicator("changePct")}
              </th>
              <th className="px-4 py-3 font-light">24h chart</th>
              <th
                className="cursor-pointer px-4 py-3 text-right font-light"
                onClick={() => handleSort("dayNtlVlm")}
              >
                24h volume{sortIndicator("dayNtlVlm")}
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-right font-light"
                onClick={() => handleSort("openInterestNotional")}
              >
                Open interest{sortIndicator("openInterestNotional")}
              </th>
              <th className="px-4 py-3 text-right font-light">Funding /h</th>
              <th className="w-8 px-2 py-3" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.symbol} className="border-b border-border/60 last:border-b-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.symbol}</span>
                    {row.marketType === "tradfi" ? (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        TradFi
                      </span>
                    ) : null}
                  </div>
                  {!row.found && marketsResource.hasLoaded ? (
                    <span className="text-xs text-muted-foreground">Not found</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.markPx == null ? "—" : formatPrice(row.markPx)}
                </td>
                <td className="px-4 py-3 text-right">
                  <ChangeBadge value={row.changePct} />
                </td>
                <td className="px-4 py-2">
                  <SparklineCell
                    points={row.coin ? sparklines[row.coin] : null}
                    isLoading={sparklinesResource.isLoading}
                  />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.dayNtlVlm == null ? "—" : formatCompactCurrency(row.dayNtlVlm)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.openInterestNotional == null
                    ? "—"
                    : formatCurrency(row.openInterestNotional)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {row.fundingRate == null || !Number.isFinite(row.fundingRate)
                    ? "—"
                    : formatSignedPercent(row.fundingRate * 100, 4)}
                </td>
                <td className="px-2 py-3 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setModel((current) =>
                        removeCoinFromWatchlist(current, activeList.id, row.symbol),
                      )
                    }
                    className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    aria-label={`Remove ${row.symbol}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {!visibleRows.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  This list is empty. Add a symbol above, e.g. BTC, ETH or HYPE.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Prices refresh every 15 seconds from Hyperliquid&apos;s perp and equity
        (xyz) markets; sparklines show the last 24 hours of hourly closes and
        refresh every 2 minutes. Watchlists are stored in this browser.
      </p>
    </div>
  );
}
