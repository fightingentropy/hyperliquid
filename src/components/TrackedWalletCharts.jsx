import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactCurrency, formatCompactSignedCurrency, formatCurrency, formatSignedCurrency } from "../lib/formatters";

// Diverging pair for polarity (buy/long vs sell/short). Blue/red rather than the
// app's green/red text tokens: green/red fails deuteranopia separation (ΔE 4.6),
// blue/red passes (ΔE 19.2) on the dark card surface.
export const BUY_COLOR = "var(--flow-buy)";
export const SELL_COLOR = "var(--flow-sell)";

const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };
const CATEGORY_TICK = { fontSize: 12, fill: "var(--foreground)" };

function niceStep(raw) {
  const exponent = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}

// Round ticks centred on zero, with headroom so end labels fit inside the plot.
function symmetricAxis(values, stepsPerSide = 2) {
  const max = Math.max(1, ...values.map((value) => Math.abs(value))) * 1.25;
  const step = niceStep(max / stepsPerSide);
  const top = step * Math.ceil(max / step);
  const ticks = [];
  for (let tick = -top; tick <= top + step / 2; tick += step) {
    ticks.push(Math.abs(tick) < step / 1e6 ? 0 : tick);
  }
  return { domain: [-top, top], ticks };
}

// Rounded only at the data end; Recharts mirrors the corners for negative bars.
const HORIZONTAL_RADIUS = [0, 4, 4, 0];
const VERTICAL_RADIUS = [3, 3, 0, 0];

