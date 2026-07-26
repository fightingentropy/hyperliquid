import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";

const MarketFlowPage = lazy(() => import("./pages/MarketFlowPage"));
const LiquidationMapPage = lazy(() => import("./pages/LiquidationMapPage"));
const RelativeStrengthPage = lazy(() => import("./pages/RelativeStrengthPage"));
const ResearchPage = lazy(() => import("./pages/ResearchPage"));
const WalletLookupPage = lazy(() => import("./pages/WalletLookupPage"));
const WalletPage = lazy(() => import("./pages/WalletPage"));

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
          <Route path="research" element={<ResearchPage />} />
          <Route path="wallets" element={<WalletLookupPage />} />
          <Route path="wallets/:address" element={<WalletPage />} />
          <Route path="*" element={<Navigate to="/app/market-flow" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/app/market-flow" replace />} />
      </Routes>
    </Suspense>
  );
}
