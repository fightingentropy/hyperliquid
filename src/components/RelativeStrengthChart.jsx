import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cx } from "../lib/cx";
import { formatSignedPercent } from "../lib/formatters";

const HYPERLIQUID_LOGO_SRC = "/assets/hyperliquid-symbol-light.png";

function formatAxisPercent(value) {
  return formatSignedPercent(value, 2);
}

function TokenMarker({ symbol, color, className = "size-2" }) {
  if (symbol === "HYPE") {
    return (
      <img
        src={HYPERLIQUID_LOGO_SRC}
        alt=""
        aria-hidden="true"
        className={cx("shrink-0 object-contain", className)}
      />
    );
  }

  return (
    <span
      className={cx("inline-block shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

function RelativeStrengthTooltip({ active, payload, assets, focusSymbol }) {
  if (!active) {
    return null;
  }

  const point = payload?.[0]?.payload;

  if (!point) {
    return null;
  }

  const rankedEntries = assets
    .map((asset) => ({
      symbol: asset.symbol,
      color: asset.symbol === focusSymbol ? "#1fa8ff" : asset.color,
      value: point[asset.symbol],
    }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((left, right) => right.value - left.value);

  const focusEntry = rankedEntries.find((entry) => entry.symbol === focusSymbol) ?? null;
  const leaders = rankedEntries.filter((entry) => entry.symbol !== focusSymbol).slice(0, 5);

  return (
    <div className="rounded-sm border border-border bg-card/95 p-3 text-xs shadow-2xl backdrop-blur">
      <div className="mb-2 font-medium text-foreground">{point.tooltipLabel}</div>

      {focusEntry ? (
        <div className="mb-2 flex items-center justify-between gap-4 border-b border-border pb-2">
          <div className="flex items-center gap-2">
            <TokenMarker symbol={focusEntry.symbol} color={focusEntry.color} className="size-3.5" />
            <span className="font-mono text-foreground">{focusEntry.symbol}</span>
          </div>
          <span
            className={cx(
              "font-mono font-medium",
              focusEntry.value >= 0 ? "text-[#53d88f]" : "text-[#ff6d6d]",
            )}
          >
            {formatSignedPercent(focusEntry.value)}
          </span>
        </div>
      ) : null}

      <div className="space-y-1.5">
        {leaders.map((entry) => (
          <div key={entry.symbol} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <TokenMarker symbol={entry.symbol} color={entry.color} className="size-3" />
              <span className="font-mono text-muted-foreground">{entry.symbol}</span>
            </div>
            <span
              className={cx(
                "font-mono",
                entry.value >= 0 ? "text-[#53d88f]" : "text-[#ff6d6d]",
              )}
            >
              {formatSignedPercent(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildEndLabelRenderer({ focusSymbol, lastIndexes }) {
  return function EndLabel(props) {
    const { index, value, x, y } = props;

    if (index !== lastIndexes[focusSymbol] || !Number.isFinite(value)) {
      return null;
    }

    const label = `${focusSymbol} ${formatSignedPercent(value)}`;
    const labelWidth = Math.max(122, label.length * 7 + 28);

    return (
      <g transform={`translate(${x + 12},${y - 17})`}>
        <rect width={labelWidth} height="34" rx="8" fill="#1fa8ff" />
        {focusSymbol === "HYPE" ? (
          <image
            href={HYPERLIQUID_LOGO_SRC}
            x="8"
            y="8"
            width="18"
            height="18"
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <circle cx="13" cy="17" r="4.5" fill="#eaf7ff" />
        )}
        <text
          x={focusSymbol === "HYPE" ? 26 : 24}
          y="22"
          fill="#f8fbff"
          fontFamily="var(--font-mono)"
          fontSize="12"
          fontWeight="500"
        >
          {label}
        </text>
      </g>
    );
  };
}

export default function RelativeStrengthChart({
  data,
  assets,
  focusSymbol,
  onFocusChange,
  domain,
  height = 640,
}) {
  const lastIndexes = assets.reduce((accumulator, asset) => {
    let lastIndex = -1;

    for (let index = data.length - 1; index >= 0; index -= 1) {
      if (Number.isFinite(data[index]?.[asset.symbol])) {
        lastIndex = index;
        break;
      }
    }

    accumulator[asset.symbol] = lastIndex;
    return accumulator;
  }, {});

  const renderEndLabel = buildEndLabelRenderer({ focusSymbol, lastIndexes });
  const initialDimension = { width: -1, height };

  return (
    <section className="qf-rs-panel rounded-sm border border-border bg-card">
      <div className="qf-rs-panel__surface">
        <div className="qf-rs-ranking" aria-label="Relative strength ranking">
          {assets.map((asset) => {
            const isFocused = asset.symbol === focusSymbol;

            return (
              <button
                key={asset.symbol}
                type="button"
                className={cx("qf-rs-ranking__item", isFocused && "is-focused")}
                onClick={() => onFocusChange(asset.symbol)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <TokenMarker
                    symbol={asset.symbol}
                    color={isFocused ? "#1fa8ff" : asset.color}
                    className="size-3.5"
                  />
                  <span
                    className={cx(
                      "truncate font-mono text-[11px] uppercase tracking-[0.05em]",
                      isFocused ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {asset.symbol}
                  </span>
                </span>
                <span
                  className={cx(
                    "shrink-0 font-mono text-[11px]",
                    asset.latestChange >= 0 ? "text-[#53d88f]" : "text-[#ff6d6d]",
                    isFocused && "text-foreground",
                  )}
                >
                  {formatSignedPercent(asset.latestChange)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="qf-rs-panel__chart" style={{ height }}>
          <ResponsiveContainer
            width="100%"
            height="100%"
            minHeight={height}
            initialDimension={initialDimension}
          >
            <LineChart data={data} margin={{ top: 18, right: 140, left: 16, bottom: 18 }}>
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} />
              <XAxis
                dataKey="xLabel"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                dy={10}
              />
              <YAxis
                orientation="right"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={84}
                tickFormatter={formatAxisPercent}
                domain={domain}
              />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.35} strokeDasharray="3 3" />
              <Tooltip
                cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                content={<RelativeStrengthTooltip assets={assets} focusSymbol={focusSymbol} />}
              />

              {assets.map((asset) => {
                const isFocused = asset.symbol === focusSymbol;

                return (
                  <Line
                    key={asset.symbol}
                    type="linear"
                    dataKey={asset.symbol}
                    stroke={isFocused ? "#1fa8ff" : asset.color}
                    strokeWidth={isFocused ? 3.25 : 1.2}
                    strokeOpacity={isFocused ? 1 : 0.28}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  >
                    {isFocused ? <LabelList dataKey={asset.symbol} content={renderEndLabel} /> : null}
                  </Line>
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
