import { Navigate, Route, Routes } from "react-router-dom";

import { AssetDashboardPage } from "./components/asset-dashboard";

export function App() {
  return (
    <Routes>
      <Route path="/asset/:symbol" element={<AssetDashboardPage />} />
      <Route path="*" element={<Navigate to="/asset/HYPE%2FUSD" replace />} />
    </Routes>
  );
}
