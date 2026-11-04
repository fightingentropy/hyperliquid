import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import { lazyPage } from "./lib/lazyPage";

const MarketFlowPage = lazyPage(() => import("./pages/MarketFlowPage"));
const LiquidationMapPage = lazyPage(() => import("./pages/LiquidationMapPage"));
const RelativeStrengthPage = lazyPage(() => import("./pages/RelativeStrengthPage"));
const ResearchPage = lazyPage(() => import("./pages/ResearchPage"));
const TokenAnalyticsPage = lazyPage(() => import("./pages/TokenAnalyticsPage"));
const TeamDistributionPage = lazyPage(() => import("./pages/TeamDistributionPage"));
const WalletLookupPage = lazyPage(() => import("./pages/WalletLookupPage"));
const WalletPage = lazyPage(() => import("./pages/WalletPage"));
const WatchPage = lazyPage(() => import("./pages/WatchPage"));
const EntitiesPage = lazyPage(() => import("./pages/EntitiesPage"));
const EntityPage = lazyPage(() => import("./pages/EntityPage"));

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Navigate to="/app/market-flow" replace />} />

        <Route path="/app" element={<AppShell />}>
          <Route index element={<WalletLookupPage />} />
          <Route path="market-flow" element={<MarketFlowPage />} />
          <Route path="liquidations" element={<LiquidationMapPage />} />
          <Route path="relative-strength" element={<RelativeStrengthPage />} />
          <Route path="watch" element={<WatchPage />} />
          <Route path="research" element={<ResearchPage />} />
          <Route path="token-analytics" element={<TokenAnalyticsPage />} />
          <Route path="team-wallets" element={<TeamDistributionPage />} />
          <Route path="entities" element={<EntitiesPage />} />
          <Route path="entities/:entityId" element={<EntityPage />} />
          <Route path="wallets" element={<WalletLookupPage />} />
          <Route path="wallets/:address" element={<WalletPage />} />
          <Route path="*" element={<Navigate to="/app/market-flow" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/app/market-flow" replace />} />
      </Routes>
    </Suspense>
  );
}
