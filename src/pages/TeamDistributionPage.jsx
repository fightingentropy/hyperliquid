import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchAllMids } from "../api/hyperliquid";
import {
  fetchTeamWalletMonth,
  fetchTeamWalletMonths,
  fetchTeamWalletsOverview,
} from "../api/teamWallets";
import TeamFlowSankey from "../components/TeamFlowSankey";
import TeamWalletsTable, { FlowBar, FlowSwatch } from "../components/TeamWalletsTable";
import { usePollingResource } from "../hooks/usePollingResource";
import { cx } from "../lib/cx";
import { formatPrice } from "../lib/formatters";
import {
  ALL_MONTHS_ID,
  FLOW_OUTCOMES,
  buildFlowLayout,
  buildMonthComparison,
  buildMonthTiles,
  buildSummaryClauses,
  formatCompactToken,
  formatDayMonth,
  formatDelta,
  formatShare,
  formatSyncedAt,
  formatTokenAmount,
  formatUsdValue,
  normalizeWalletRows,
  summarizeWallets,
  toNumber,
} from "../lib/teamDistribution";

const TOKEN_SYMBOL = "HYPE";

function MonthTile({ tile, selected, onSelect }) {
  const title = [
    `${tile.label}: ${formatShare(tile.heldShare)} of ${formatTokenAmount(tile.distributed)} ${TOKEN_SYMBOL} still held`,
    tile.walletCount !== null ? `${tile.walletCount} wallets` : null,
    tile.isOpen ? "window still open" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      className={cx("qf-team-month", selected && "is-active")}
      onClick={() => onSelect(tile.id)}
    >
      <span className="qf-team-month__label">
        {tile.shortLabel}
        {tile.isOpen ? (
          <span className="qf-team-month__open-dot" aria-label="window still open" />
        ) : null}
      </span>
      <span className="qf-team-month__share">{formatShare(tile.heldShare)}</span>
      <FlowBar amounts={tile} total={tile.distributed} />
      <span className="qf-team-month__amount">
        {formatCompactToken(tile.distributed)} {TOKEN_SYMBOL}
      </span>
    </button>
  );
}

function PriceStatus({ overview, livePrice, priceError }) {
  const snapshotPrice = toNumber(overview?.tokenMidPriceUsd);
  const monthCount = overview?.months?.length ?? 0;

  let priceText;
  if (livePrice) {
    priceText = (
      <>
        <strong className="tabular-nums">{formatPrice(livePrice)}</strong> · live
      </>
    );
  } else if (priceError && snapshotPrice) {
    priceText = `Snapshot USD values at ${formatPrice(snapshotPrice)} (${formatDayMonth(overview.tokenMidPriceUpdatedAt)}) · live price unavailable`;
  } else {
    priceText = "Snapshot USD values · connecting to live price";
  }

  return (
    <div className="qf-team-status">
      <span className={cx("qf-team-status__dot", livePrice && "is-live")} aria-hidden="true" />
      <strong>{TOKEN_SYMBOL}</strong>
      <span>{priceText}</span>
      {overview ? (
        <span>
          · {overview.walletCount} wallets across {monthCount} distributions
          {overview.lastSyncedAt ? ` · synced ${formatSyncedAt(overview.lastSyncedAt)}` : ""}
        </span>
      ) : null}
    </div>
  );
}

function SummarySentence({ tile, summary }) {
  const clauses = buildSummaryClauses(summary);
  if (!clauses.length) {
    return null;
  }

  const [lead, second] = clauses;
  const scope =
    tile.id === ALL_MONTHS_ID ? `over ${tile.monthCount} months` : `in ${tile.label}`;

  return (
    <p className="qf-team-sentence">
      Of <strong>{formatTokenAmount(summary.totals.received)} {TOKEN_SYMBOL}</strong> distributed{" "}
      {scope}, <strong>{formatShare(lead.share)}</strong> went to {lead.count}{" "}
      {lead.count === 1 ? "wallet" : "wallets"} that {lead.verb}
      {second ? (
        <>
          , and <strong>{formatShare(second.share)}</strong> went to {second.count} that{" "}
          {second.verb}
        </>
      ) : null}
      . <strong>{formatShare(tile.heldShare)}</strong> is still in the wallets, kept or staked.
    </p>
  );
}

