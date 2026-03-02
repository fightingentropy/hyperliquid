import { Route, Routes } from "react-router-dom";

import { AssetDashboardPage } from "./components/asset-dashboard";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AssetDashboardPage />} />
      <Route path="/asset/:symbol" element={<AssetDashboardPage />} />
      <Route path="*" element={<AssetDashboardPage />} />
    </Routes>
  );
}
