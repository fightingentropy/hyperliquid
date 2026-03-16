import { useLocation } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  splitProps,
  type JSX,
} from "solid-js";
import {
  CrosshairMode,
  ColorType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

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

type RelativeZoomDomain = {
  left: number;
  right: number;
  yMin: number;
  yMax: number;
};

type RelativePanAnchor = {
  startX: number;
  startY: number;
  domain: RelativeZoomDomain;
};

type RelativeContextMenu = {
  x: number;
  y: number;
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

type AssetOverviewResponse = {
  symbol: string;
  pair: string;
  updatedAt: number;
  assetHeader: AssetHeaderResponse;
  ratios: RatiosResponse;
  openInterest: OpenInterestResponse;
};

type RelativeData = ReturnType<typeof toRelativeStrengthData>;

type ChartPoint = {
  x: number;
  y: number;
};

type RelativeStrengthPanelProps = {
  relative: RelativeData;
  assetRelativeStrengthKey: string;
  timeframe: Timeframe;
  onTimeframeChange: (next: Timeframe) => void;
  resetToken: string;
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

const SETTINGS_KEY = "hl-settings:v1";
const DEFAULT_ASSET_PAIRS = ["HYPE/USD", "BTC/USD", "ETH/USD", "SOL/USD"];
const DEFAULT_RELATIVE_STRENGTH_BASES = [
  "HYPE",
  "GRASS",
  "AIXBT",
  "NEAR",
  "AAVE",
  "JUP",
  "JTO",
  "UNI",
  "BONK",
  "PUMP",
  "FIL",
  "TRX",
  "ARB",
  "TIA",
  "ORDI",
  "OP",
  "BTC",
  "FLOKI",
  "LDO",
  "PENGU",
  "VIRTUAL",
  "S",
  "ETC",
  "LTC",
  "ALGO",
  "WLD",
  "POPCAT",
  "LIT",
  "WIF",
  "PNUT",
  "TRUMP",
  "SUI",
  "BCH",
  "RENDER",
  "ETH",
  "TAO",
  "ATOM",
  "DOGE",
  "XRP",
  "CRV",
  "XPL",
  "AVAX",
  "SOL",
  "INJ",
  "APT",
  "HBAR",
  "TON",
  "ONDO",
  "ADA",
  "LINK",
  "STX",
  "POL",
  "ASTER",
  "MOODENG",
  "SHIB",
  "KAITO",
  "PEPE",
  "FARTCOIN",
  "ZEC",
  "DOT",
  "IP",
];
const DEFAULT_RELATIVE_STRENGTH_SYMBOLS = DEFAULT_RELATIVE_STRENGTH_BASES.map(
  (base) => `${base}/USD`,
);
const DEFAULT_RELATIVE_STRENGTH_BASE_SET = new Set(DEFAULT_RELATIVE_STRENGTH_BASES);
const RELATIVE_Y_MIN = -10;
const RELATIVE_Y_MAX = 25;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const RELATIVE_LIST_MAX_SYMBOLS = 32;
const RELATIVE_SETTINGS_MAX_SYMBOLS = 128;
const RELATIVE_Y_TICKS = Array.from(
  { length: Math.floor((RELATIVE_Y_MAX - RELATIVE_Y_MIN) / 2.5) + 1 },
  (_, index) => RELATIVE_Y_MIN + index * 2.5,
);
const RELATIVE_ZOOM_MIN_Y_SPAN = 1;
const RELATIVE_ZOOM_BASE_STEP = 0.045;
const RELATIVE_ZOOM_DELTA_NORMALIZER = 120;
const RELATIVE_ZOOM_MIN_DELTA_SCALE = 0.16;
const RELATIVE_ZOOM_MIN_POINTS = 8;
const RELATIVE_CHART_MARGIN = { top: 8, right: 14, left: 8, bottom: 18 } as const;
const DEPTH_CHART_MARGIN = { top: 8, right: 8, left: 8, bottom: 20 } as const;
const DEFAULT_RELATIVE_TIMEFRAME: Timeframe = "15m";
const RELATIVE_TICK_STEP_BY_TIMEFRAME: Record<Timeframe, number> = {
  "1m": 15 * MINUTE_MS,
  "5m": HOUR_MS,
  "15m": 3 * HOUR_MS,
  "30m": 6 * HOUR_MS,
  "1h": 12 * HOUR_MS,
  "4h": DAY_MS,
  "1d": WEEK_MS,
  "1w": 4 * WEEK_MS,
};

function clampNumber(value: number, min: number, max: number) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeRelativeStrengthSymbol(rawValue: string) {
  const compact = rawValue.trim().toUpperCase().replace(/\s+/g, "");
  if (!compact) return null;

  const [baseCandidate = ""] = compact.split("/");
  const sanitized = baseCandidate.replace(/[^A-Z0-9]/g, "");
  if (!sanitized) return null;

  if (sanitized.endsWith("USDT") && sanitized.length > 4) {
    return `${sanitized.slice(0, -4)}/USD`;
  }

  if (sanitized.endsWith("USD") && sanitized.length > 3) {
    return `${sanitized.slice(0, -3)}/USD`;
  }

  return `${sanitized}/USD`;
}

function parseRelativeStrengthDefaults(rawValue: unknown): string[] {
  const source = Array.isArray(rawValue)
    ? rawValue.map((value) => String(value)).join(",")
    : typeof rawValue === "string"
      ? rawValue
      : "";

  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const token of source.split(/[\s,]+/g)) {
    const normalized = normalizeRelativeStrengthSymbol(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    symbols.push(normalized);
    if (symbols.length >= RELATIVE_SETTINGS_MAX_SYMBOLS) break;
  }
  return symbols;
}

function readRelativeStrengthDefaultsFromStorage() {
  if (typeof window === "undefined") {
    return [...DEFAULT_RELATIVE_STRENGTH_SYMBOLS];
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return [...DEFAULT_RELATIVE_STRENGTH_SYMBOLS];
    const parsed = JSON.parse(raw);
    const settings = parsed && typeof parsed === "object" ? parsed : {};
    const hasCustomDefaults = Object.prototype.hasOwnProperty.call(
      settings,
      "relativeStrengthDefaults",
    );

    if (!hasCustomDefaults) return [...DEFAULT_RELATIVE_STRENGTH_SYMBOLS];
    return parseRelativeStrengthDefaults(
      (settings as { relativeStrengthDefaults?: unknown }).relativeStrengthDefaults,
    );
  } catch {
    return [...DEFAULT_RELATIVE_STRENGTH_SYMBOLS];
  }
}

function formatPrice(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
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
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  const amount = Number(value);
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toFixed(2)}%`;
}

function formatCompact(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  const amount = Number(value);
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(2);
}

function formatRelativeTick(time: number, timeframe: Timeframe) {
  const value = Number(time);
  if (!Number.isFinite(value)) return "";

  const date = new Date(value);
  if (timeframe === "1d" || timeframe === "1w") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const isDayBoundary = hours === 0 && minutes === 0;
  if (isDayBoundary) {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute:
      timeframe === "1m" || timeframe === "5m" || timeframe === "15m"
        ? "2-digit"
        : undefined,
    hour12: false,
  });
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

function toDepthSeries(
  depth: DepthResponse | null,
  levelsPerSide = Number.POSITIVE_INFINITY,
) {
  if (!depth) return [] as Array<{ price: number; bids?: number; asks?: number }>;

  const bidsNearToFar = [...depth.bids]
    .sort((a, b) => b.price - a.price)
    .slice(0, levelsPerSide);
  const asksNearToFar = [...depth.asks]
    .sort((a, b) => a.price - b.price)
    .slice(0, levelsPerSide);

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
  preferredSymbols: string[],
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

  const entryBySymbol = new Map(
    rankedEntries.map((entry) => [entry[0].toUpperCase(), entry]),
  );
  const preferredSet = new Set(
    preferredSymbols
      .map((symbol) => normalizeRelativeStrengthSymbol(symbol)?.toUpperCase() ?? "")
      .filter(Boolean),
  );
  const filteredEntries =
    preferredSet.size > 0
      ? rankedEntries.filter(([symbol]) => preferredSet.has(symbol.toUpperCase()))
      : rankedEntries;

  const normalizedFocus = normalizeRelativeStrengthSymbol(focusSymbol)?.toUpperCase() ?? "";
  const focusEntry = normalizedFocus ? entryBySymbol.get(normalizedFocus) : undefined;

  const entries = [
    ...(focusEntry ? [focusEntry] : []),
    ...filteredEntries.filter(([symbol]) => symbol !== focusEntry?.[0]),
  ].slice(0, RELATIVE_LIST_MAX_SYMBOLS);

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

function generateNumericTicks(min: number, max: number, count: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [] as number[];
  if (count <= 1 || Math.abs(max - min) < 1e-9) return [min];
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
}

function findNearestIndex<T>(
  items: T[],
  target: number,
  readValue: (item: T) => number,
) {
  if (!items.length || !Number.isFinite(target)) return -1;
  let low = 0;
  let high = items.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = readValue(items[mid]);
    if (value < target) {
      low = mid + 1;
    } else if (value > target) {
      high = mid - 1;
    } else {
      return mid;
    }
  }

  if (low >= items.length) return items.length - 1;
  if (high < 0) return 0;

  const lowValue = readValue(items[low]);
  const highValue = readValue(items[high]);
  return Math.abs(lowValue - target) < Math.abs(target - highValue) ? low : high;
}

function buildLinePath(points: ChartPoint[]) {
  if (!points.length) return "";
  const commands = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let index = 1; index < points.length; index += 1) {
    commands.push(`L ${points[index].x.toFixed(2)} ${points[index].y.toFixed(2)}`);
  }
  return commands.join(" ");
}

function buildStepAreaPath(points: ChartPoint[], baselineY: number, mode: "after" | "before") {
  if (!points.length) return "";
  const commands = [
    `M ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)}`,
    `L ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`,
  ];

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    if (mode === "after") {
      commands.push(`L ${current.x.toFixed(2)} ${prev.y.toFixed(2)}`);
    } else {
      commands.push(`L ${prev.x.toFixed(2)} ${current.y.toFixed(2)}`);
    }
    commands.push(`L ${current.x.toFixed(2)} ${current.y.toFixed(2)}`);
  }

  commands.push(`L ${points[points.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)}`, "Z");
  return commands.join(" ");
}

function createElementSize<T extends HTMLElement>() {
  const [element, setElement] = createSignal<T>();
  const [size, setSize] = createSignal({ width: 0, height: 0 });

  createEffect(() => {
    const current = element();
    if (!current) return;

    const update = () => {
      const rect = current.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const height = Math.max(0, Math.floor(rect.height));
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(current);

    onCleanup(() => {
      observer.disconnect();
    });
  });

  return {
    element,
    ref: (node: T) => setElement(() => node),
    size,
  };
}

function Card(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <div
      class={cn(
        "rounded-md border border-border bg-card text-card-foreground shadow-sm",
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </div>
  );
}

function CardHeader(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <div class={cn("flex flex-col space-y-1.5 p-3", local.class)} {...rest}>
      {local.children}
    </div>
  );
}

function CardTitle(props: JSX.HTMLAttributes<HTMLHeadingElement>) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <h3 class={cn("text-base font-semibold leading-none tracking-tight", local.class)} {...rest}>
      {local.children}
    </h3>
  );
}

function CardContent(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <div class={cn("p-3 pt-0", local.class)} {...rest}>
      {local.children}
    </div>
  );
}

function Badge(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    variant?: "default" | "positive" | "negative";
  },
) {
  const [local, rest] = splitProps(props, ["class", "children", "variant"]);
  const variantClass = () => {
    if (local.variant === "positive") return "border-[#1c5c62] bg-[#0f2329] text-[#2ecfd0]";
    if (local.variant === "negative") return "border-[#6a2e36] bg-[#291418] text-[#ff606a]";
    return "border-[#2b3f54] bg-[#111a27] text-[#b8d3eb]";
  };

  return (
    <div
      class={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        variantClass(),
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </div>
  );
}

function SearchIcon(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" {...props}>
      <circle cx="11" cy="11" r="7"></circle>
      <path d="m20 20-3.5-3.5"></path>
    </svg>
  );
}

function ChevronDownIcon(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" {...props}>
      <path d="m6 9 6 6 6-6"></path>
    </svg>
  );
}

function ActivityIcon(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" {...props}>
      <path d="M22 12h-4l-3 8-4-16-3 8H2"></path>
    </svg>
  );
}

function MinusIcon(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" {...props}>
      <path d="M5 12h14"></path>
    </svg>
  );
}

function PlusIcon(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" {...props}>
      <path d="M12 5v14"></path>
      <path d="M5 12h14"></path>
    </svg>
  );
}

function CandlestickView(props: { candles: Candle[] }) {
  const RIGHT_LOGICAL_PADDING = 3;
  const [container, setContainer] = createSignal<HTMLDivElement>();
  let chart: IChartApi | null = null;
  let candleSeries: any = null;
  let ma20Series: any = null;
  let ma50Series: any = null;
  let ma100Series: any = null;

  const fitWithRightPadding = (targetChart: IChartApi) => {
    const timeScale = targetChart.timeScale();
    timeScale.fitContent();
    const range = timeScale.getVisibleLogicalRange();
    if (!range) return;
    timeScale.setVisibleLogicalRange({
      from: range.from,
      to: range.to + RIGHT_LOGICAL_PADDING,
    });
  };

  onMount(() => {
    const node = container();
    if (!node) return;

    chart = createChart(node, {
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

    candleSeries = chart.addCandlestickSeries({
      upColor: "#2ecfd0",
      downColor: "#ff606a",
      borderVisible: false,
      wickUpColor: "#2ecfd0",
      wickDownColor: "#ff606a",
      priceLineColor: "#ff606a",
      priceLineWidth: 1,
    });

    ma20Series = chart.addLineSeries({
      color: "#e3bc43",
      lineWidth: 2,
      priceLineVisible: false,
    });

    ma50Series = chart.addLineSeries({
      color: "#a58df4",
      lineWidth: 2,
      priceLineVisible: false,
    });

    ma100Series = chart.addLineSeries({
      color: "#d16ab0",
      lineWidth: 2,
      priceLineVisible: false,
    });

    const resizeObserver = new ResizeObserver(() => {
      if (chart) {
        fitWithRightPadding(chart);
      }
    });
    resizeObserver.observe(node);

    onCleanup(() => {
      resizeObserver.disconnect();
      chart?.remove();
      chart = null;
      candleSeries = null;
      ma20Series = null;
      ma50Series = null;
      ma100Series = null;
    });
  });

  createEffect(() => {
    const nextCandles = props.candles;
    if (!candleSeries || !ma20Series || !ma50Series || !ma100Series) return;

    candleSeries.setData(
      nextCandles.map((candle) => ({
        time: Math.floor(candle.time / 1000) as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );
    ma20Series.setData(calculateMovingAverage(nextCandles, 20));
    ma50Series.setData(calculateMovingAverage(nextCandles, 50));
    ma100Series.setData(calculateMovingAverage(nextCandles, 100));

    if (chart) {
      fitWithRightPadding(chart);
    }
  });

  return <div ref={setContainer} class="h-full w-full" />;
}

function DepthChartView(props: { depth: DepthResponse | null }) {
  const gradientIdBase = createUniqueId();
  const bidGradientId = `${gradientIdBase}-bids`;
  const askGradientId = `${gradientIdBase}-asks`;
  const { ref: setContainer, size } = createElementSize<HTMLDivElement>();
  const [hoveredIndex, setHoveredIndex] = createSignal<number | null>(null);

  const rows = createMemo(() => toDepthSeries(props.depth));
  const mid = createMemo(() => {
    const depth = props.depth;
    return depth?.bids?.[0] && depth?.asks?.[0]
      ? (depth.bids[0].price + depth.asks[0].price) / 2
      : null;
  });

  const chartWidth = createMemo(() => size().width);
  const chartHeight = createMemo(() => size().height);
  const plotWidth = createMemo(
    () => Math.max(0, chartWidth() - DEPTH_CHART_MARGIN.left - DEPTH_CHART_MARGIN.right),
  );
  const plotHeight = createMemo(
    () => Math.max(0, chartHeight() - DEPTH_CHART_MARGIN.top - DEPTH_CHART_MARGIN.bottom),
  );
  const xMin = createMemo(() => rows()[0]?.price ?? 0);
  const xMax = createMemo(() => rows()[rows().length - 1]?.price ?? 1);
  const xSpan = createMemo(() => Math.max(1e-9, xMax() - xMin()));
  const yMax = createMemo(() =>
    Math.max(1, ...rows().map((row) => Math.max(row.bids ?? 0, row.asks ?? 0))),
  );
  const xTicks = createMemo(() => generateNumericTicks(xMin(), xMax(), 5));
  const yTicks = createMemo(() => generateNumericTicks(0, yMax(), 4));
  const hoveredRow = createMemo(() => {
    const index = hoveredIndex();
    return index == null ? null : rows()[index] ?? null;
  });
  const hoveredX = createMemo(() => {
    const row = hoveredRow();
    if (!row) return null;
    return DEPTH_CHART_MARGIN.left + ((row.price - xMin()) / xSpan()) * plotWidth();
  });

  const toX = (price: number) =>
    DEPTH_CHART_MARGIN.left + ((price - xMin()) / xSpan()) * plotWidth();
  const toY = (value: number) =>
    DEPTH_CHART_MARGIN.top + (1 - value / Math.max(1, yMax())) * plotHeight();

  const bidPath = createMemo(() => {
    const points = rows()
      .filter((row) => row.bids != null)
      .map((row) => ({
        x: toX(row.price),
        y: toY(row.bids ?? 0),
      }));
    return buildStepAreaPath(points, DEPTH_CHART_MARGIN.top + plotHeight(), "after");
  });

  const askPath = createMemo(() => {
    const points = rows()
      .filter((row) => row.asks != null)
      .map((row) => ({
        x: toX(row.price),
        y: toY(row.asks ?? 0),
      }));
    return buildStepAreaPath(points, DEPTH_CHART_MARGIN.top + plotHeight(), "before");
  });

  const handlePointer = (event: MouseEvent) => {
    const data = rows();
    if (!data.length || chartWidth() <= 0) {
      setHoveredIndex(null);
      return;
    }

    const currentTarget = event.currentTarget as HTMLDivElement;
    const rect = currentTarget.getBoundingClientRect();
    const relativeX = clampNumber(
      event.clientX - rect.left - DEPTH_CHART_MARGIN.left,
      0,
      plotWidth(),
    );
    const targetPrice = xMin() + (relativeX / Math.max(1, plotWidth())) * xSpan();
    const index = findNearestIndex(data, targetPrice, (row) => row.price);
    setHoveredIndex(index >= 0 ? index : null);
  };

  return (
    <div
      ref={setContainer}
      class="relative h-full w-full"
      onMouseMove={handlePointer}
      onMouseLeave={() => setHoveredIndex(null)}
    >
      <Show when={chartWidth() > 0 && chartHeight() > 0}>
        <svg class="h-full w-full overflow-visible" viewBox={`0 0 ${chartWidth()} ${chartHeight()}`}>
          <defs>
            <linearGradient id={bidGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#2ecfd0" stop-opacity="0.35" />
              <stop offset="100%" stop-color="#2ecfd0" stop-opacity="0.02" />
            </linearGradient>
            <linearGradient id={askGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#ff606a" stop-opacity="0.34" />
              <stop offset="100%" stop-color="#ff606a" stop-opacity="0.02" />
            </linearGradient>
          </defs>

          <For each={yTicks()}>
            {(tick) => {
              const y = toY(tick);
              return (
                <>
                  <line
                    x1={DEPTH_CHART_MARGIN.left}
                    y1={y}
                    x2={DEPTH_CHART_MARGIN.left + plotWidth()}
                    y2={y}
                    stroke="rgba(60, 68, 79, 0.45)"
                    stroke-width="1"
                  />
                  <text
                    x={DEPTH_CHART_MARGIN.left}
                    y={y - 4}
                    fill="#95a2b2"
                    font-size="11"
                    text-anchor="start"
                  >
                    {formatCompact(tick)}
                  </text>
                </>
              );
            }}
          </For>

          <For each={xTicks()}>
            {(tick) => {
              const x = toX(tick);
              return (
                <>
                  <line
                    x1={x}
                    y1={DEPTH_CHART_MARGIN.top}
                    x2={x}
                    y2={DEPTH_CHART_MARGIN.top + plotHeight()}
                    stroke="rgba(60, 68, 79, 0.45)"
                    stroke-width="1"
                  />
                  <text
                    x={x}
                    y={DEPTH_CHART_MARGIN.top + plotHeight() + 14}
                    fill="#95a2b2"
                    font-size="11"
                    text-anchor="middle"
                  >
                    ${formatPrice(tick)}
                  </text>
                </>
              );
            }}
          </For>

          <Show when={mid() != null}>
            <line
              x1={toX(mid() ?? 0)}
              y1={DEPTH_CHART_MARGIN.top}
              x2={toX(mid() ?? 0)}
              y2={DEPTH_CHART_MARGIN.top + plotHeight()}
              stroke="#485465"
              stroke-width="1"
              stroke-dasharray="3 4"
            />
          </Show>

          <Show when={bidPath()}>
            <path d={bidPath()} fill={`url(#${bidGradientId})`} stroke="#2ecfd0" stroke-width="2" />
          </Show>
          <Show when={askPath()}>
            <path d={askPath()} fill={`url(#${askGradientId})`} stroke="#ff606a" stroke-width="2" />
          </Show>

          <Show when={hoveredX() != null}>
            <line
              x1={hoveredX() ?? 0}
              y1={DEPTH_CHART_MARGIN.top}
              x2={hoveredX() ?? 0}
              y2={DEPTH_CHART_MARGIN.top + plotHeight()}
              stroke="#586476"
              stroke-width="1"
              stroke-dasharray="4 4"
            />
          </Show>
        </svg>
      </Show>

      <Show when={hoveredRow()}>
        {(row) => (
          <div class="pointer-events-none absolute right-2 top-2 rounded-[4px] border border-[#36404c] bg-[#151b24] px-2 py-1 text-[11px] text-[#d3dce7]">
            <div>{`Price: $${formatPrice(row().price)}`}</div>
            <Show when={row().bids != null}>
              <div>{`Bids: ${formatCompact(row().bids)}`}</div>
            </Show>
            <Show when={row().asks != null}>
              <div>{`Asks: ${formatCompact(row().asks)}`}</div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

function LongShortBar(props: {
  longPct: number | null | undefined;
  shortPct: number | null | undefined;
}) {
  const longValue = createMemo(() => Math.max(0, Math.min(100, Number(props.longPct ?? 0))));
  const shortValue = createMemo(() => Math.max(0, Math.min(100, Number(props.shortPct ?? 0))));

  return (
    <div class="mt-1 h-2 w-full overflow-hidden rounded-sm bg-[#202a36]">
      <div class="flex h-full w-full">
        <div class="bg-[#2ecfd0]" style={{ width: `${longValue()}%` }} />
        <div class="bg-[#ff606a]" style={{ width: `${shortValue()}%` }} />
      </div>
    </div>
  );
}

function RelativeStrengthPanel(props: RelativeStrengthPanelProps) {
  const clipPathId = `${createUniqueId()}-clip`;
  const { ref: setChartContainer, size: chartSize, element: chartElement } =
    createElementSize<HTMLDivElement>();

  const [hoveredRelativeRow, setHoveredRelativeRow] = createSignal<Record<string, number> | null>(
    null,
  );
  const [relativeZoomDomain, setRelativeZoomDomain] = createSignal<RelativeZoomDomain | null>(
    null,
  );
  const [relativePanActive, setRelativePanActive] = createSignal(false);
  const [relativeContextMenu, setRelativeContextMenu] = createSignal<RelativeContextMenu | null>(
    null,
  );
  const [relativeTimeframeMenuOpen, setRelativeTimeframeMenuOpen] = createSignal(false);

  let relativePanAnchor: RelativePanAnchor | null = null;
  let relativeContextMenuRef: HTMLDivElement | undefined;
  let relativeTimeframeDropdownRef: HTMLDivElement | undefined;

  const orderedRelativeTimeframes = createMemo(() => {
    const active = TIMEFRAMES.find((item) => item.key === props.timeframe);
    if (!active) return TIMEFRAMES;
    return [active, ...TIMEFRAMES.filter((item) => item.key !== props.timeframe)];
  });
  const relativeTimeframeLabel = createMemo(
    () => TIMEFRAMES.find((item) => item.key === props.timeframe)?.label ?? props.timeframe.toUpperCase(),
  );

  createEffect(() => {
    props.resetToken;
    props.timeframe;
    setHoveredRelativeRow(null);
    setRelativeZoomDomain(null);
    setRelativePanActive(false);
    setRelativeContextMenu(null);
    setRelativeTimeframeMenuOpen(false);
    relativePanAnchor = null;
  });

  createEffect(() => {
    if (!relativeTimeframeMenuOpen() && !relativeContextMenu()) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        relativeTimeframeDropdownRef &&
        !relativeTimeframeDropdownRef.contains(target)
      ) {
        setRelativeTimeframeMenuOpen(false);
      }
      if (relativeContextMenuRef && !relativeContextMenuRef.contains(target)) {
        setRelativeContextMenu(null);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRelativeContextMenu(null);
        setRelativeTimeframeMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  const chartWidth = createMemo(() => chartSize().width);
  const chartHeight = createMemo(() => chartSize().height);
  const plotWidth = createMemo(
    () => Math.max(0, chartWidth() - RELATIVE_CHART_MARGIN.left - RELATIVE_CHART_MARGIN.right),
  );
  const plotHeight = createMemo(
    () => Math.max(0, chartHeight() - RELATIVE_CHART_MARGIN.top - RELATIVE_CHART_MARGIN.bottom),
  );

  const relativeTimeBounds = createMemo(() => {
    if (!props.relative.chartRows.length) {
      return null;
    }

    const first = Number(props.relative.chartRows[0]?.time ?? Number.NaN);
    const last = Number(
      props.relative.chartRows[props.relative.chartRows.length - 1]?.time ?? Number.NaN,
    );
    if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
      return null;
    }

    const span = last - first;
    const averageStep = span / Math.max(1, props.relative.chartRows.length - 1);

    return {
      first,
      last,
      span,
      averageStep,
    };
  });

  createEffect(() => {
    const currentZoom = relativeZoomDomain();
    if (!currentZoom) return;

    const firstTime = Number(props.relative.chartRows[0]?.time ?? Number.NaN);
    const lastTime = Number(
      props.relative.chartRows[props.relative.chartRows.length - 1]?.time ?? Number.NaN,
    );
    if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime)) {
      setRelativeZoomDomain(null);
      return;
    }

    if (currentZoom.right < firstTime || currentZoom.left > lastTime) {
      setRelativeZoomDomain(null);
      return;
    }

    const nextLeft = Math.max(firstTime, currentZoom.left);
    const nextRight = Math.min(lastTime, currentZoom.right);
    if (nextRight <= nextLeft) {
      setRelativeZoomDomain(null);
      return;
    }

    if (nextLeft !== currentZoom.left || nextRight !== currentZoom.right) {
      setRelativeZoomDomain({
        ...currentZoom,
        left: nextLeft,
        right: nextRight,
      });
    }
  });

  createEffect(() => {
    if (!relativePanActive()) return;

    const onMouseMove = (event: MouseEvent) => {
      const anchor = relativePanAnchor;
      const bounds = relativeTimeBounds();
      if (!anchor || !bounds) return;

      const xSpan = anchor.domain.right - anchor.domain.left;
      const ySpan = anchor.domain.yMax - anchor.domain.yMin;
      if (xSpan <= 0 || ySpan <= 0) return;

      const nextPlotWidth = Math.max(1, plotWidth());
      const nextPlotHeight = Math.max(1, plotHeight());
      const deltaX = event.clientX - anchor.startX;
      const deltaY = event.clientY - anchor.startY;

      let nextLeft = anchor.domain.left - (deltaX / nextPlotWidth) * xSpan;
      let nextRight = anchor.domain.right - (deltaX / nextPlotWidth) * xSpan;
      let nextYMin = anchor.domain.yMin + (deltaY / nextPlotHeight) * ySpan;
      let nextYMax = anchor.domain.yMax + (deltaY / nextPlotHeight) * ySpan;

      if (nextLeft < bounds.first) {
        const offset = bounds.first - nextLeft;
        nextLeft += offset;
        nextRight += offset;
      }
      if (nextRight > bounds.last) {
        const offset = nextRight - bounds.last;
        nextLeft -= offset;
        nextRight -= offset;
      }

      if (nextYMin < RELATIVE_Y_MIN) {
        const offset = RELATIVE_Y_MIN - nextYMin;
        nextYMin += offset;
        nextYMax += offset;
      }
      if (nextYMax > RELATIVE_Y_MAX) {
        const offset = nextYMax - RELATIVE_Y_MAX;
        nextYMin -= offset;
        nextYMax -= offset;
      }

      setRelativeZoomDomain({
        left: clampNumber(nextLeft, bounds.first, bounds.last),
        right: clampNumber(nextRight, bounds.first, bounds.last),
        yMin: clampNumber(nextYMin, RELATIVE_Y_MIN, RELATIVE_Y_MAX),
        yMax: clampNumber(nextYMax, RELATIVE_Y_MIN, RELATIVE_Y_MAX),
      });
    };

    const stopPanning = () => {
      relativePanAnchor = null;
      setRelativePanActive(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopPanning);
    window.addEventListener("blur", stopPanning);

    onCleanup(() => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopPanning);
      window.removeEventListener("blur", stopPanning);
    });
  });

  const applyRelativeZoom = (
    direction: number,
    options: {
      xRatio?: number;
      yRatio?: number;
      deltaScale?: number;
    } = {},
  ) => {
    const bounds = relativeTimeBounds();
    if (!bounds || direction === 0) return;

    const { xRatio = 0.5, yRatio = 0.5, deltaScale = 1 } = options;
    const currentZoom = relativeZoomDomain();
    const currentLeft = currentZoom?.left ?? bounds.first;
    const currentRight = currentZoom?.right ?? bounds.last;
    const currentYMin = currentZoom?.yMin ?? RELATIVE_Y_MIN;
    const currentYMax = currentZoom?.yMax ?? RELATIVE_Y_MAX;

    const xSpan = currentRight - currentLeft;
    const ySpan = currentYMax - currentYMin;
    if (xSpan <= 0 || ySpan <= 0) return;

    const zoomStep =
      RELATIVE_ZOOM_BASE_STEP *
      clampNumber(deltaScale, RELATIVE_ZOOM_MIN_DELTA_SCALE, 1);
    const zoomFactor = direction < 0 ? 1 - zoomStep : 1 + zoomStep;

    const minXSpan = Math.max(
      RELATIVE_ZOOM_MIN_POINTS * bounds.averageStep,
      bounds.averageStep,
    );
    const nextXSpan = clampNumber(xSpan * zoomFactor, minXSpan, bounds.span);
    const anchorX = currentLeft + xSpan * xRatio;
    let nextLeft = anchorX - nextXSpan * xRatio;
    let nextRight = nextLeft + nextXSpan;

    if (nextLeft < bounds.first) {
      const delta = bounds.first - nextLeft;
      nextLeft += delta;
      nextRight += delta;
    }
    if (nextRight > bounds.last) {
      const delta = nextRight - bounds.last;
      nextLeft -= delta;
      nextRight -= delta;
    }

    const fullYSpan = RELATIVE_Y_MAX - RELATIVE_Y_MIN;
    const nextYSpan = clampNumber(ySpan * zoomFactor, RELATIVE_ZOOM_MIN_Y_SPAN, fullYSpan);
    const anchorY = currentYMax - ySpan * yRatio;
    let nextYMin = anchorY - nextYSpan * (1 - yRatio);
    let nextYMax = anchorY + nextYSpan * yRatio;

    if (nextYMin < RELATIVE_Y_MIN) {
      const delta = RELATIVE_Y_MIN - nextYMin;
      nextYMin += delta;
      nextYMax += delta;
    }
    if (nextYMax > RELATIVE_Y_MAX) {
      const delta = nextYMax - RELATIVE_Y_MAX;
      nextYMin -= delta;
      nextYMax -= delta;
    }

    const isFullX =
      Math.abs(nextLeft - bounds.first) <= 1 &&
      Math.abs(nextRight - bounds.last) <= 1;
    const isFullY =
      Math.abs(nextYMin - RELATIVE_Y_MIN) <= 0.001 &&
      Math.abs(nextYMax - RELATIVE_Y_MAX) <= 0.001;

    if (isFullX && isFullY) {
      setRelativeZoomDomain(null);
      return;
    }

    setRelativeZoomDomain({
      left: clampNumber(nextLeft, bounds.first, bounds.last),
      right: clampNumber(nextRight, bounds.first, bounds.last),
      yMin: clampNumber(nextYMin, RELATIVE_Y_MIN, RELATIVE_Y_MAX),
      yMax: clampNumber(nextYMax, RELATIVE_Y_MIN, RELATIVE_Y_MAX),
    });
  };

  createEffect(() => {
    const element = chartElement();
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (relativePanActive()) return;
      const bounds = relativeTimeBounds();
      if (!bounds) return;

      const wheelDelta = Number(event.deltaY ?? 0);
      const direction = Math.sign(wheelDelta);
      if (direction === 0) return;

      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();

      if (relativeContextMenu()) {
        setRelativeContextMenu(null);
      }

      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left - RELATIVE_CHART_MARGIN.left;
      const pointerY = event.clientY - rect.top - RELATIVE_CHART_MARGIN.top;
      const xRatio = clampNumber(pointerX / Math.max(1, plotWidth()), 0, 1);
      const yRatio = clampNumber(pointerY / Math.max(1, plotHeight()), 0, 1);
      const deltaScale = clampNumber(
        Math.abs(wheelDelta) / RELATIVE_ZOOM_DELTA_NORMALIZER,
        RELATIVE_ZOOM_MIN_DELTA_SCALE,
        1,
      );

      applyRelativeZoom(direction, { xRatio, yRatio, deltaScale });
    };

    const blockGestureZoom = (event: Event) => {
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("gesturestart", blockGestureZoom, { passive: false });
    element.addEventListener("gesturechange", blockGestureZoom, { passive: false });
    element.addEventListener("gestureend", blockGestureZoom, { passive: false });

    onCleanup(() => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("gesturestart", blockGestureZoom);
      element.removeEventListener("gesturechange", blockGestureZoom);
      element.removeEventListener("gestureend", blockGestureZoom);
    });
  });

  const selectedStrengthKey = createMemo(() =>
    props.relative.symbols.includes(props.assetRelativeStrengthKey)
      ? props.assetRelativeStrengthKey
      : props.relative.symbols[0] ?? null,
  );
  const latestRelativeRow = createMemo(
    () => props.relative.chartRows[props.relative.chartRows.length - 1] ?? null,
  );
  const activeRelativeRow = createMemo(() => hoveredRelativeRow() ?? latestRelativeRow());
  const visibleRelativeChangeBySymbol = createMemo(() => {
    const activeRow = activeRelativeRow();
    const out: Record<string, number | null> = {};
    for (const symbol of props.relative.symbols) {
      const value = activeRow?.[symbol];
      out[symbol] =
        typeof value === "number" && Number.isFinite(value)
          ? value
          : props.relative.changeBySymbol[symbol] ?? null;
    }
    return out;
  });
  const splitIndex = createMemo(() => Math.ceil(props.relative.symbols.length / 2));
  const leftRelativeSymbols = createMemo(() => props.relative.symbols.slice(0, splitIndex()));
  const rightRelativeSymbols = createMemo(() => props.relative.symbols.slice(splitIndex()));
  const selectedRelativeValue = createMemo(() => {
    const key = selectedStrengthKey();
    return key != null ? activeRelativeRow()?.[key] ?? null : null;
  });
  const visibleRelativeYMin = createMemo(
    () => relativeZoomDomain()?.yMin ?? RELATIVE_Y_MIN,
  );
  const visibleRelativeYMax = createMemo(
    () => relativeZoomDomain()?.yMax ?? RELATIVE_Y_MAX,
  );
  const selectedRelativeTopPct = createMemo(() => {
    const value = selectedRelativeValue();
    if (
      value == null ||
      !Number.isFinite(value) ||
      visibleRelativeYMax() <= visibleRelativeYMin()
    ) {
      return 50;
    }

    const normalized =
      (value - visibleRelativeYMin()) /
      (visibleRelativeYMax() - visibleRelativeYMin());
    return Math.max(2, Math.min(98, (1 - normalized) * 100));
  });

  const relativeXTicks = createMemo(() => {
    if (!props.relative.chartRows.length) return [] as number[];
    const firstTime = Number(props.relative.chartRows[0]?.time ?? Number.NaN);
    const lastTime = Number(
      props.relative.chartRows[props.relative.chartRows.length - 1]?.time ?? Number.NaN,
    );
    if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime) || lastTime <= firstTime) {
      return [] as number[];
    }

    const tickStep = RELATIVE_TICK_STEP_BY_TIMEFRAME[props.timeframe];
    const alignedStart = Math.ceil(firstTime / tickStep) * tickStep;
    const ticks: number[] = [];
    for (let tick = alignedStart; tick <= lastTime; tick += tickStep) {
      ticks.push(tick);
    }
    return ticks;
  });

  const xDomain = createMemo(() => {
    const zoom = relativeZoomDomain();
    const bounds = relativeTimeBounds();
    return {
      left: zoom?.left ?? bounds?.first ?? 0,
      right: zoom?.right ?? bounds?.last ?? 1,
    };
  });
  const yDomain = createMemo(() => ({
    min: visibleRelativeYMin(),
    max: visibleRelativeYMax(),
  }));
  const xSpan = createMemo(() => Math.max(1, xDomain().right - xDomain().left));
  const ySpan = createMemo(() => Math.max(1, yDomain().max - yDomain().min));

  const relativeXAxisTicks = createMemo(() =>
    relativeZoomDomain()
      ? generateNumericTicks(xDomain().left, xDomain().right, 5)
      : relativeXTicks(),
  );
  const relativeYAxisTicks = createMemo(() =>
    relativeZoomDomain()
      ? generateNumericTicks(yDomain().min, yDomain().max, 6)
      : RELATIVE_Y_TICKS,
  );

  const toX = (time: number) =>
    RELATIVE_CHART_MARGIN.left + ((time - xDomain().left) / xSpan()) * plotWidth();
  const toY = (value: number) =>
    RELATIVE_CHART_MARGIN.top + (1 - (value - yDomain().min) / ySpan()) * plotHeight();

  const hoveredRowMeta = createMemo(() => {
    const row = activeRelativeRow();
    if (!row) return null;
    const time = Number(row.time ?? Number.NaN);
    if (!Number.isFinite(time)) return null;
    return {
      row,
      time,
      x: toX(time),
    };
  });

  const relativeContextMenuPosition = createMemo(() => {
    const menu = relativeContextMenu();
    if (!menu) return null;
    return {
      left: clampNumber(menu.x, 8, Math.max(8, chartWidth() - 158)),
      top: clampNumber(menu.y, 8, Math.max(8, chartHeight() - 44)),
    };
  });

  const canZoomRelative = createMemo(() => Boolean(relativeTimeBounds()));
  const canResetRelativeZoom = createMemo(() => Boolean(relativeZoomDomain()));

  const buildPathForSymbol = (symbol: string) => {
    const points = props.relative.chartRows
      .map((row) => {
        const time = Number(row.time ?? Number.NaN);
        const value = Number(row[symbol] ?? Number.NaN);
        if (!Number.isFinite(time) || !Number.isFinite(value)) return null;
        return {
          x: toX(time),
          y: toY(value),
        };
      })
      .filter((point): point is ChartPoint => point != null);
    return buildLinePath(points);
  };

  const handleChartMouseMove = (event: MouseEvent) => {
    if (relativePanActive()) return;
    const rows = props.relative.chartRows;
    if (!rows.length) {
      setHoveredRelativeRow(null);
      return;
    }

    const currentTarget = event.currentTarget as HTMLDivElement;
    const rect = currentTarget.getBoundingClientRect();
    const pointerX = clampNumber(
      event.clientX - rect.left - RELATIVE_CHART_MARGIN.left,
      0,
      plotWidth(),
    );
    const targetTime = xDomain().left + (pointerX / Math.max(1, plotWidth())) * xSpan();
    const index = findNearestIndex(rows, targetTime, (row) => Number(row.time));
    setHoveredRelativeRow(index >= 0 ? rows[index] : null);
  };

  const renderRelativeRow = (symbol: string) => {
    const change = () => visibleRelativeChangeBySymbol()[symbol];
    const active = () => symbol === selectedStrengthKey();

    return (
      <div
        class={cn(
          "flex items-center justify-between rounded-sm px-0.5 py-[1px] font-mono",
          active() ? "bg-[#242d38] text-[#dfe6ef]" : "text-[#9daab9]",
        )}
      >
        <span>{symbol.replace("/USD", "")}</span>
        <span class={cn("ml-1", (change() ?? 0) >= 0 ? "text-[#2ecfd0]" : "text-[#ff606a]")}>
          {formatPercent(change())}
        </span>
      </div>
    );
  };

  return (
    <Card class="asset-panel asset-panel-relative flex min-h-0 flex-col overflow-hidden">
      <CardHeader class="px-2.5 pb-2 pt-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <CardTitle class="flex items-center gap-2 text-sm uppercase tracking-[0.14em] text-[#a1afbe]">
            <ActivityIcon class="h-3.5 w-3.5 text-[#2ecfd0]" />
            Relative Strength
          </CardTitle>

          <div class="flex flex-wrap items-center gap-2">
            <div
              ref={relativeTimeframeDropdownRef}
              class="asset-inline-dropdown asset-inline-market"
            >
              <button
                type="button"
                class="asset-inline-trigger asset-inline-trigger-market"
                onClick={() => setRelativeTimeframeMenuOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={relativeTimeframeMenuOpen()}
              >
                <span class="asset-inline-text-sub">Relative · {relativeTimeframeLabel()}</span>
                <ChevronDownIcon
                  class={cn(
                    "h-4 w-4 text-[#9ab0c7] transition-transform",
                    relativeTimeframeMenuOpen() ? "rotate-180" : "",
                  )}
                />
              </button>

              <Show when={relativeTimeframeMenuOpen()}>
                <div class="asset-inline-menu asset-market-menu">
                  <For each={orderedRelativeTimeframes()}>
                    {(item) => (
                      <button
                        type="button"
                        class={cn(
                          "asset-market-option",
                          item.key === props.timeframe ? "active" : undefined,
                        )}
                        onClick={() => {
                          props.onTimeframeChange(item.key);
                          setRelativeTimeframeMenuOpen(false);
                          setRelativeContextMenu(null);
                          setHoveredRelativeRow(null);
                          setRelativePanActive(false);
                          setRelativeZoomDomain(null);
                          relativePanAnchor = null;
                        }}
                      >
                        Relative · {item.label}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div class="flex items-center gap-1">
              <button
                type="button"
                aria-label="Zoom out relative strength"
                disabled={!canResetRelativeZoom()}
                class={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded border border-[#2b3f54] bg-[#111a27] text-[#9ab0c7] transition-colors",
                  canResetRelativeZoom()
                    ? "hover:bg-[#1a2430] hover:text-[#d8e1ec]"
                    : "cursor-not-allowed opacity-40",
                )}
                onClick={() => {
                  setRelativeContextMenu(null);
                  setHoveredRelativeRow(null);
                  applyRelativeZoom(1);
                }}
              >
                <MinusIcon class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Zoom in relative strength"
                disabled={!canZoomRelative()}
                class={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded border border-[#2b3f54] bg-[#111a27] text-[#9ab0c7] transition-colors",
                  canZoomRelative()
                    ? "hover:bg-[#1a2430] hover:text-[#d8e1ec]"
                    : "cursor-not-allowed opacity-40",
                )}
                onClick={() => {
                  setRelativeContextMenu(null);
                  setHoveredRelativeRow(null);
                  applyRelativeZoom(-1);
                }}
              >
                <PlusIcon class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent class="relative h-full min-h-[260px] p-0">
        <div
          ref={setChartContainer}
          class={cn(
            "absolute inset-0 select-none overscroll-contain",
            relativeZoomDomain() ? (relativePanActive() ? "cursor-grabbing" : "cursor-grab") : undefined,
          )}
          onMouseDown={(event) => {
            if (event.button !== 0 || !relativeZoomDomain() || !relativeTimeBounds()) return;
            event.preventDefault();
            setRelativeContextMenu(null);
            setHoveredRelativeRow(null);
            relativePanAnchor = {
              startX: event.clientX,
              startY: event.clientY,
              domain: relativeZoomDomain() as RelativeZoomDomain,
            };
            setRelativePanActive(true);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setRelativePanActive(false);
            relativePanAnchor = null;
            const element = chartElement();
            if (!element) return;
            const rect = element.getBoundingClientRect();
            setRelativeContextMenu({
              x: clampNumber(event.clientX - rect.left, 0, rect.width),
              y: clampNumber(event.clientY - rect.top, 0, rect.height),
            });
          }}
          onMouseMove={handleChartMouseMove}
          onMouseLeave={() => setHoveredRelativeRow(null)}
        >
          <Show when={chartWidth() > 0 && chartHeight() > 0}>
            <svg class="h-full w-full" viewBox={`0 0 ${chartWidth()} ${chartHeight()}`}>
              <defs>
                <clipPath id={clipPathId}>
                  <rect
                    x={RELATIVE_CHART_MARGIN.left}
                    y={RELATIVE_CHART_MARGIN.top}
                    width={plotWidth()}
                    height={plotHeight()}
                  />
                </clipPath>
              </defs>

              <For each={relativeYAxisTicks()}>
                {(tick) => {
                  const y = toY(tick);
                  return (
                    <>
                      <line
                        x1={RELATIVE_CHART_MARGIN.left}
                        y1={y}
                        x2={RELATIVE_CHART_MARGIN.left + plotWidth()}
                        y2={y}
                        stroke="rgba(60, 68, 79, 0.45)"
                        stroke-width="1"
                      />
                      <text
                        x={chartWidth() - 2}
                        y={y + 4}
                        fill="#95a2b2"
                        font-size="11"
                        text-anchor="end"
                      >
                        {formatPercent(tick)}
                      </text>
                    </>
                  );
                }}
              </For>

              <For each={relativeXAxisTicks()}>
                {(tick) => {
                  const x = toX(tick);
                  return (
                    <>
                      <line
                        x1={x}
                        y1={RELATIVE_CHART_MARGIN.top}
                        x2={x}
                        y2={RELATIVE_CHART_MARGIN.top + plotHeight()}
                        stroke="rgba(60, 68, 79, 0.45)"
                        stroke-width="1"
                      />
                      <text
                        x={x}
                        y={chartHeight() - 2}
                        fill="#95a2b2"
                        font-size="11"
                        text-anchor="middle"
                      >
                        {formatRelativeTick(Number(tick), props.timeframe)}
                      </text>
                    </>
                  );
                }}
              </For>

              <Show when={hoveredRowMeta()}>
                {(meta) => (
                  <line
                    x1={meta().x}
                    y1={RELATIVE_CHART_MARGIN.top}
                    x2={meta().x}
                    y2={RELATIVE_CHART_MARGIN.top + plotHeight()}
                    stroke="#586476"
                    stroke-width="1"
                    stroke-dasharray="4 4"
                  />
                )}
              </Show>

              <g clip-path={`url(#${clipPathId})`}>
                <For each={props.relative.symbols}>
                  {(symbol, index) => {
                    const isActive = () => symbol === selectedStrengthKey();
                    const stroke = () => {
                      if (isActive()) return "#2ecfd0";
                      const hue = (index() * 19) % 360;
                      return `hsla(${hue}, 70%, 62%, 0.35)`;
                    };
                    const path = createMemo(() => buildPathForSymbol(symbol));
                    return (
                      <Show when={path()}>
                        <path
                          d={path()}
                          fill="none"
                          stroke={stroke()}
                          stroke-width={isActive() ? "2.5" : "1"}
                        />
                      </Show>
                    );
                  }}
                </For>

                <Show when={hoveredRowMeta()}>
                  {(meta) => (
                    <Show when={selectedStrengthKey()}>
                      {(activeSymbol) => {
                        const value = () =>
                          Number(meta().row[activeSymbol()] ?? Number.NaN);
                        return (
                          <Show when={Number.isFinite(value())}>
                            <circle
                              cx={meta().x}
                              cy={toY(value())}
                              r="3.5"
                              fill="#2ecfd0"
                              stroke="#9fb9c9"
                              stroke-width="1"
                            />
                          </Show>
                        );
                      }}
                    </Show>
                  )}
                </Show>
              </g>
            </svg>
          </Show>
        </div>

        <Show when={selectedStrengthKey() && selectedRelativeValue() != null}>
          <div
            class="pointer-events-none absolute right-0 z-20 -translate-y-1/2 rounded-sm bg-[#2c3745] px-1.5 py-[1px] font-mono text-[9px] font-medium text-[#e3eaf2]"
            style={{ top: `${selectedRelativeTopPct()}%` }}
          >
            {selectedStrengthKey()?.replace("/USD", "")} {formatPercent(selectedRelativeValue())}
          </div>
        </Show>

        <div class="pointer-events-none absolute left-0 top-0 z-10 w-[176px] overflow-hidden bg-[#11161dbf] p-1.5 sm:w-[188px]">
          <div class="grid grid-cols-2 gap-x-1.5 pr-0.5 text-[7px] leading-[1.1] sm:text-[9px]">
            <div class="space-y-[2px]">
              <For each={leftRelativeSymbols()}>{renderRelativeRow}</For>
            </div>
            <div class="space-y-[2px]">
              <For each={rightRelativeSymbols()}>{renderRelativeRow}</For>
            </div>
          </div>
        </div>

        <Show when={relativeContextMenuPosition()}>
          {(position) => (
            <div
              ref={relativeContextMenuRef}
              class="absolute z-30 min-w-[148px] rounded-md border border-[#303b49] bg-[#111821f2] p-1 shadow-[0_8px_20px_rgba(0,0,0,0.35)]"
              style={{
                left: `${position().left}px`,
                top: `${position().top}px`,
              }}
            >
              <button
                type="button"
                disabled={!relativeZoomDomain()}
                class={cn(
                  "w-full rounded px-2 py-1 text-left text-[10px] uppercase tracking-[0.14em]",
                  relativeZoomDomain()
                    ? "text-[#d9e3ed] hover:bg-[#1f2b3a]"
                    : "cursor-not-allowed text-[#6d7c8d]",
                )}
                onClick={() => {
                  relativePanAnchor = null;
                  setRelativePanActive(false);
                  setHoveredRelativeRow(null);
                  setRelativeZoomDomain(null);
                  setRelativeContextMenu(null);
                }}
              >
                Reset to default
              </button>
            </div>
          )}
        </Show>
      </CardContent>
    </Card>
  );
}

export function AssetDashboard() {
  const location = useLocation();

  const [assetPair, setAssetPair] = createSignal(
    toAssetContext(
      new URLSearchParams(
        typeof window === "undefined" ? "" : window.location.search,
      ).get("asset") ?? undefined,
    ).pair,
  );
  const [timeframe, setTimeframe] = createSignal<Timeframe>("1h");
  const [relativeTimeframe, setRelativeTimeframe] =
    createSignal<Timeframe>(DEFAULT_RELATIVE_TIMEFRAME);
  const [candles, setCandles] = createSignal<Candle[]>([]);
  const [ratios, setRatios] = createSignal<RatiosResponse | null>(null);
  const [openInterest, setOpenInterest] = createSignal<OpenInterestResponse | null>(null);
  const [depth, setDepth] = createSignal<DepthResponse | null>(null);
  const [assetHeader, setAssetHeader] = createSignal<AssetHeaderResponse | null>(null);
  const [relativeStrength, setRelativeStrength] = createSignal<RelativeStrengthResponse | null>(
    null,
  );
  const [relativeDefaultSymbols, setRelativeDefaultSymbols] = createSignal<string[]>(
    readRelativeStrengthDefaultsFromStorage(),
  );
  const [error, setError] = createSignal<string | null>(null);
  const [symbolMenuOpen, setSymbolMenuOpen] = createSignal(false);
  const [timeframeMenuOpen, setTimeframeMenuOpen] = createSignal(false);
  const [symbolSearch, setSymbolSearch] = createSignal("");

  let symbolDropdownRef: HTMLDivElement | undefined;
  let timeframeDropdownRef: HTMLDivElement | undefined;
  let symbolSearchInputRef: HTMLInputElement | undefined;

  const asset = createMemo(() => toAssetContext(assetPair()));
  const isDocumentHidden = () =>
    typeof document !== "undefined" && document.visibilityState === "hidden";

  onMount(() => {
    const syncRelativeDefaults = () => {
      setRelativeDefaultSymbols(readRelativeStrengthDefaultsFromStorage());
    };

    syncRelativeDefaults();
    window.addEventListener("storage", syncRelativeDefaults);
    onCleanup(() => {
      window.removeEventListener("storage", syncRelativeDefaults);
    });
  });

  createEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextPair = toAssetContext(params.get("asset") ?? undefined).pair;
    if (assetPair() !== nextPair) {
      setAssetPair(nextPair);
    }
  });

  createEffect(() => {
    if (!symbolMenuOpen()) {
      setSymbolSearch("");
      return;
    }

    queueMicrotask(() => {
      symbolSearchInputRef?.focus();
    });
  });

  createEffect(() => {
    const symbolOpen = symbolMenuOpen();
    const timeframeOpen = timeframeMenuOpen();
    if (!symbolOpen && !timeframeOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (symbolDropdownRef && !symbolDropdownRef.contains(target)) {
        setSymbolMenuOpen(false);
      }
      if (timeframeDropdownRef && !timeframeDropdownRef.contains(target)) {
        setTimeframeMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointerDown);
    });
  });

  createEffect(() => {
    const apiSymbol = asset().apiSymbol;
    const currentTimeframe = timeframe();
    let cancelled = false;

    const loadCandles = async () => {
      if (isDocumentHidden()) return;
      try {
        const payload = await fetchJson<KlineResponse>(
          `/api/klines/${encodeURIComponent(apiSymbol)}?interval=${currentTimeframe}&limit=220`,
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
    };

    void loadCandles();
    const intervalId = window.setInterval(loadCandles, 25_000);
    onCleanup(() => {
      cancelled = true;
      window.clearInterval(intervalId);
    });
  });

  createEffect(() => {
    const apiSymbol = asset().apiSymbol;
    let cancelled = false;

    const loadOverview = async () => {
      if (isDocumentHidden()) return;
      try {
        const payload = await fetchJson<AssetOverviewResponse>(
          `/api/asset-overview/${encodeURIComponent(apiSymbol)}`,
        );
        if (!cancelled) {
          setAssetHeader(payload.assetHeader);
          setRatios(payload.ratios);
          setOpenInterest(payload.openInterest);
          setError(null);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load overview");
        }
      }
    };

    void loadOverview();
    const intervalId = window.setInterval(loadOverview, 5000);
    onCleanup(() => {
      cancelled = true;
      window.clearInterval(intervalId);
    });
  });

  createEffect(() => {
    const apiSymbol = asset().apiSymbol;
    let cancelled = false;

    const loadDepth = async () => {
      if (isDocumentHidden()) return;
      try {
        const payload = await fetchJson<DepthResponse>(
          `/api/depth/${encodeURIComponent(apiSymbol)}`,
        );
        if (!cancelled) {
          setDepth(payload);
        }
      } catch {
        // Keep prior depth on transient failures.
      }
    };

    void loadDepth();
    const intervalId = window.setInterval(loadDepth, 1000);
    onCleanup(() => {
      cancelled = true;
      window.clearInterval(intervalId);
    });
  });

  createEffect(() => {
    const currentRelativeTimeframe = relativeTimeframe();
    let cancelled = false;

    const loadRelativeStrength = async () => {
      if (isDocumentHidden()) return;
      try {
        const payload = await fetchJson<RelativeStrengthResponse>(
          `/api/market/relative-strength?interval=${encodeURIComponent(currentRelativeTimeframe)}`,
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
    };

    void loadRelativeStrength();
    const intervalId = window.setInterval(loadRelativeStrength, 60_000);
    onCleanup(() => {
      cancelled = true;
      window.clearInterval(intervalId);
    });
  });

  const orderedTimeframes = createMemo(() => {
    const active = TIMEFRAMES.find((item) => item.key === timeframe());
    if (!active) return TIMEFRAMES;
    return [active, ...TIMEFRAMES.filter((item) => item.key !== timeframe())];
  });
  const timeframeLabel = createMemo(
    () => TIMEFRAMES.find((item) => item.key === timeframe())?.label ?? timeframe().toUpperCase(),
  );

  const relative = createMemo(() =>
    toRelativeStrengthData(
      relativeStrength(),
      asset().relativeStrengthKey,
      relativeDefaultSymbols(),
    ),
  );

  const lastCandle = createMemo(() => candles()[candles().length - 1]);
  const prevCandle = createMemo(() => candles()[candles().length - 2]);
  const lastPrice = createMemo(() => lastCandle()?.close ?? null);
  const lastVolume = createMemo(() => lastCandle()?.volume ?? null);
  const changePct = createMemo(() => {
    const current = lastCandle();
    const previous = prevCandle();
    return current && previous
      ? ((current.close - previous.close) / previous.close) * 100
      : null;
  });
  const headerLast = createMemo(() => assetHeader()?.last ?? lastPrice());
  const headerChangePct = createMemo(() => assetHeader()?.changePct ?? changePct());
  const headerVolume = createMemo(() => assetHeader()?.volume24h ?? lastVolume());
  const headerOpenInterest = createMemo(
    () =>
      assetHeader()?.openInterestUsd ??
      (openInterest()?.total.long_pct ?? 0) + (openInterest()?.total.short_pct ?? 0),
  );

  const assetPairOptions = createMemo(() => {
    const options = new Set<string>(DEFAULT_ASSET_PAIRS);
    options.add(asset().pair);
    for (const symbol of relative().symbols) {
      const normalized = normalizeRelativeStrengthSymbol(symbol);
      if (!normalized) continue;
      const base = normalized.replace("/USD", "");
      if (!DEFAULT_RELATIVE_STRENGTH_BASE_SET.has(base)) continue;
      options.add(toAssetContext(normalized).pair);
    }
    const sorted = Array.from(options).sort((a, b) => a.localeCompare(b));
    return [asset().pair, ...sorted.filter((pair) => pair !== asset().pair)];
  });
  const filteredAssetPairOptions = createMemo(() => {
    const query = symbolSearch().trim().toUpperCase().replace(/\s+/g, "");
    if (!query) return assetPairOptions().slice(0, 50);
    return assetPairOptions()
      .filter((pair) => {
        const symbol = pair.toUpperCase();
        return symbol.includes(query) || symbol.replace("/", "").includes(query);
      })
      .slice(0, 50);
  });

  const bullish = createMemo(
    () => (ratios()?.long_pct ?? 0) >= (ratios()?.short_pct ?? 0),
  );

  const handleAssetPairChange = (nextPair: string) => {
    const normalized = toAssetContext(nextPair).pair;
    setAssetPair((prev) => (prev === normalized ? prev : normalized));
    setError(null);
    setSymbolSearch("");
    setSymbolMenuOpen(false);
  };

  return (
    <div class="asset-page-content">
      <div class="asset-grid grid h-full min-h-0 gap-2">
        <Card class="asset-panel flex min-h-0 flex-col overflow-hidden">
          <CardHeader class="px-2.5 pb-2 pt-2.5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="asset-header-controls flex min-w-0 items-center gap-3">
                <div
                  ref={symbolDropdownRef}
                  class="asset-inline-dropdown asset-inline-symbol"
                >
                  <button
                    type="button"
                    class="asset-inline-trigger asset-inline-trigger-symbol"
                    onClick={() => {
                      setSymbolMenuOpen((prev) => {
                        const next = !prev;
                        if (next) {
                          setTimeframeMenuOpen(false);
                        }
                        return next;
                      });
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={symbolMenuOpen()}
                  >
                    <span class="asset-inline-text-main">{asset().pair}</span>
                    <ChevronDownIcon
                      class={cn(
                        "h-4 w-4 text-[#9ab0c7] transition-transform",
                        symbolMenuOpen() ? "rotate-180" : "",
                      )}
                    />
                  </button>

                  <Show when={symbolMenuOpen()}>
                    <div class="asset-inline-menu asset-symbol-menu">
                      <div class="asset-symbol-search-wrap">
                        <SearchIcon class="asset-symbol-search-icon h-3.5 w-3.5" />
                        <input
                          ref={symbolSearchInputRef}
                          type="search"
                          value={symbolSearch()}
                          onInput={(event) => setSymbolSearch(event.currentTarget.value)}
                          placeholder="Search symbol"
                          class="asset-symbol-search"
                        />
                      </div>
                      <div class="asset-symbol-list" role="listbox" aria-label="Asset symbol">
                        <Show
                          when={filteredAssetPairOptions().length}
                          fallback={<div class="asset-symbol-empty">No symbols found</div>}
                        >
                          <For each={filteredAssetPairOptions()}>
                            {(pair) => (
                              <button
                                type="button"
                                class={cn(
                                  "asset-symbol-option",
                                  pair === asset().pair ? "active" : undefined,
                                )}
                                onClick={() => handleAssetPairChange(pair)}
                              >
                                {pair}
                              </button>
                            )}
                          </For>
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>

                <div
                  ref={timeframeDropdownRef}
                  class="asset-inline-dropdown asset-inline-market"
                >
                  <button
                    type="button"
                    class="asset-inline-trigger asset-inline-trigger-market"
                    onClick={() => {
                      setTimeframeMenuOpen((prev) => {
                        const next = !prev;
                        if (next) {
                          setSymbolMenuOpen(false);
                        }
                        return next;
                      });
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={timeframeMenuOpen()}
                  >
                    <span class="asset-inline-text-sub">Perpetual · {timeframeLabel()}</span>
                    <ChevronDownIcon
                      class={cn(
                        "h-4 w-4 text-[#9ab0c7] transition-transform",
                        timeframeMenuOpen() ? "rotate-180" : "",
                      )}
                    />
                  </button>

                  <Show when={timeframeMenuOpen()}>
                    <div class="asset-inline-menu asset-market-menu">
                      <For each={orderedTimeframes()}>
                        {(item) => (
                          <button
                            type="button"
                            class={cn(
                              "asset-market-option",
                              item.key === timeframe() ? "active" : undefined,
                            )}
                            onClick={() => {
                              setTimeframe(item.key);
                              setTimeframeMenuOpen(false);
                            }}
                          >
                            Perpetual · {item.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>

              <div class="flex items-center gap-4 text-[10px] uppercase tracking-wide text-[#90a0b3]">
                <div>
                  <div>Last</div>
                  <div class="font-mono text-[9px] text-[#ecf2f9] sm:text-[11px]">
                    ${formatPrice(headerLast())}
                  </div>
                </div>
                <div>
                  <div>Change</div>
                  <div
                    class={cn(
                      "font-mono text-[9px] sm:text-[11px]",
                      (headerChangePct() ?? 0) >= 0 ? "text-[#2ecfd0]" : "text-[#ff606a]",
                    )}
                  >
                    {formatPercent(headerChangePct())}
                  </div>
                </div>
                <div>
                  <div>Volume</div>
                  <div class="font-mono text-[9px] text-[#ecf2f9] sm:text-[11px]">
                    ${formatCompact(headerVolume())}
                  </div>
                </div>
                <div>
                  <div>Open Interest</div>
                  <div class="font-mono text-[9px] text-[#ecf2f9] sm:text-[11px]">
                    {formatCompact(headerOpenInterest())}
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent class="h-full p-0">
            <CandlestickView candles={candles()} />
          </CardContent>
        </Card>

        <Card class="asset-panel flex min-h-0 flex-col overflow-hidden">
          <CardHeader class="px-2.5 pb-2 pt-2.5">
            <CardTitle class="flex items-center justify-between text-sm uppercase tracking-[0.14em] text-[#a1afbe]">
              <span>Orderbook Depth</span>
              <Badge variant={bullish() ? "positive" : "negative"}>
                {bullish() ? "Bid Bias" : "Ask Bias"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent class="h-full min-h-[220px] p-0 pr-2">
            <DepthChartView depth={depth()} />
          </CardContent>
        </Card>

        <RelativeStrengthPanel
          relative={relative()}
          assetRelativeStrengthKey={asset().relativeStrengthKey}
          timeframe={relativeTimeframe()}
          onTimeframeChange={setRelativeTimeframe}
          resetToken={asset().pair}
        />

        <Card class="asset-panel asset-panel-stats flex min-h-0 flex-col overflow-hidden">
          <CardHeader class="px-2.5 pb-2 pt-2.5">
            <div class="flex items-center justify-between">
              <CardTitle class="text-sm uppercase tracking-[0.14em] text-[#a1afbe]">
                Sentiment
              </CardTitle>
              <Badge variant={bullish() ? "positive" : "negative"}>
                {bullish() ? "Bullish" : "Bearish"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent class="flex h-full flex-col gap-5 p-4 pt-2">
            <section>
              <div class="mb-1 text-xs uppercase tracking-[0.16em] text-[#8f9dac]">
                Long vs Short
              </div>
              <div class="mb-1 flex items-center justify-between font-mono text-base">
                <div class="text-[#2ecfd0]">{(ratios()?.long_pct ?? 0).toFixed(1)}% Long</div>
                <div class="text-[#ff606a]">{(ratios()?.short_pct ?? 0).toFixed(1)}% Short</div>
              </div>
              <LongShortBar longPct={ratios()?.long_pct} shortPct={ratios()?.short_pct} />
            </section>

            <section class="space-y-4">
              <div class="text-xs uppercase tracking-[0.16em] text-[#8f9dac]">
                Open Interest
              </div>

              <div>
                <div class="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-[#90a0b3]">
                  <span>Evaluation</span>
                  <span>
                    {(openInterest()?.evaluation.long_pct ?? 0).toFixed(1)} /{" "}
                    {(openInterest()?.evaluation.short_pct ?? 0).toFixed(1)}
                  </span>
                </div>
                <div class="flex items-center justify-between text-[11px] font-mono">
                  <span class="text-[#2ecfd0]">
                    Long {(openInterest()?.evaluation.long_pct ?? 0).toFixed(1)}%
                  </span>
                  <span class="text-[#ff606a]">
                    Short {(openInterest()?.evaluation.short_pct ?? 0).toFixed(1)}%
                  </span>
                </div>
                <LongShortBar
                  longPct={openInterest()?.evaluation.long_pct}
                  shortPct={openInterest()?.evaluation.short_pct}
                />
              </div>

              <div>
                <div class="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-[#90a0b3]">
                  <span>Funded</span>
                  <span>
                    {(openInterest()?.funded.long_pct ?? 0).toFixed(1)} /{" "}
                    {(openInterest()?.funded.short_pct ?? 0).toFixed(1)}
                  </span>
                </div>
                <div class="flex items-center justify-between text-[11px] font-mono">
                  <span class="text-[#2ecfd0]">
                    Long {(openInterest()?.funded.long_pct ?? 0).toFixed(1)}%
                  </span>
                  <span class="text-[#ff606a]">
                    Short {(openInterest()?.funded.short_pct ?? 0).toFixed(1)}%
                  </span>
                </div>
                <LongShortBar
                  longPct={openInterest()?.funded.long_pct}
                  shortPct={openInterest()?.funded.short_pct}
                />
              </div>
            </section>

            <Show when={error()}>
              <p class="mt-auto text-xs text-[#ff606a]">{error()}</p>
            </Show>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