function OutcomeCards({ tile, price }) {
  const cards = [
    { key: "kept", label: "Kept", usd: tile.kept * price, suffix: "" },
    { key: "staked", label: "Staked", usd: tile.staked * price, suffix: "" },
    { key: "sent", label: "Sent away", usd: tile.sentUsd, suffix: " when sent" },
    { key: "sold", label: "Sold (est.)", usd: tile.sold * price, suffix: " at today's price" },
  ];

  return (
    <div className="qf-team-kpis">
      {cards.map((card) => (
        <div key={card.key} className="qf-team-kpi">
          <span className="qf-team-kpi__label">
            <FlowSwatch tone={card.key} large />
            {card.label}
          </span>
          <span className="qf-team-kpi__value">
            <strong>{formatShare(tile.distributed > 0 ? tile[card.key] / tile.distributed : 0)}</strong>
            <span>
              {formatCompactToken(tile[card.key])} {TOKEN_SYMBOL}
            </span>
          </span>
          <span className="qf-team-kpi__sub">
            {formatUsdValue(card.usd)}
            {card.suffix}
          </span>
        </div>
      ))}
    </div>
  );
}

function MonthComparison({ comparison, allMonthsTile }) {
  return (
    <div className="qf-team-compare">
      <span className="qf-team-eyebrow">vs {comparison.previousLabel}</span>
      <span>
        Still held{" "}
        <span className="qf-team-compare__pill">{formatDelta(comparison.heldDeltaPp, "pp")}</span>
      </span>
      <span>
        Sold (est.){" "}
        <span className="qf-team-compare__pill">{formatDelta(comparison.soldDeltaPp, "pp")}</span>
      </span>
      {comparison.distributedChangePct !== null ? (
        <span>
          Distributed{" "}
          <span className="qf-team-compare__pill">
            {formatDelta(comparison.distributedChangePct, "%")}
          </span>
        </span>
      ) : null}
      {allMonthsTile ? (
        <span>
          All months hold <strong>{formatShare(allMonthsTile.heldShare)}</strong>
        </span>
      ) : null}
    </div>
  );
}

function SelectionHeading({ tile }) {
  const isAllMonths = tile.id === ALL_MONTHS_ID;
  const walletText = tile.walletCount !== null ? ` · ${tile.walletCount} wallets` : "";

  return (
    <div className="qf-team-heading">
      <h3>{tile.label}</h3>
      {isAllMonths ? (
        <span>
          {tile.rangeLabel}
          {walletText}
        </span>
      ) : tile.isOpen ? (
        <span className="qf-team-badge">Window open · closes {formatDayMonth(tile.endAt)}</span>
      ) : (
        <span>
          {formatDayMonth(tile.startAt)} – {formatDayMonth(tile.endAt)}
          {walletText}
        </span>
      )}
    </div>
  );
}

