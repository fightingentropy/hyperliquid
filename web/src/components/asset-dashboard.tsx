import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CrosshairMode,
  ColorType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Activity, ChevronDown, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type DepthLevel = {
  price: number;
  size: number;
};

type RatiosResponse = {
  symbol: string;
  long_pct: number;
  short_pct: number;
};

type OpenInterestBlock = {
  long_pct: number;
  short_pct: number;
};

type OpenInterestResponse = {
  symbol: string;
  evaluation: OpenInterestBlock;
  funded: OpenInterestBlock;
  total: OpenInterestBlock;
};

type RelativeStrengthSymbol = {
  sparkline: number[];
  times: number[];
  change_pct: number | null;
  last_price: number | null;
};

type RelativeStrengthResponse = {
  symbols: Record<string, RelativeStrengthSymbol>;
};

type DepthResponse = {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
};

type KlineResponse = {
  candles: Candle[];
};
type AssetHeaderResponse = {
  source: string;
  symbol: string;
  pair: string;
  updatedAt: number;
  last: number | null;
  changePct: number | null;
  volume24h: number | null;
  openInterest: number | null;
  openInterestUsd?: number | null;
};

const TIMEFRAMES: Array<{ key: Timeframe; label: string }> = [
  { key: "1m", label: "1m" },
  { key: "5m", label: "5m" },
  { key: "15m", label: "15m" },
  { key: "30m", label: "30m" },
  { key: "1h", label: "1H" },
  { key: "4h", label: "4H" },
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
];
const TOP_NAV_LINKS: Array<{ label: string; href: string }> = [
  { label: "Perpetuals Analytics", href: "/perpetuals" },
  { label: "Heatmap", href: "/heatmap" },
  { label: "Liquidations", href: "/liquidations" },
  { label: "Unstaking", href: "/unstaking" },
  { label: "Wallet", href: "/wallet" },
  { label: "Settings", href: "/settings" },
  { label: "About", href: "/about" },
];
const DEFAULT_ASSET_PAIRS = ["HYPE/USD", "BTC/USD", "ETH/USD", "SOL/USD"];
const RELATIVE_Y_MIN = -10;
const RELATIVE_Y_MAX = 25;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const RELATIVE_LIST_MAX_SYMBOLS = 32;
const RELATIVE_Y_TICKS = Array.from(
  { length: Math.floor((RELATIVE_Y_MAX - RELATIVE_Y_MIN) / 2.5) + 1 },
  (_, index) => RELATIVE_Y_MIN + index * 2.5,
);

