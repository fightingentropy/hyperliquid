import { useEffect, useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import ButtonGroup from "./ButtonGroup";
import { cx } from "../lib/cx";
import {
  DEFAULT_RELATIVE_STRENGTH_FOCUS,
  RELATIVE_STRENGTH_MARKET_OPTIONS,
} from "../lib/relativeStrength";

function formatMarketType(marketType) {
  return marketType === "tradfi" ? "TradFi" : "Crypto";
}

function formatVolume(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

function uniqueSymbols(symbols) {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => String(symbol ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function filterMarketsByScope(markets, marketScope) {
  if (marketScope === "crypto") {
    return markets.filter((market) => market.marketType === "crypto");
  }

  if (marketScope === "tradfi") {
    return markets.filter((market) => market.marketType === "tradfi");
  }

  return markets;
}

export default function RelativeStrengthConfigModal({
  open,
  markets,
  marketScope,
  benchmarkSymbol,
  selectedSymbols,
  activeSymbols,
  onApply,
  onClose,
  isLoading = false,
}) {
  const titleId = useId();
  const [draftScope, setDraftScope] = useState(marketScope);
  const [draftBenchmark, setDraftBenchmark] = useState(benchmarkSymbol);
  const [draftSymbols, setDraftSymbols] = useState(() => new Set());
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    const initialSymbols = selectedSymbols?.length ? selectedSymbols : activeSymbols;

    setDraftScope(marketScope);
    setDraftBenchmark(benchmarkSymbol);
    setDraftSymbols(new Set(uniqueSymbols([...initialSymbols, benchmarkSymbol])));
    setSearch("");
  }, [activeSymbols, benchmarkSymbol, marketScope, open, selectedSymbols]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const scopedMarkets = useMemo(
    () => filterMarketsByScope(markets, draftScope),
    [draftScope, markets],
  );
  const scopedSymbolSet = useMemo(
    () => new Set(scopedMarkets.map((market) => market.symbol)),
    [scopedMarkets],
  );
  const fallbackBenchmark = scopedSymbolSet.has(DEFAULT_RELATIVE_STRENGTH_FOCUS)
    ? DEFAULT_RELATIVE_STRENGTH_FOCUS
    : scopedMarkets[0]?.symbol ?? "";
  const benchmarkValue = scopedSymbolSet.has(draftBenchmark)
    ? draftBenchmark
    : fallbackBenchmark;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredMarkets = normalizedSearch
    ? scopedMarkets.filter((market) =>
        `${market.symbol} ${market.coin} ${market.marketType}`
          .toLowerCase()
          .includes(normalizedSearch),
      )
    : scopedMarkets;
  const selectedCount = new Set([...draftSymbols, benchmarkValue].filter(Boolean)).size;

  if (!open) {
    return null;
  }

  const toggleSymbol = (symbol) => {
    if (symbol === benchmarkValue) {
      return;
    }

    setDraftSymbols((previous) => {
      const next = new Set(previous);

      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }

      return next;
    });
  };

  const selectVisible = () => {
    setDraftSymbols((previous) => {
      const next = new Set(previous);
      filteredMarkets.forEach((market) => next.add(market.symbol));
      return next;
    });
  };

  const clearSelection = () => {
    setDraftSymbols(new Set(benchmarkValue ? [benchmarkValue] : []));
  };

  const applyCustomModel = () => {
    const scopedSymbols = [...draftSymbols, benchmarkValue].filter((symbol) =>
      scopedSymbolSet.has(symbol),
    );

    onApply({
      marketScope: draftScope,
      benchmarkSymbol: benchmarkValue,
      selectedSymbols: uniqueSymbols(scopedSymbols),
    });
    onClose();
  };

  const applyAutoModel = () => {
    onApply({
      marketScope: draftScope,
      benchmarkSymbol: benchmarkValue,
      selectedSymbols: null,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-sm border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div>
            <h2 id={titleId} className="text-base font-medium text-foreground">
              Relative strength model
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose the Hyperliquid assets and benchmark line for this chart.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-sm border border-border text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-5 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                Universe
              </label>
              <ButtonGroup
                kind="segmented"
                options={RELATIVE_STRENGTH_MARKET_OPTIONS}
                value={draftScope}
                onChange={setDraftScope}
                size="sm"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor={`${titleId}-benchmark`}
                className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground"
              >
                Benchmark
              </label>
              <select
                id={`${titleId}-benchmark`}
                value={benchmarkValue}
                onChange={(event) => {
                  setDraftBenchmark(event.target.value);
                  setDraftSymbols((previous) => new Set([...previous, event.target.value]));
                }}
                disabled={!scopedMarkets.length}
                className="h-10 w-full rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-ring disabled:opacity-60"
              >
                {scopedMarkets.map((market) => (
                  <option key={market.symbol} value={market.symbol}>
                    {market.symbol}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-sm border border-border p-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                Selected
              </p>
              <p className="mt-2 font-mono text-2xl font-light text-foreground">
                {selectedCount}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedSymbols?.length ? "Custom model" : "Auto model until applied"}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectVisible}
                disabled={!filteredMarkets.length}
                className="h-9 rounded-sm border border-border px-3 text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Select visible
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={!benchmarkValue}
                className="h-9 rounded-sm border border-border px-3 text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-sm border border-border">
            <div className="border-b border-border p-3">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search assets"
                className="h-10 w-full rounded-sm border border-border bg-background px-3 font-mono text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring"
              />
            </div>

            <div className="min-h-64 flex-1 overflow-auto p-2">
              {isLoading ? (
                <div className="p-3 text-sm text-muted-foreground">Loading markets...</div>
              ) : null}

              {!isLoading && !filteredMarkets.length ? (
                <div className="p-3 text-sm text-muted-foreground">No markets match this filter.</div>
              ) : null}

              <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                {filteredMarkets.map((market) => {
                  const isBenchmark = market.symbol === benchmarkValue;
                  const checked = isBenchmark || draftSymbols.has(market.symbol);

                  return (
                    <label
                      key={market.symbol}
                      className={cx(
                        "flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-2 transition hover:bg-muted/50",
                        checked && "bg-muted/40",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isBenchmark}
                          onChange={() => toggleSymbol(market.symbol)}
                          className="size-4 rounded-sm border border-border accent-primary disabled:opacity-60"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-sm text-foreground">
                            {market.symbol}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {formatMarketType(market.marketType)} / {market.coin}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {formatVolume(market.dayNotionalVolume)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border p-5">
          <button
            type="button"
            onClick={applyAutoModel}
            disabled={!benchmarkValue}
            className="h-10 rounded-sm border border-border bg-transparent px-4 text-sm text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Auto set
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-sm border border-border bg-transparent px-4 text-sm text-muted-foreground transition hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={applyCustomModel}
            disabled={!benchmarkValue || selectedCount === 0}
            className="h-10 rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            Apply model
          </button>
        </div>
      </div>
    </div>
  );
}
