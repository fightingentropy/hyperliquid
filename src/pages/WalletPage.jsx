import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, ExternalLink } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  fetchAllClearinghouseStates,
  fetchAllOpenOrders,
  fetchDelegatorSummary,
  fetchHourlyCandles,
  fetchPortfolio,
  fetchSpotClearinghouseState,
  fetchSpotMetaAndAssetCtxs,
  fetchSubAccounts,
  fetchUserFills,
  fetchUserNonFundingLedgerUpdates,
} from "../api/hyperliquid";
import { fetchWalletNotionalDeltas, fetchWalletResolve } from "../api/qwantify";
import ButtonGroup from "../components/ButtonGroup";
import WalletPerformanceChart from "../components/WalletPerformanceChart";
import {
  WalletCompositionCard,
  WalletHoldingsPanel,
  WalletNotionalDeltasPanel,
  WalletOrdersPanel,
  WalletOverviewGrid,
  WalletPerformanceBreakdownPanel,
  WalletPositionsPanel,
  WalletStatisticsPanel,
  WalletTradesPanel,
  WalletTransactionsPanel,
} from "../components/WalletPanels";
import { usePollingResource } from "../hooks/usePollingResource";
import { cx } from "../lib/cx";
import {
  PERFORMANCE_METRIC_OPTIONS,
  PERFORMANCE_RANGE_OPTIONS,
  PERFORMANCE_SCOPE_OPTIONS,
  WALLET_TABS,
  buildAssetPerformanceRows,
  buildCompositionSlices,
  buildHoldingsSnapshot,
  buildOpenOrderGroups,
  buildPerformanceSeries,
  buildPositionSnapshot,
  buildTradeRows,
  buildTradeStatistics,
  buildTransactionRows,
  buildWalletMetrics,
  getAllTimeStart,
  isValidEvmAddress,
  normalizePortfolio,
} from "../lib/wallet";
import { formatCurrency, shortAddress } from "../lib/formatters";

const HYPURRSCAN_URL = "https://hypurrscan.io/address";
const HYPEREVMSCAN_URL = "https://hyperevmscan.io/address";

function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

