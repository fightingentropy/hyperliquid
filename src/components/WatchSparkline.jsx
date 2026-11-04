const WIDTH = 120;
const HEIGHT = 36;
const PADDING = 2;

// Tiny inline price sparkline built from hourly closes. Red/green follows the
// first-to-last move rather than the 24h change so it always matches the
// drawn line.
export default function WatchSparkline({ points }) {
  const closes = (points ?? [])
    .map((point) => Number(point?.closePrice))
    .filter((closePrice) => Number.isFinite(closePrice));

  if (closes.length < 2) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const stepX = (WIDTH - PADDING * 2) / (closes.length - 1);
  const coordinates = closes.map((close, index) => {
    const x = PADDING + index * stepX;
    const y = HEIGHT - PADDING - ((close - min) / range) * (HEIGHT - PADDING * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const isPositive = closes[closes.length - 1] >= closes[0];
  const stroke = isPositive ? "var(--profit)" : "var(--loss)";
  const linePath = `M${coordinates.join(" L")}`;
  const areaPath = `${linePath} L${(WIDTH - PADDING).toFixed(1)},${HEIGHT - PADDING} L${PADDING},${HEIGHT - PADDING} Z`;

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      className="block"
    >
      <path d={areaPath} fill={stroke} fillOpacity="0.12" />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
