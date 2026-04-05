import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";

const MarketFlowPage = lazy(() => import("./pages/MarketFlowPage"));
const RelativeStrengthPage = lazy(() => import("./pages/RelativeStrengthPage"));
const WalletLookupPage = lazy(() => import("./pages/WalletLookupPage"));
const WalletPage = lazy(() => import("./pages/WalletPage"));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/market-flow" replace />} />

      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="/app/market-flow" replace />} />
        <Route path="market-flow" element={<MarketFlowPage />} />
        <Route path="relative-strength" element={<RelativeStrengthPage />} />
        <Route path="wallets" element={<WalletLookupPage />} />
        <Route path="wallets/:address" element={<WalletPage />} />
        <Route path="*" element={<Navigate to="/app/market-flow" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/app/market-flow" replace />} />
    </Routes>
  );
}
