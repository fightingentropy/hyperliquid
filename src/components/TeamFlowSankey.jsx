import { useId, useState } from "react";
import { formatCompactToken, formatShare } from "../lib/teamDistribution";

const OUTCOME_COLORS = {
  kept: "var(--qf-flow-kept)",
  staked: "var(--qf-flow-staked)",
  sent: "var(--qf-flow-sent)",
  sold: "var(--qf-flow-sold)",
};

const CATEGORY_LABEL_ROOM = 19;

function linkOpacity(link, focus) {
  const base = link.outcome ? 0.3 : 0.07;
  if (!focus) {
    return base;
  }

  const isActive = focus.category
    ? link.category === focus.category
    : link.outcome === focus.outcome;
  return isActive ? base * 1.8 : base * 0.3;
}

// Distribution → wallet categories → where the tokens are now. Hovering a
// category or an outcome highlights the links that pass through it.
export default function TeamFlowSankey({ layout, sourceLabel }) {
  const hatchId = `qf-team-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [focus, setFocus] = useState(null);

  if (!layout) {
    return null;
  }

  const { width, height, nodeWidth, source, categories, outcomes, links } = layout;
  const total = source.value;
  const sourceCenter = source.y + source.height / 2;

  return (
    <div className="qf-team-flow">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${sourceLabel}: ${formatCompactToken(total)} HYPE split by what the receiving wallets did with it`}
        onMouseLeave={() => setFocus(null)}
      >
        <defs>
          <pattern
            id={hatchId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="2.5" height="6" fill="var(--qf-flow-hatch)" />
          </pattern>
        </defs>

        <g fill="none">
          {links.map((link) => (
            <path
              key={link.key}
              d={link.path}
              stroke={link.outcome ? OUTCOME_COLORS[link.outcome] : "var(--foreground)"}
              strokeWidth={link.width}
              strokeOpacity={linkOpacity(link, focus)}
            />
          ))}
        </g>

        <rect
          x={source.x}
          y={source.y}
          width={nodeWidth}
          height={source.height}
          fill="var(--muted-foreground)"
        />
        <text x={source.x - 8} y={sourceCenter - 3} textAnchor="end" className="is-name">
          {sourceLabel}
        </text>
        <text x={source.x - 8} y={sourceCenter + 11} textAnchor="end">
          {formatCompactToken(total)} HYPE
        </text>

        {categories.map((node) => (
          <g
            key={node.key}
            onMouseEnter={() => setFocus({ category: node.key })}
          >
            <rect
              x={node.x}
              y={node.y - CATEGORY_LABEL_ROOM}
              width={140}
              height={node.height + CATEGORY_LABEL_ROOM}
              fill="transparent"
            />
            <rect x={node.x} y={node.y} width={nodeWidth} height={node.height} fill="var(--foreground)" />
            <text x={node.x} y={node.y - 6}>
              <tspan className="is-name">{node.label}</tspan>
              <tspan dx="6">
                {node.count} · {formatCompactToken(node.value)}
              </tspan>
            </text>
          </g>
        ))}

        {outcomes.map((node) => (
          <g
            key={node.key}
            onMouseEnter={() => setFocus({ outcome: node.key })}
          >
            <rect
              x={node.x}
              y={node.y}
              width={nodeWidth}
              height={node.height}
              fill={OUTCOME_COLORS[node.key]}
            />
            {node.key === "sold" ? (
              <rect
                x={node.x}
                y={node.y}
                width={nodeWidth}
                height={node.height}
                fill={`url(#${hatchId})`}
              />
            ) : null}
            <text x={node.x + nodeWidth + 8} y={node.y + node.height / 2 + 3.5}>
              <tspan className="is-name">{node.label}</tspan>
              <tspan dx="6">
                {formatCompactToken(node.value)} · {formatShare(node.value / total)}
              </tspan>
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