// Copy of qwantify.io/team-wallets: where each monthly HyperLabs HYPE
// distribution went, and what the receiving wallets did with it. Qwantify's
// snapshot price is stale, so USD values use the live HYPE mid instead.
export default function TeamDistributionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMonthId = searchParams.get("month") || ALL_MONTHS_ID;

  const overviewResource = usePollingResource(
    () => fetchTeamWalletsOverview({ tokenSymbol: TOKEN_SYMBOL }),
    [TOKEN_SYMBOL],
    {
      intervalMs: 300_000,
      cacheKey: `team-wallets:overview:${TOKEN_SYMBOL}`,
      staleTimeMs: 60_000,
    },
  );

  const monthsResource = usePollingResource(() => fetchTeamWalletMonths(), [], {
    intervalMs: 300_000,
    cacheKey: "team-wallets:months",
    staleTimeMs: 60_000,
  });

  const monthResource = usePollingResource(
    () => fetchTeamWalletMonth(requestedMonthId),
    [requestedMonthId],
    {
      enabled: requestedMonthId !== ALL_MONTHS_ID,
      intervalMs: 300_000,
      cacheKey: `team-wallets:month:${requestedMonthId}`,
      staleTimeMs: 60_000,
    },
  );

  const midsResource = usePollingResource(() => fetchAllMids(), [], {
    intervalMs: 15_000,
    cacheKey: "team-wallets:mids",
    staleTimeMs: 10_000,
  });

  const overview = overviewResource.data;
  const livePrice = toNumber(midsResource.data?.[TOKEN_SYMBOL]) || null;
  const price = livePrice ?? toNumber(overview?.tokenMidPriceUsd);

  const tiles = useMemo(
    () => buildMonthTiles(overview, monthsResource.data?.months, Date.now()),
    [overview, monthsResource.data],
  );

  const selectedTile =
    tiles.find((tile) => tile.id === requestedMonthId) ??
    tiles.find((tile) => tile.id === ALL_MONTHS_ID) ??
    null;
  const selectedId = selectedTile?.id ?? requestedMonthId;
  const isAllMonths = selectedId === ALL_MONTHS_ID;

  const monthData =
    monthResource.data?.month?.id === selectedId ? monthResource.data : null;
  const rawRows = isAllMonths ? overview?.wallets : monthData?.wallets;
  const rows = useMemo(() => normalizeWalletRows(rawRows), [rawRows]);
  const summary = useMemo(() => summarizeWallets(rows), [rows]);
  const flowLayout = useMemo(() => buildFlowLayout(summary), [summary]);

  const selectedIndex = tiles.findIndex((tile) => tile.id === selectedId);
  const previousTile = isAllMonths ? null : tiles[selectedIndex + 1];
  const comparison = buildMonthComparison(selectedTile, previousTile);
  const allMonthsTile = tiles.find((tile) => tile.id === ALL_MONTHS_ID);

  const rowsLoading = isAllMonths ? overviewResource.isLoading : !monthData && !monthResource.error;
  const rowsError = isAllMonths ? overviewResource.error : monthResource.error;

  const selectMonth = (monthId) => {
    const nextParams = new URLSearchParams(searchParams);
    if (monthId === ALL_MONTHS_ID) {
      nextParams.delete("month");
    } else {
      nextParams.set("month", monthId);
    }
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div className="qf-team">
      <PriceStatus
        overview={overview}
        livePrice={livePrice}
        priceError={midsResource.error}
      />

      <header className="qf-team-intro">
        <h2>Team Distribution</h2>
        <p>Where each HyperLabs distribution went, and what the receiving wallets did with it.</p>
      </header>

      {overviewResource.error && !overview ? (
        <div className="rounded-sm border border-border bg-card p-6 text-sm text-muted-foreground">
          Unable to load team distributions.
        </div>
      ) : null}

      {!overview && overviewResource.isLoading ? (
        <div className="rounded-sm border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading distributions…
        </div>
      ) : null}

      {tiles.length ? (
        <section>
          <div className="qf-team-strip-header">
            <span className="qf-team-eyebrow">Distributions · share still held</span>
            <span className="qf-team-note">
              Newest to oldest · <span className="qf-team-month__open-dot" aria-hidden="true" />{" "}
              window still open
            </span>
          </div>
          <div className="qf-team-strip">
            {tiles.map((tile) => (
              <MonthTile
                key={tile.id}
                tile={tile}
                selected={tile.id === selectedId}
                onSelect={selectMonth}
              />
            ))}
          </div>
        </section>
      ) : null}

      {selectedTile ? (
        <section className="qf-team-detail">
          <div>
            <SelectionHeading tile={selectedTile} />
            {rows.length ? (
              <SummarySentence tile={selectedTile} summary={summary} />
            ) : (
              <p className="qf-team-sentence">
                {rowsError ? "Unable to load this distribution." : "Loading distribution…"}
              </p>
            )}
          </div>

          <OutcomeCards tile={selectedTile} price={price} />

          <TeamFlowSankey
            layout={flowLayout}
            sourceLabel={isAllMonths ? "HyperLabs" : selectedTile.label}
          />

          <div className="qf-team-legend">
            {FLOW_OUTCOMES.map((outcome) => (
              <span key={outcome.key}>
                <FlowSwatch tone={outcome.key} large />
                {outcome.label}
              </span>
            ))}
          </div>

          {comparison ? (
            <MonthComparison comparison={comparison} allMonthsTile={allMonthsTile} />
          ) : null}
        </section>
      ) : null}

      {selectedTile ? (
        <TeamWalletsTable
          key={selectedId}
          rows={rows}
          price={price}
          loading={rowsLoading}
          error={rowsError}
        />
      ) : null}
    </div>
  );
}
