/** @jsxImportSource react */
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { AssetDashboardPage } from "@/react/components/asset-dashboard.react";

export function mountAssetDashboard(container: HTMLElement) {
  const root = createRoot(container);

  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <AssetDashboardPage embedded />
      </BrowserRouter>
    </React.StrictMode>,
  );

  return () => {
    root.unmount();
  };
}