export function ChartLegend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: item.color }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function TooltipFrame({ title, children }) {
  return (
    <div className="rounded-sm border border-border bg-card p-3 text-xs shadow-lg" style={{ minWidth: 200, maxWidth: 300 }}>
      <div className="mb-2 font-medium text-foreground">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function TooltipRow({ label, value, muted = false }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className={muted ? "font-mono text-muted-foreground" : "font-mono text-foreground"}>{value}</span>
    </div>
  );
}

function compactAbs(value) {
  return value ? formatCompactCurrency(Math.abs(value)) : "$0";
}

function makeEndLabel(format) {
  return function EndLabel({ x, y, width, height, value }) {
    if (!value) {
      return null;
    }
    const positive = value > 0;
    return (
      <text
        x={positive ? x + width + 6 : x + width - 6}
        y={y + height / 2}
        dy={4}
        textAnchor={positive ? "start" : "end"}
        fontSize={11}
        fill="var(--muted-foreground)"
      >
        {format(value)}
      </text>
    );
  };
}

const AbsEndLabel = makeEndLabel((value) => formatCompactCurrency(Math.abs(value)));
const SignedEndLabel = makeEndLabel(formatCompactSignedCurrency);

// --- Positioning ---------------------------------------------------------------

function PositioningTooltip({ active, payload }) {
  const row = active ? payload?.[0]?.payload : null;
  if (!row) {
    return null;
  }
  return (
    <TooltipFrame title={`${row.symbol} · net ${formatCompactSignedCurrency(row.netUsd)}`}>
      {row.longs.map((entry) => (
        <TooltipRow key={`l:${entry.address}`} label={`Long · ${entry.name}`} value={formatCurrency(entry.valueUsd)} />
      ))}
      {row.shorts.map((entry) => (
        <TooltipRow key={`s:${entry.address}`} label={`Short · ${entry.name}`} value={formatCurrency(entry.valueUsd)} />
      ))}
    </TooltipFrame>
  );
}

export function PositioningChart({ rows }) {
  const data = rows.map((row) => ({ ...row, long: row.longUsd, short: -row.shortUsd }));
  const height = data.length * 36 + 40;
  const axis = symmetricAxis(data.flatMap((row) => [row.long, row.short]));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" stackOffset="sign" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={10}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis
          type="number"
          domain={axis.domain}
          ticks={axis.ticks}
          tickFormatter={compactAbs}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis type="category" dataKey="symbol" width={60} tick={CATEGORY_TICK} axisLine={false} tickLine={false} />
        <ReferenceLine x={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />
        <Tooltip cursor={{ fill: "var(--muted)", fillOpacity: 0.35 }} content={<PositioningTooltip />} />
        <Bar dataKey="short" stackId="side" fill={SELL_COLOR} radius={HORIZONTAL_RADIUS} maxBarSize={16} isAnimationActive={false}>
          <LabelList dataKey="short" content={AbsEndLabel} />
        </Bar>
        <Bar dataKey="long" stackId="side" fill={BUY_COLOR} radius={HORIZONTAL_RADIUS} maxBarSize={16} isAnimationActive={false}>
          <LabelList dataKey="long" content={AbsEndLabel} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// --- Net flow by asset -----------------------------------------------------

function NetFlowTooltip({ active, payload }) {
  const row = active ? payload?.[0]?.payload : null;
  if (!row) {
    return null;
  }
  return (
    <TooltipFrame title={`${row.symbol} · net ${formatCompactSignedCurrency(row.netUsd)}`}>
      <TooltipRow label="Bought" value={formatCurrency(row.buyUsd)} />
      <TooltipRow label="Sold" value={formatCurrency(row.sellUsd)} />
      {row.perpNetUsd && row.spotNetUsd ? (
        <>
          <TooltipRow label="Perps net" value={formatSignedCurrency(row.perpNetUsd)} muted />
          <TooltipRow label="Spot net" value={formatSignedCurrency(row.spotNetUsd)} muted />
        </>
      ) : null}
      <div className="my-1 border-t border-border" />
      {row.wallets.slice(0, 5).map((wallet) => (
        <TooltipRow key={wallet.address} label={wallet.name} value={formatCompactSignedCurrency(wallet.netUsd)} />
      ))}
      <TooltipRow label="Trades" value={row.trades} muted />
    </TooltipFrame>
  );
}

export function NetFlowChart({ rows }) {
  const height = rows.length * 36 + 40;
  const axis = symmetricAxis(rows.map((row) => row.netUsd));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={10}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis
          type="number"
          domain={axis.domain}
          ticks={axis.ticks}
          tickFormatter={compactAbs}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis type="category" dataKey="symbol" width={60} tick={CATEGORY_TICK} axisLine={false} tickLine={false} />
        <ReferenceLine x={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />
        <Tooltip cursor={{ fill: "var(--muted)", fillOpacity: 0.35 }} content={<NetFlowTooltip />} />
        <Bar dataKey="netUsd" radius={HORIZONTAL_RADIUS} maxBarSize={16} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell key={row.symbol} fill={row.netUsd >= 0 ? BUY_COLOR : SELL_COLOR} />
          ))}
          <LabelList dataKey="netUsd" content={SignedEndLabel} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// --- Flow over time --------------------------------------------------------

function formatBucket(start, bucketMs) {
  const date = new Date(start);
  const hours = String(date.getHours()).padStart(2, "0");
  if (bucketMs < 6 * 60 * 60 * 1000) {
    return `${hours}:00`;
  }
  return `${date.toLocaleDateString("en-US", { weekday: "short" })} ${hours}:00`;
}

function TimelineTooltip({ active, payload, bucketMs, symbol }) {
  const row = active ? payload?.[0]?.payload : null;
  if (!row) {
    return null;
  }
  const end = new Date(row.start + bucketMs);
  const title = `${symbol ?? "All assets"} · ${formatBucket(row.start, bucketMs)}–${String(end.getHours()).padStart(2, "0")}:00`;
  return (
    <TooltipFrame title={title}>
      <TooltipRow label="Bought" value={formatCurrency(row.buyUsd)} />
      <TooltipRow label="Sold" value={formatCurrency(row.sellUsd)} />
      <TooltipRow label="Net" value={formatSignedCurrency(row.netUsd)} />
    </TooltipFrame>
  );
}

export function FlowTimelineChart({ buckets, bucketMs, symbol }) {
  const data = buckets.map((bucket) => ({ ...bucket, bought: bucket.buyUsd, sold: -bucket.sellUsd }));
  const tickEvery = Math.max(1, Math.ceil(data.length / 8));
  const axis = symmetricAxis(data.flatMap((row) => [row.bought, row.sold]));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="start"
          tickFormatter={(value) => formatBucket(value, bucketMs)}
          interval={tickEvery - 1}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={axis.domain}
          ticks={axis.ticks}
          tickFormatter={compactAbs}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.35 }}
          content={<TimelineTooltip bucketMs={bucketMs} symbol={symbol} />}
        />
        <Bar dataKey="sold" stackId="flow" fill={SELL_COLOR} radius={VERTICAL_RADIUS} isAnimationActive={false} />
        <Bar dataKey="bought" stackId="flow" fill={BUY_COLOR} radius={VERTICAL_RADIUS} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