export default function WalletPage() {
  const { address: routeAddress = "" } = useParams();
  const walletAddress = routeAddress.trim();
  const location = useLocation();
  const navigate = useNavigate();

  const [selectedTab, setSelectedTab] = useState("positions");
  const [performanceMetric, setPerformanceMetric] = useState("pnl");
  const [performanceScope, setPerformanceScope] = useState("perp");
  const [performanceRange, setPerformanceRange] = useState("all");
  const [positionsView, setPositionsView] = useState("table");
  const [deltaView, setDeltaView] = useState("table");
  const [copyLabel, setCopyLabel] = useState("Copy");

  const validAddress = isValidEvmAddress(walletAddress);
  const origin = location.state?.origin || "/app/wallets";

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Qwantify";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  const handleBack = () => {
    if ((window.history.state?.idx ?? 0) > 0) {
      navigate(-1);
      return;
    }

    navigate(origin);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy"), 1200);
    } catch {
      setCopyLabel("Failed");
      window.setTimeout(() => setCopyLabel("Copy"), 1200);
    }
  };

  const resolveResource = usePollingResource(
    () => fetchWalletResolve(walletAddress),
    [walletAddress],
    { enabled: validAddress },
  );

  const positionsResource = usePollingResource(
    () => fetchAllClearinghouseStates({ user: walletAddress }),
    [walletAddress],
    { enabled: validAddress, initialData: [] },
  );

  const portfolioResource = usePollingResource(
    () => fetchPortfolio({ user: walletAddress }),
    [walletAddress],
    { enabled: validAddress },
  );

  const holdingsBundleResource = usePollingResource(
    async () => {
      const [spotMetaAndAssetCtxs, spotState, subAccounts, stakingSummary] = await Promise.all([
        fetchSpotMetaAndAssetCtxs(),
        fetchSpotClearinghouseState({ user: walletAddress }),
        fetchSubAccounts({ user: walletAddress }),
        fetchDelegatorSummary({ user: walletAddress }),
      ]);

      return {
        spotMetaAndAssetCtxs,
        spotState,
        subAccounts,
        stakingSummary,
      };
    },
    [walletAddress],
    { enabled: validAddress },
  );

  const hypePriceResource = usePollingResource(
    () => fetchHourlyCandles({ coin: "HYPE", chartWindow: "24h" }),
    [walletAddress],
    { enabled: validAddress, initialData: [] },
  );

  const openOrdersResource = usePollingResource(
    () => fetchAllOpenOrders({ user: walletAddress }),
    [walletAddress],
    {
      enabled: validAddress && selectedTab === "orders",
      initialData: [],
    },
  );

  const fillsResource = usePollingResource(
    () => fetchUserFills({ user: walletAddress, aggregateByTime: true }),
    [walletAddress],
    {
      enabled: validAddress && ["trades", "performance", "statistics"].includes(selectedTab),
      initialData: [],
    },
  );

  const transactionsResource = usePollingResource(
    () =>
      fetchUserNonFundingLedgerUpdates({
        user: walletAddress,
        startTime: getAllTimeStart(),
        endTime: Date.now(),
      }),
    [walletAddress],
    {
      enabled: validAddress && selectedTab === "transactions",
      initialData: [],
    },
  );

  const resolvedWallet = resolveResource.data?.myWallet ?? resolveResource.data?.systemWallet ?? null;
  const walletId = resolvedWallet?.id ?? null;

  const notionalDeltasResource = usePollingResource(
    () => fetchWalletNotionalDeltas(walletId),
    [walletId],
    {
      enabled: Boolean(walletId),
    },
  );

  const portfolio = useMemo(() => normalizePortfolio(portfolioResource.data), [portfolioResource.data]);
  const positionSnapshot = useMemo(
    () => buildPositionSnapshot(positionsResource.data),
    [positionsResource.data],
  );

  const hypeMid =
    hypePriceResource.data.length > 0
      ? hypePriceResource.data[hypePriceResource.data.length - 1].closePrice
      : 0;

  const holdingsSnapshot = useMemo(() => {
    if (!holdingsBundleResource.data) {
      return {
        holdings: [],
        stakingEntries: [],
        sourceWalletCount: 1,
        totalValueUsd: 0,
      };
    }

    return buildHoldingsSnapshot({
      spotState: holdingsBundleResource.data.spotState,
      subAccounts: holdingsBundleResource.data.subAccounts,
      spotMetaAndAssetCtxs: holdingsBundleResource.data.spotMetaAndAssetCtxs,
      stakingSummary: holdingsBundleResource.data.stakingSummary,
      hypeMid,
    });
  }, [holdingsBundleResource.data, hypeMid]);

  const walletMetrics = useMemo(
    () =>
      buildWalletMetrics({
        portfolio,
        holdingsSnapshot,
        stakingSummary: holdingsBundleResource.data?.stakingSummary,
        hypeMid,
        positionSnapshot,
      }),
    [portfolio, holdingsSnapshot, holdingsBundleResource.data, hypeMid, positionSnapshot],
  );

  const compositionSlices = useMemo(
    () => buildCompositionSlices(walletMetrics),
    [walletMetrics],
  );

  const performanceSeries = useMemo(
    () => buildPerformanceSeries(portfolio, performanceScope, performanceRange, performanceMetric),
    [performanceMetric, performanceRange, performanceScope, portfolio],
  );

  const orderGroups = useMemo(
    () => buildOpenOrderGroups(openOrdersResource.data),
    [openOrdersResource.data],
  );

  const tradeRows = useMemo(() => buildTradeRows(fillsResource.data), [fillsResource.data]);
  const assetPerformanceRows = useMemo(
    () => buildAssetPerformanceRows(fillsResource.data),
    [fillsResource.data],
  );
  const tradeStatistics = useMemo(
    () => buildTradeStatistics(fillsResource.data),
    [fillsResource.data],
  );
  const transactionRows = useMemo(
    () => buildTransactionRows(transactionsResource.data, walletAddress),
    [transactionsResource.data, walletAddress],
  );

  const walletLabel = resolvedWallet?.globalLabel ?? "Wallet";
  const tabStrip = (
    <div className="rounded-sm border border-border bg-card">
      <div className="relative">
        <div className="flex overflow-x-auto pb-px scrollbar-hide">
          {WALLET_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setSelectedTab(tab.value)}
              className={cx(
                "px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors",
                selectedTab === tab.value
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-card to-transparent sm:hidden" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent sm:hidden" />
      </div>
    </div>
  );

  if (!validAddress) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
        <div className="rounded-sm border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          Invalid EVM wallet address.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back
          </button>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-foreground">{walletLabel}</span>
            <span className="break-all font-mono text-sm text-muted-foreground">{walletAddress}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <Copy className="size-4" />
            {copyLabel}
          </button>
          <a
            href={`${HYPURRSCAN_URL}/${walletAddress}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
          >
            HypurrScan
            <ExternalLink className="size-4" />
          </a>
          <a
            href={`${HYPEREVMSCAN_URL}/${walletAddress}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
          >
            HyperEVMScan
            <ExternalLink className="size-4" />
          </a>
        </div>
      </div>

      {resolveResource.error ? (
        <div className="rounded-sm border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {errorMessage(resolveResource.error, "Unable to resolve this wallet in Qwantify.")}
        </div>
      ) : null}

      <div className="space-y-1">
        <h2 className="text-xl font-light text-foreground">Account Overview</h2>
        <p className="text-xs text-muted-foreground">Snapshot • Spot + Perps + Staked</p>
      </div>

      <div className="lg:hidden">
        <WalletCompositionCard slices={compositionSlices} />
      </div>

      <WalletOverviewGrid metrics={walletMetrics} slices={compositionSlices} />

      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-light text-foreground">Performance &amp; Allocation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Perp or perp + spot PnL history alongside account mix.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="rounded-sm border border-border bg-card">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">Performance chart</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ButtonGroup
                  kind="segmented"
                  size="sm"
                  value={performanceMetric}
                  onChange={setPerformanceMetric}
                  options={PERFORMANCE_METRIC_OPTIONS}
                />
                <ButtonGroup
                  kind="segmented"
                  size="sm"
                  value={performanceScope}
                  onChange={setPerformanceScope}
                  options={PERFORMANCE_SCOPE_OPTIONS}
                />
                <ButtonGroup
                  kind="segmented"
                  size="sm"
                  value={performanceRange}
                  onChange={setPerformanceRange}
                  options={PERFORMANCE_RANGE_OPTIONS}
                />
              </div>
            </div>

            <div className="p-4">
              <WalletPerformanceChart
                data={performanceSeries}
                metric={performanceMetric}
                loading={portfolioResource.isLoading}
              />
            </div>
          </div>

          <div className="hidden lg:block">
            <WalletCompositionCard slices={compositionSlices} />
          </div>
        </div>
      </div>

      {tabStrip}

      {selectedTab === "positions" ? (
        <WalletPositionsPanel
          snapshot={positionSnapshot}
          viewMode={positionsView}
          onViewModeChange={setPositionsView}
          loading={positionsResource.isLoading}
          error={
            positionsResource.error
              ? errorMessage(positionsResource.error, "Failed to load positions.")
              : null
          }
        />
      ) : null}

      {selectedTab === "orders" ? (
        <WalletOrdersPanel
          groups={orderGroups}
          loading={openOrdersResource.isLoading}
          error={
            openOrdersResource.error
              ? errorMessage(openOrdersResource.error, "Failed to load open orders.")
              : null
          }
        />
      ) : null}

      {selectedTab === "holdings" ? (
        <WalletHoldingsPanel
          snapshot={holdingsSnapshot}
          loading={holdingsBundleResource.isLoading}
          error={
            holdingsBundleResource.error
              ? errorMessage(holdingsBundleResource.error, "Failed to load holdings.")
              : null
          }
        />
      ) : null}

      {selectedTab === "trades" ? (
        <WalletTradesPanel
          rows={tradeRows}
          loading={fillsResource.isLoading}
          error={fillsResource.error ? errorMessage(fillsResource.error, "Failed to load trades.") : null}
        />
      ) : null}

      {selectedTab === "transactions" ? (
        <WalletTransactionsPanel
          rows={transactionRows}
          loading={transactionsResource.isLoading}
          error={
            transactionsResource.error
              ? errorMessage(transactionsResource.error, "Failed to load transactions.")
              : null
          }
          currentWalletAddress={walletAddress}
        />
      ) : null}

      {selectedTab === "performance" ? (
        <WalletPerformanceBreakdownPanel
          rows={assetPerformanceRows}
          loading={fillsResource.isLoading}
          error={
            fillsResource.error
              ? errorMessage(fillsResource.error, "Failed to load asset performance.")
              : null
          }
        />
      ) : null}

      {selectedTab === "statistics" ? (
        <WalletStatisticsPanel
          stats={tradeStatistics}
          loading={fillsResource.isLoading}
          error={
            fillsResource.error
              ? errorMessage(fillsResource.error, "Failed to load trade statistics.")
              : null
          }
        />
      ) : null}

      {walletId ? (
        <WalletNotionalDeltasPanel
          payload={notionalDeltasResource.data}
          viewMode={deltaView}
          onViewModeChange={setDeltaView}
          loading={notionalDeltasResource.isLoading}
          error={
            notionalDeltasResource.error
              ? errorMessage(notionalDeltasResource.error, "Failed to load notional deltas.")
              : null
          }
        />
      ) : null}

      <div className="rounded-sm border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        Wallet {shortAddress(walletAddress)} • Spot value {formatCurrency(holdingsSnapshot.totalValueUsd, 2)} •
        Perp equity {formatCurrency(walletMetrics.perpsEquityUsd, 2)}
      </div>
    </div>
  );
}
