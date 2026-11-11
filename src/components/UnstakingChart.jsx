import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "../lib/formatters";

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const hypeFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function formatAxisHype(value) {
  return Number.isFinite(value) ? compactFormatter.format(value) : "";
}

function formatDayTick(start) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(start),
  );
}

function formatHourRange(start) {
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(start));
  const hour = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

  return `${day}, ${hour.format(new Date(start))}–${hour.format(new Date(start + 3_600_000))}`;
}

// Round y-axis steps (1, 2 or 5 x 10^n) with about four bands, e.g. 0/100K/200K/300K.
function niceTicks(max) {
  if (!(max > 0)) {
    return [0, 1];
  }

  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((multiple) => multiple * magnitude).find((value) => value >= rough);
  const ticks = [];

  for (let value = 0; value < max + step; value += step) {
    ticks.push(value);
  }

  return ticks;
}

// One tick per local midnight.
function dayTicks(buckets) {
  return buckets
    .filter((bucket) => new Date(bucket.start).getHours() === 0)
    .map((bucket) => bucket.start);
}

function UnstakingTooltip({ active, payload, price }) {
  const bucket = active ? payload?.[0]?.payload : null;
  if (!bucket) {
    return null;
  }

  return (
    <div className="rounded-sm border border-border bg-card p-3 text-xs shadow-lg">
      <p className="text-sm font-medium tabular-nums text-foreground">
        {hypeFormatter.format(bucket.amount)} HYPE
      </p>
      {Number.isFinite(price) && bucket.amount > 0 ? (
        <p className="tabular-nums text-muted-foreground">{formatCurrency(bucket.amount * price)}</p>
      ) : null}
      <p className="mt-1 text-muted-foreground">{formatHourRange(bucket.start)}</p>
      <p className="text-muted-foreground">
        {bucket.count} release{bucket.count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

// HYPE unlocking (or released) per hour over a 7-day window, as on
// hypurrscan.io/staking#unstaking. One series, so no legend: the card title
// names it. The table below the chart lists every release behind the bars.
export default function UnstakingChart({ buckets, price, label, height = 280 }) {
  const ticks = dayTicks(buckets);
  const valueTicks = niceTicks(Math.max(0, ...buckets.map((bucket) => bucket.amount)));

  return (
    <div className="w-full" style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minHeight={height}
        initialDimension={{ width: -1, height }}
      >
        <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="start"
            ticks={ticks}
            interval={0}
            tickFormatter={formatDayTick}
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            dy={8}
            height={32}
          />
          <YAxis
            domain={[0, valueTicks.at(-1)]}
            ticks={valueTicks}
            tickFormatter={formatAxisHype}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={<UnstakingTooltip price={price} />}
            isAnimationActive={false}
          />
          <Bar
            dataKey="amount"
            name="HYPE"
            fill="var(--primary)"
            radius={[2, 2, 0, 0]}
            maxBarSize={24}
            minPointSize={0}
            isAnimationActive={false}
            activeBar={{ fillOpacity: 0.7 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