function formatPrice(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return "--";
  const amount = Number(value);
  if (amount >= 1000) {
    return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (amount >= 1) {
    return amount.toLocaleString("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  }
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}

function formatPercent(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return "--";
  const amount = Number(value);
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toFixed(2)}%`;
}

function formatCompact(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return "--";
  const amount = Number(value);
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(2);
}

function toAssetContext(rawParam: string | undefined) {
  const fallback = "HYPE/USD";
  const decoded = decodeURIComponent(rawParam ?? fallback)
    .trim()
    .toUpperCase();

  const cleaned = decoded.replace(/\s+/g, "");
  if (!cleaned) {
    return {
      pair: fallback,
      base: "HYPE",
      quote: "USD",
      apiSymbol: "HYPEUSD",
      binanceSymbol: "HYPEUSDT",
      relativeStrengthKey: "HYPE/USD",
    };
  }

  if (cleaned.includes("/")) {
    const [baseRaw, quoteRaw] = cleaned.split("/");
    const base = (baseRaw || "HYPE").replace(/[^A-Z0-9]/g, "") || "HYPE";
    const quote = (quoteRaw || "USD").replace(/[^A-Z0-9]/g, "") || "USD";
    const breakoutQuote = quote === "USDT" ? "USD" : quote;
    return {
      pair: `${base}/${breakoutQuote}`,
      base,
      quote: breakoutQuote,
      apiSymbol: `${base}${breakoutQuote}`,
      binanceSymbol: `${base}USDT`,
      relativeStrengthKey: `${base}/USD`,
    };
  }

  const plain = cleaned.replace(/[^A-Z0-9]/g, "");
  if (plain.endsWith("USDT")) {
    const base = plain.slice(0, -4) || "HYPE";
    return {
      pair: `${base}/USD`,
      base,
      quote: "USD",
      apiSymbol: `${base}USD`,
      binanceSymbol: `${base}USDT`,
      relativeStrengthKey: `${base}/USD`,
    };
  }

  if (plain.endsWith("USD")) {
    const base = plain.slice(0, -3) || "HYPE";
    return {
      pair: `${base}/USD`,
      base,
      quote: "USD",
      apiSymbol: `${base}USD`,
      binanceSymbol: `${base}USDT`,
      relativeStrengthKey: `${base}/USD`,
    };
  }

  const base = plain || "HYPE";
  return {
    pair: `${base}/USD`,
    base,
    quote: "USD",
    apiSymbol: `${base}USD`,
    binanceSymbol: `${base}USDT`,
    relativeStrengthKey: `${base}/USD`,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function toDepthSeries(depth: DepthResponse | null) {
  if (!depth) return [] as Array<{ price: number; bids?: number; asks?: number }>;

  const bidsNearToFar = [...depth.bids].sort((a, b) => b.price - a.price);
  const asksNearToFar = [...depth.asks].sort((a, b) => a.price - b.price);

  let bidCum = 0;
  const bidPoints = bidsNearToFar
    .map((level) => {
      bidCum += level.size;
      return { price: level.price, bids: bidCum };
    })
    .reverse();

  let askCum = 0;
  const askPoints = asksNearToFar.map((level) => {
    askCum += level.size;
    return { price: level.price, asks: askCum };
  });

  const map = new Map<number, { price: number; bids?: number; asks?: number }>();
  for (const point of bidPoints) {
    map.set(point.price, { price: point.price, bids: point.bids });
  }

  for (const point of askPoints) {
    const current = map.get(point.price) ?? { price: point.price };
    current.asks = point.asks;
    map.set(point.price, current);
  }

  return Array.from(map.values()).sort((a, b) => a.price - b.price);
}

function toRelativeStrengthData(
  response: RelativeStrengthResponse | null,
  focusSymbol: string,
) {
  if (!response) {
    return {
      chartRows: [] as Array<Record<string, number>>,
      symbols: [] as string[],
      changeBySymbol: {} as Record<string, number | null>,
    };
  }

  const rankedEntries = Object.entries(response.symbols)
    .filter(([, value]) => value.sparkline.length > 1)
    .sort((a, b) => {
      const aChangeRaw = Number(a[1].change_pct);
      const bChangeRaw = Number(b[1].change_pct);
      const aChange = Number.isFinite(aChangeRaw)
        ? aChangeRaw
        : Number.NEGATIVE_INFINITY;
      const bChange = Number.isFinite(bChangeRaw)
        ? bChangeRaw
        : Number.NEGATIVE_INFINITY;
      if (bChange !== aChange) return bChange - aChange;
      return a[0].localeCompare(b[0]);
    });

  const normalizedFocus = focusSymbol.toUpperCase();
  const focusIndex = rankedEntries.findIndex(
    ([symbol]) => symbol.toUpperCase() === normalizedFocus,
  );

  if (focusIndex > 0) {
    const [focusEntry] = rankedEntries.splice(focusIndex, 1);
    rankedEntries.unshift(focusEntry);
  }

  const entries = rankedEntries.slice(0, RELATIVE_LIST_MAX_SYMBOLS);

  const symbols = entries.map(([name]) => name);
  const times = entries[0]?.[1]?.times ?? [];

  const chartRows = times.map((time, index) => {
    const row: Record<string, number> = { time };
    for (const [symbol, payload] of entries) {
      const first = payload.sparkline[0] ?? 0;
      const current = payload.sparkline[index] ?? first;
      const pct = first > 0 ? ((current - first) / first) * 100 : 0;
      row[symbol] = pct;
    }
    return row;
  });

  const changeBySymbol = Object.fromEntries(
    entries.map(([symbol, payload]) => [symbol, payload.change_pct]),
  ) as Record<string, number | null>;

  return { chartRows, symbols, changeBySymbol };
}

function calculateMovingAverage(candles: Candle[], period: number) {
  const result: Array<{ time: UTCTimestamp; value: number }> = [];
  const closes = candles.map((candle) => candle.close);
  let rolling = 0;

  for (let index = 0; index < closes.length; index += 1) {
    rolling += closes[index];
    if (index >= period) rolling -= closes[index - period];
    if (index + 1 < period) continue;

    result.push({
      time: Math.floor(candles[index].time / 1000) as UTCTimestamp,
      value: rolling / period,
    });
  }

  return result;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const height = Math.max(0, Math.floor(rect.height));
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, size] as const;
}

function CandlestickView({ candles }: { candles: Candle[] }) {
  const RIGHT_LOGICAL_PADDING: number = 3;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const ma20Ref = useRef<any>(null);
  const ma50Ref = useRef<any>(null);
  const ma100Ref = useRef<any>(null);

  const fitWithRightPadding = (chart: IChartApi) => {
    const timeScale = chart.timeScale();
    timeScale.fitContent();
    if (RIGHT_LOGICAL_PADDING === 0) return;
    const range = timeScale.getVisibleLogicalRange();
    if (!range) return;
    timeScale.setVisibleLogicalRange({
      from: range.from,
      to: range.to + RIGHT_LOGICAL_PADDING,
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: {
          type: ColorType.Solid,
          color: "rgba(16, 19, 24, 0)",
        },
        textColor: "#95a2b2",
      },
      grid: {
        vertLines: { color: "rgba(60, 68, 79, 0.45)" },
        horzLines: { color: "rgba(60, 68, 79, 0.45)" },
      },
      rightPriceScale: {
        borderColor: "rgba(0, 0, 0, 0)",
      },
      timeScale: {
        borderColor: "rgba(0, 0, 0, 0)",
        rightOffset: RIGHT_LOGICAL_PADDING,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#2ecfd0",
      downColor: "#ff606a",
      borderVisible: false,
      wickUpColor: "#2ecfd0",
      wickDownColor: "#ff606a",
      priceLineColor: "#ff606a",
      priceLineWidth: 1,
    });

    const ma20 = chart.addLineSeries({
      color: "#e3bc43",
      lineWidth: 2,
      priceLineVisible: false,
    });

    const ma50 = chart.addLineSeries({
      color: "#a58df4",
      lineWidth: 2,
      priceLineVisible: false,
    });

    const ma100 = chart.addLineSeries({
      color: "#d16ab0",
      lineWidth: 2,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    ma20Ref.current = ma20;
    ma50Ref.current = ma50;
    ma100Ref.current = ma100;

    const resizeObserver = new ResizeObserver(() => {
      fitWithRightPadding(chart);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    candleSeriesRef.current.setData(
      candles.map((candle) => ({
        time: Math.floor(candle.time / 1000) as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );

    ma20Ref.current?.setData(calculateMovingAverage(candles, 20));
    ma50Ref.current?.setData(calculateMovingAverage(candles, 50));
    ma100Ref.current?.setData(calculateMovingAverage(candles, 100));

    if (chartRef.current) {
      fitWithRightPadding(chartRef.current);
    }
  }, [candles]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function LongShortBar({
  longPct,
  shortPct,
}: {
  longPct: number | null | undefined;
  shortPct: number | null | undefined;
}) {
  const longValue = Math.max(0, Math.min(100, Number(longPct ?? 0)));
  const shortValue = Math.max(0, Math.min(100, Number(shortPct ?? 0)));

  return (
    <div className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-[#202a36]">
      <div className="flex h-full w-full">
        <div className="bg-[#2ecfd0]" style={{ width: `${longValue}%` }} />
        <div className="bg-[#ff606a]" style={{ width: `${shortValue}%` }} />
      </div>
    </div>
  );
}

export function AssetDashboardPage() {
  const location = useLocation();
  const [assetPair, setAssetPair] = useState(() => {
    const params = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    );
    return toAssetContext(params.get("asset") ?? undefined).pair;
  });
  const asset = useMemo(() => toAssetContext(assetPair), [assetPair]);
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [ratios, setRatios] = useState<RatiosResponse | null>(null);
  const [openInterest, setOpenInterest] = useState<OpenInterestResponse | null>(null);
  const [depth, setDepth] = useState<DepthResponse | null>(null);
  const [assetHeader, setAssetHeader] = useState<AssetHeaderResponse | null>(null);
  const [relativeStrength, setRelativeStrength] = useState<RelativeStrengthResponse | null>(
    null,
  );
  const [hoveredRelativeRow, setHoveredRelativeRow] = useState<Record<string, number> | null>(
    null,
  );
  const [depthChartRef, depthChartSize] = useElementSize<HTMLDivElement>();
  const [relativeChartRef, relativeChartSize] = useElementSize<HTMLDivElement>();
  const isDocumentHidden = () =>
    typeof document !== "undefined" && document.visibilityState === "hidden";

  const [error, setError] = useState<string | null>(null);
  const [symbolMenuOpen, setSymbolMenuOpen] = useState(false);
  const [timeframeMenuOpen, setTimeframeMenuOpen] = useState(false);
  const [symbolSearch, setSymbolSearch] = useState("");
  const symbolDropdownRef = useRef<HTMLDivElement | null>(null);
  const timeframeDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextPair = toAssetContext(params.get("asset") ?? undefined).pair;
    setAssetPair((prev) => (prev === nextPair ? prev : nextPair));
  }, [location.search]);

  const handleAssetPairChange = (nextPair: string) => {
    const normalized = toAssetContext(nextPair).pair;
    setAssetPair((prev) => (prev === normalized ? prev : normalized));
    setHoveredRelativeRow(null);
    setSymbolSearch("");
    setSymbolMenuOpen(false);
    setError(null);
  };

  const orderedTimeframes = useMemo(() => {
    const active = TIMEFRAMES.find((item) => item.key === timeframe);
    if (!active) return TIMEFRAMES;
    return [active, ...TIMEFRAMES.filter((item) => item.key !== timeframe)];
  }, [timeframe]);

  const timeframeLabel =
    TIMEFRAMES.find((item) => item.key === timeframe)?.label ?? timeframe.toUpperCase();

  useEffect(() => {
    if (!symbolMenuOpen) {
      setSymbolSearch("");
    }
  }, [symbolMenuOpen]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        symbolDropdownRef.current &&
        !symbolDropdownRef.current.contains(target)
      ) {
        setSymbolMenuOpen(false);
      }
      if (
        timeframeDropdownRef.current &&
        !timeframeDropdownRef.current.contains(target)
      ) {
        setTimeframeMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCandles() {
      if (isDocumentHidden()) return;
      try {
        const payload = await fetchJson<KlineResponse>(
          `/api/klines/${encodeURIComponent(asset.apiSymbol)}?interval=${timeframe}&limit=220`,
        );
        if (!cancelled) {
          setCandles(payload.candles ?? []);
          setError(null);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load candles");
        }
      }
    }

    loadCandles();
    const intervalId = window.setInterval(loadCandles, 25_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [asset.apiSymbol, timeframe]);

  useEffect(() => {
    let cancelled = false;

    async function loadAssetHeader() {
      if (isDocumentHidden()) return;
      try {
        const payload = await fetchJson<AssetHeaderResponse>(
          `/api/asset-header/${encodeURIComponent(asset.apiSymbol)}?refresh=1`,
        );
        if (!cancelled) {
          setAssetHeader(payload);
        }
      } catch {
        // Keep prior value on transient errors.
      }
    }

    loadAssetHeader();
    const intervalId = window.setInterval(loadAssetHeader, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [asset.apiSymbol]);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      if (isDocumentHidden()) return;
      try {
        const [ratiosRes, openInterestRes] = await Promise.all([
          fetchJson<RatiosResponse>(`/api/ratios/${encodeURIComponent(asset.apiSymbol)}`),
          fetchJson<OpenInterestResponse>(
            `/api/open-interest/${encodeURIComponent(asset.apiSymbol)}`,
          ),
        ]);

        if (!cancelled) {
          setRatios(ratiosRes);
          setOpenInterest(openInterestRes);
          setError(null);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load stats");
        }
      }
    }

    loadStats();
    const intervalId = window.setInterval(loadStats, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [asset.apiSymbol]);

  useEffect(() => {
    let cancelled = false;

    const loadDepth = async () => {
      if (isDocumentHidden()) return;
      try {
        const payload = await fetchJson<DepthResponse>(
          `/api/depth/${encodeURIComponent(asset.apiSymbol)}?refresh=1`,
        );
        if (!cancelled) {
          setDepth(payload);
        }
      } catch {
        // Keep prior depth on transient failures.
      }
    };

    loadDepth();
    const intervalId = window.setInterval(loadDepth, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [asset.apiSymbol]);

  useEffect(() => {
    let cancelled = false;

    async function loadRelativeStrength() {
      if (isDocumentHidden()) return;
      try {
        const payload = await fetchJson<RelativeStrengthResponse>(
          "/api/market/relative-strength",
        );
        if (!cancelled) {
          setRelativeStrength(payload);
          setError(null);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Failed to load relative strength",
          );
        }
      }
    }

    loadRelativeStrength();
    const intervalId = window.setInterval(loadRelativeStrength, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const lastPrice = lastCandle?.close ?? null;
  const lastVolume = lastCandle?.volume ?? null;
  const changePct =
    lastCandle && prevCandle
      ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100
      : null;
  const headerLast = assetHeader?.last ?? lastPrice;
  const headerChangePct = assetHeader?.changePct ?? changePct;
  const headerVolume = assetHeader?.volume24h ?? lastVolume;
  const headerOpenInterest =
    assetHeader?.openInterestUsd ??
    (openInterest?.total.long_pct ?? 0) + (openInterest?.total.short_pct ?? 0);

  const depthChartRows = useMemo(() => toDepthSeries(depth), [depth]);
  const depthMid =
    depth?.bids?.[0] && depth?.asks?.[0]
      ? (depth.bids[0].price + depth.asks[0].price) / 2
      : null;
  const depthChartRowsForRender = useMemo(() => {
    if (depthChartRows.length < 2 || !Number.isFinite(depthMid ?? NaN)) {
      return depthChartRows;
    }

    const mid = Number(depthMid);
    const domainMin = mid - 0.5;
    const domainMax = mid + 0.5;
    const bounded = depthChartRows.filter(
      (row) => row.price >= domainMin && row.price <= domainMax,
    );
    return bounded.length ? bounded : depthChartRows;
  }, [depthChartRows, depthMid]);

  const relative = useMemo(
    () => toRelativeStrengthData(relativeStrength, asset.relativeStrengthKey),
    [asset.relativeStrengthKey, relativeStrength],
  );
  const assetPairOptions = useMemo(() => {
    const options = new Set<string>(DEFAULT_ASSET_PAIRS);
    options.add(asset.pair);
    for (const symbol of relative.symbols) {
      options.add(toAssetContext(symbol).pair);
    }
    const sorted = Array.from(options).sort((a, b) => a.localeCompare(b));
    return [asset.pair, ...sorted.filter((pair) => pair !== asset.pair)];
  }, [asset.pair, relative.symbols]);
  const filteredAssetPairOptions = useMemo(() => {
    const query = symbolSearch.trim().toUpperCase().replace(/\s+/g, "");
    if (!query) return assetPairOptions.slice(0, 50);
    return assetPairOptions
      .filter((pair) => {
        const symbol = pair.toUpperCase();
        return symbol.includes(query) || symbol.replace("/", "").includes(query);
      })
      .slice(0, 50);
  }, [assetPairOptions, symbolSearch]);

  const selectedStrengthKey = relative.symbols.includes(asset.relativeStrengthKey)
    ? asset.relativeStrengthKey
    : relative.symbols[0] ?? null;

  const bullish = (ratios?.long_pct ?? 0) >= (ratios?.short_pct ?? 0);
  const latestRelativeRow = relative.chartRows[relative.chartRows.length - 1] ?? null;
  const activeRelativeRow = hoveredRelativeRow ?? latestRelativeRow;
  const visibleRelativeChangeBySymbol = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const symbol of relative.symbols) {
      const value = activeRelativeRow?.[symbol];
      if (typeof value === "number" && Number.isFinite(value)) {
        out[symbol] = value;
      } else {
        out[symbol] = relative.changeBySymbol[symbol] ?? null;
      }
    }
    return out;
  }, [activeRelativeRow, relative.changeBySymbol, relative.symbols]);
  const splitIndex = Math.ceil(relative.symbols.length / 2);
  const leftRelativeSymbols = relative.symbols.slice(0, splitIndex);
  const rightRelativeSymbols = relative.symbols.slice(splitIndex);
  const selectedRelativeValue =
    selectedStrengthKey != null
      ? (activeRelativeRow?.[selectedStrengthKey] ?? null)
      : null;
  const selectedRelativeTopPct = useMemo(() => {
    if (
      selectedRelativeValue == null ||
      !Number.isFinite(selectedRelativeValue) ||
      RELATIVE_Y_MAX <= RELATIVE_Y_MIN
    ) {
      return 50;
    }
    const normalized =
      (selectedRelativeValue - RELATIVE_Y_MIN) /
      (RELATIVE_Y_MAX - RELATIVE_Y_MIN);
    const inverted = 1 - normalized;
    return Math.max(2, Math.min(98, inverted * 100));
  }, [selectedRelativeValue]);
  const relativeXTicks = useMemo(() => {
    if (!relative.chartRows.length) return [] as number[];
    const firstTime = Number(relative.chartRows[0]?.time ?? NaN);
    const lastTime = Number(relative.chartRows[relative.chartRows.length - 1]?.time ?? NaN);
    if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime) || lastTime <= firstTime) {
      return [] as number[];
    }

    const alignedStart = Math.ceil(firstTime / THREE_HOURS_MS) * THREE_HOURS_MS;
    const ticks: number[] = [];
    for (let tick = alignedStart; tick <= lastTime; tick += THREE_HOURS_MS) {
      ticks.push(tick);
    }
    return ticks;
  }, [relative.chartRows]);

  const renderRelativeRow = (symbol: string) => {
    const change = visibleRelativeChangeBySymbol[symbol];
    const active = symbol === selectedStrengthKey;

    return (
      <div
        key={symbol}
        className={cn(
          "flex items-center justify-between rounded-sm px-0.5 py-[1px] font-mono",
          active ? "bg-[#242d38] text-[#dfe6ef]" : "text-[#9daab9]",
        )}
      >
        <span>{symbol.replace("/USD", "")}</span>
        <span
          className={cn(
            "ml-1",
            (change ?? 0) >= 0 ? "text-[#2ecfd0]" : "text-[#ff606a]",
          )}
        >
          {formatPercent(change)}
        </span>
      </div>
    );
  };
  const isTopLinkActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(`${href}/`);

  return (
    <main className="asset-page-shell h-screen overflow-hidden bg-transparent text-[#a0adbe]">
      <nav className="top-nav asset-shared-nav">
        <a className="brand" href="/">
          <span className="brand-logo" aria-hidden="true" />
          <span className="brand-text">Stats</span>
        </a>
        <div className="nav-links">
          {TOP_NAV_LINKS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={cn("nav-link", isTopLinkActive(item.href) ? "active" : undefined)}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <div className="asset-page-content">
        <div className="asset-grid grid h-full min-h-0 gap-2">
        <Card className="asset-panel flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="px-2.5 pb-2 pt-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="asset-header-controls flex min-w-0 items-center gap-3">
                <div ref={symbolDropdownRef} className="asset-inline-dropdown asset-inline-symbol">
                  <button
                    type="button"
                    className="asset-inline-trigger asset-inline-trigger-symbol"
                    onClick={() => {
                      setSymbolMenuOpen((prev) => {
                        const next = !prev;
                        if (next) setTimeframeMenuOpen(false);
                        return next;
                      });
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={symbolMenuOpen}
                  >
                    <span className="asset-inline-text-main">{asset.pair}</span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-[#9ab0c7] transition-transform",
                        symbolMenuOpen ? "rotate-180" : "",
                      )}
                    />
                  </button>

                  {symbolMenuOpen ? (
                    <div className="asset-inline-menu asset-symbol-menu">
                      <div className="asset-symbol-search-wrap">
                        <Search className="asset-symbol-search-icon h-3.5 w-3.5" />
                        <input
                          type="search"
                          value={symbolSearch}
                          autoFocus
                          onChange={(event) => setSymbolSearch(event.target.value)}
                          placeholder="Search symbol"
                          className="asset-symbol-search"
                        />
                      </div>
                      <div className="asset-symbol-list" role="listbox" aria-label="Asset symbol">
                        {filteredAssetPairOptions.length ? (
                          filteredAssetPairOptions.map((pair) => (
                            <button
                              key={pair}
                              type="button"
                              className={cn(
                                "asset-symbol-option",
                                pair === asset.pair ? "active" : undefined,
                              )}
                              onClick={() => handleAssetPairChange(pair)}
                            >
                              {pair}
                            </button>
                          ))
                        ) : (
                          <div className="asset-symbol-empty">No symbols found</div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div
                  ref={timeframeDropdownRef}
                  className="asset-inline-dropdown asset-inline-market"
                >
                  <button
                    type="button"
                    className="asset-inline-trigger asset-inline-trigger-market"
                    onClick={() => {
                      setTimeframeMenuOpen((prev) => {
                        const next = !prev;
                        if (next) setSymbolMenuOpen(false);
                        return next;
                      });
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={timeframeMenuOpen}
                  >
                    <span className="asset-inline-text-sub">Perpetual · {timeframeLabel}</span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-[#9ab0c7] transition-transform",
                        timeframeMenuOpen ? "rotate-180" : "",
                      )}
                    />
                  </button>

                  {timeframeMenuOpen ? (
                    <div className="asset-inline-menu asset-market-menu">
                      {orderedTimeframes.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className={cn(
                            "asset-market-option",
                            item.key === timeframe ? "active" : undefined,
                          )}
                          onClick={() => {
                            setTimeframe(item.key);
                            setTimeframeMenuOpen(false);
                          }}
                        >
                          Perpetual · {item.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-4 text-[10px] uppercase tracking-wide text-[#90a0b3]">
                <div>
                  <div>Last</div>
                  <div className="font-mono text-[9px] text-[#ecf2f9] sm:text-[11px]">
                    ${formatPrice(headerLast)}
                  </div>
                </div>
                <div>
                  <div>Change</div>
                  <div
                    className={cn(
                      "font-mono text-[9px] sm:text-[11px]",
                      (headerChangePct ?? 0) >= 0 ? "text-[#2ecfd0]" : "text-[#ff606a]",
                    )}
                  >
                    {formatPercent(headerChangePct)}
                  </div>
                </div>
                <div>
                  <div>Volume</div>
                  <div className="font-mono text-[9px] text-[#ecf2f9] sm:text-[11px]">
                    ${formatCompact(headerVolume)}
                  </div>
                </div>
                <div>
                  <div>Open Interest</div>
                  <div className="font-mono text-[9px] text-[#ecf2f9] sm:text-[11px]">
                    {formatCompact(headerOpenInterest)}
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-full p-0">
            <CandlestickView candles={candles} />
          </CardContent>
        </Card>

        <Card className="asset-panel flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="px-2.5 pb-2 pt-2.5">
            <CardTitle className="flex items-center justify-between text-sm uppercase tracking-[0.14em] text-[#a1afbe]">
              <span>Orderbook Depth</span>
              <Badge variant={bullish ? "positive" : "negative"}>
                {bullish ? "Bid Bias" : "Ask Bias"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="h-full min-h-[220px] p-0 pr-2">
            <div ref={depthChartRef} className="h-full w-full">
              {depthChartSize.width > 0 && depthChartSize.height > 0 ? (
                <AreaChart
                  width={depthChartSize.width}
                  height={depthChartSize.height}
                  data={depthChartRowsForRender}
                  margin={{ top: 8, right: 0, left: 0, bottom: 8 }}
                >
                  <defs>
                    <linearGradient id="depthBids" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2ecfd0" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#2ecfd0" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="depthAsks" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ff606a" stopOpacity={0.34} />
                      <stop offset="100%" stopColor="#ff606a" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid stroke="rgba(60, 68, 79, 0.45)" strokeDasharray="0" />
                  <XAxis
                    dataKey="price"
                    type="number"
                    tick={{ fill: "#95a2b2", fontSize: 11 }}
                    tickFormatter={(value) => `$${formatPrice(value)}`}
                    domain={["dataMin", "dataMax"]}
                  />
                  <YAxis
                    tick={{ fill: "#95a2b2", fontSize: 11 }}
                    tickFormatter={(value) => formatCompact(value)}
                  />
                  {depthMid ? (
                    <ReferenceLine x={depthMid} stroke="#485465" strokeDasharray="3 4" />
                  ) : null}
                  <Tooltip
                    cursor={false}
                    contentStyle={{
                      border: "1px solid #36404c",
                      borderRadius: "4px",
                      backgroundColor: "#151b24",
                      color: "#d3dce7",
                      fontSize: "11px",
                    }}
                    formatter={(value: number | undefined, name: string | undefined) =>
                      [
                        formatCompact(value),
                        name === "bids" ? "Bids" : "Asks",
                      ] as [string, string]
                    }
                    labelFormatter={(value) => `Price: $${formatPrice(Number(value))}`}
                  />

                  <Area
                    type="stepAfter"
                    dataKey="bids"
                    stroke="#2ecfd0"
                    fill="url(#depthBids)"
                    strokeWidth={2}
                    connectNulls
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Area
                    type="stepBefore"
                    dataKey="asks"
                    stroke="#ff606a"
                    fill="url(#depthAsks)"
                    strokeWidth={2}
                    connectNulls
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="asset-panel asset-panel-relative flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="px-2.5 pb-2 pt-2.5">
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-[0.14em] text-[#a1afbe]">
              <Activity className="h-3.5 w-3.5 text-[#2ecfd0]" />
              Relative Strength
            </CardTitle>
          </CardHeader>
          <CardContent className="relative h-full min-h-[260px] p-0">
            <div ref={relativeChartRef} className="absolute inset-0">
              {relativeChartSize.width > 0 && relativeChartSize.height > 0 ? (
                <LineChart
                  width={relativeChartSize.width}
                  height={relativeChartSize.height}
                  data={relative.chartRows}
                  margin={{ top: 8, right: 14, left: 8, bottom: 0 }}
                  onMouseMove={(state: any) => {
                    const payloadRow = state?.activePayload?.[0]?.payload;
                    if (payloadRow && typeof payloadRow === "object") {
                      setHoveredRelativeRow(payloadRow as Record<string, number>);
                      return;
                    }

                    const tooltipIndex = state?.activeTooltipIndex;
                    if (
                      typeof tooltipIndex === "number" &&
                      tooltipIndex >= 0 &&
                      tooltipIndex < relative.chartRows.length
                    ) {
                      setHoveredRelativeRow(relative.chartRows[tooltipIndex]);
                      return;
                    }

                    const activeLabel = Number(state?.activeLabel);
                    if (Number.isFinite(activeLabel)) {
                      const rowByTime = relative.chartRows.find(
                        (row) => Number(row.time) === activeLabel,
                      );
                      if (rowByTime) {
                        setHoveredRelativeRow(rowByTime);
                        return;
                      }
                    }

                    setHoveredRelativeRow(null);
                  }}
                  onMouseLeave={() => setHoveredRelativeRow(null)}
                >
                  <CartesianGrid stroke="rgba(60, 68, 79, 0.45)" />
                  <XAxis
                    dataKey="time"
                    type="number"
                    ticks={relativeXTicks}
                    domain={["dataMin", "dataMax"]}
                    tick={{ fill: "#95a2b2", fontSize: 11 }}
                    tickFormatter={(time) => {
                      const date = new Date(Number(time));
                      const hours = date.getHours();
                      const minutes = date.getMinutes();
                      if (hours === 0 && minutes === 0) {
                        return String(date.getDate());
                      }
                      return `${String(hours).padStart(2, "0")}:00`;
                    }}
                  />
                  <YAxis
                    orientation="right"
                    tick={{ fill: "#95a2b2", fontSize: 11 }}
                    tickFormatter={(value) => formatPercent(Number(value))}
                    domain={[RELATIVE_Y_MIN, RELATIVE_Y_MAX]}
                    ticks={RELATIVE_Y_TICKS}
                  />
                  <Tooltip
                    content={() => null}
                    cursor={{ stroke: "#586476", strokeWidth: 1, strokeDasharray: "4 4" }}
                  />

                  {relative.symbols.map((symbol, index) => {
                    const isActive = symbol === selectedStrengthKey;
                    const hue = (index * 19) % 360;
                    const stroke = isActive ? "#2ecfd0" : `hsla(${hue} 70% 62% / 0.35)`;
                    return (
                      <Line
                        key={symbol}
                        type="monotone"
                        dataKey={symbol}
                        stroke={stroke}
                        strokeWidth={isActive ? 2.5 : 1}
                        dot={false}
                        activeDot={
                          isActive
                            ? {
                                r: 3.5,
                                fill: "#2ecfd0",
                                stroke: "#9fb9c9",
                                strokeWidth: 1,
                              }
                            : false
                        }
                        isAnimationActive={false}
                      />
                    );
                  })}
                </LineChart>
              ) : null}
            </div>

            {selectedStrengthKey && selectedRelativeValue != null ? (
              <div
                className="pointer-events-none absolute right-0 z-20 -translate-y-1/2 rounded-sm bg-[#2c3745] px-1.5 py-[1px] font-mono text-[9px] font-medium text-[#e3eaf2]"
                style={{ top: `${selectedRelativeTopPct}%` }}
              >
                {selectedStrengthKey.replace("/USD", "")} {formatPercent(selectedRelativeValue)}
              </div>
            ) : null}

            <div className="pointer-events-none absolute left-0 top-0 z-10 w-[176px] overflow-hidden bg-[#11161dbf] p-1.5 sm:w-[188px]">
              <div className="grid grid-cols-2 gap-x-1.5 pr-0.5 text-[7px] leading-[1.1] sm:text-[9px]">
                <div className="space-y-[2px]">{leftRelativeSymbols.map(renderRelativeRow)}</div>
                <div className="space-y-[2px]">{rightRelativeSymbols.map(renderRelativeRow)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="asset-panel asset-panel-stats flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="px-2.5 pb-2 pt-2.5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm uppercase tracking-[0.14em] text-[#a1afbe]">
                Sentiment
              </CardTitle>
              <Badge variant={bullish ? "positive" : "negative"}>
                {bullish ? "Bullish" : "Bearish"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex h-full flex-col gap-5 p-4 pt-2">
            <section>
              <div className="mb-1 text-xs uppercase tracking-[0.16em] text-[#8f9dac]">
                Long vs Short
              </div>
              <div className="mb-1 flex items-center justify-between font-mono text-base">
                <div className="text-[#2ecfd0]">{(ratios?.long_pct ?? 0).toFixed(1)}% Long</div>
                <div className="text-[#ff606a]">{(ratios?.short_pct ?? 0).toFixed(1)}% Short</div>
              </div>
              <LongShortBar longPct={ratios?.long_pct} shortPct={ratios?.short_pct} />
            </section>

            <section className="space-y-4">
              <div className="text-xs uppercase tracking-[0.16em] text-[#8f9dac]">
                Open Interest
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-[#90a0b3]">
                  <span>Evaluation</span>
                  <span>
                    {(openInterest?.evaluation.long_pct ?? 0).toFixed(1)} /{" "}
                    {(openInterest?.evaluation.short_pct ?? 0).toFixed(1)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-[#2ecfd0]">
                    Long {(openInterest?.evaluation.long_pct ?? 0).toFixed(1)}%
                  </span>
                  <span className="text-[#ff606a]">
                    Short {(openInterest?.evaluation.short_pct ?? 0).toFixed(1)}%
                  </span>
                </div>
                <LongShortBar
                  longPct={openInterest?.evaluation.long_pct}
                  shortPct={openInterest?.evaluation.short_pct}
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-[#90a0b3]">
                  <span>Funded</span>
                  <span>
                    {(openInterest?.funded.long_pct ?? 0).toFixed(1)} /{" "}
                    {(openInterest?.funded.short_pct ?? 0).toFixed(1)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-[#2ecfd0]">
                    Long {(openInterest?.funded.long_pct ?? 0).toFixed(1)}%
                  </span>
                  <span className="text-[#ff606a]">
                    Short {(openInterest?.funded.short_pct ?? 0).toFixed(1)}%
                  </span>
                </div>
                <LongShortBar
                  longPct={openInterest?.funded.long_pct}
                  shortPct={openInterest?.funded.short_pct}
                />
              </div>
            </section>

            {error ? <p className="mt-auto text-xs text-[#ff606a]">{error}</p> : null}
          </CardContent>
        </Card>

        </div>
      </div>
    </main>
  );
}
