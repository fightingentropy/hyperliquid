import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function buildChartPoints(tickerSeries, benchmarkSeries, ticker, benchmark) {
  const rows = new Map();

  tickerSeries.forEach((point) => {
    rows.set(point.date, {
      date: point.date,
      [ticker]: point.normalized_adjusted_close,
    });
  });
  benchmarkSeries.forEach((point) => {
    rows.set(point.date, {
      ...(rows.get(point.date) ?? { date: point.date }),
      [benchmark]: point.normalized_adjusted_close,
    });
  });

  return [...rows.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((point) => ({
      ...point,
      label: formatShortDate(point.date),
    }));
}

function ResearchTooltip({ active, payload, ticker, benchmark }) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="qf-research-chart-tooltip">
      <p className="qf-research-chart-tooltip__date">{formatLongDate(point.date)}</p>
      <div className="qf-research-chart-tooltip__row">
        <span>{ticker}</span>
        <strong>{formatIndex(point[ticker])}</strong>
      </div>
      <div className="qf-research-chart-tooltip__row is-benchmark">
        <span>{benchmark}</span>
        <strong>{formatIndex(point[benchmark])}</strong>
      </div>
    </div>
  );
}

export default function EquityResearchChart({
  tickerSeries,
  benchmarkSeries,
  ticker,
  benchmark,
  height = 320,
}) {
  const data = buildChartPoints(tickerSeries, benchmarkSeries, ticker, benchmark);

  if (data.length < 2) {
    return (
      <div className="qf-research-chart-empty">
        Comparable adjusted-price history is unavailable.
      </div>
    );
  }

  return (
    <div className="qf-research-chart" style={{ height }}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minHeight={height}
        initialDimension={{ width: -1, height }}
      >
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 10, left: 2 }}>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeOpacity={0.55}
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            minTickGap={30}
            dy={8}
          />
          <YAxis
            orientation="right"
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={["auto", "auto"]}
            tickFormatter={(value) => Number(value).toFixed(0)}
          />
          <ReferenceLine
            y={100}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.45}
            strokeDasharray="4 4"
          />
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
            content={<ResearchTooltip ticker={ticker} benchmark={benchmark} />}
          />
          <Line
            type="linear"
            dataKey={benchmark}
            name={benchmark}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.7}
            strokeWidth={1.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey={ticker}
            name={ticker}
            stroke="var(--primary)"
            strokeWidth={2.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatIndex(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "—";
}

function formatShortDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatLongDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
