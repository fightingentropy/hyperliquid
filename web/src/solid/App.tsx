import { Navigate, Route, Router } from "@solidjs/router";

import { AboutPage } from "./pages/about";
import { HeatmapPage } from "./pages/heatmap";
import { HomePage } from "./pages/home";
import { LiquidationsPage } from "./pages/liquidations";
import { MarketFlowPage } from "./pages/market-flow";
import { PerpetualsPage } from "./pages/perpetuals";
import { SettingsPage } from "./pages/settings";
import { UnstakingPage } from "./pages/unstaking";
import { WalletPage } from "./pages/wallet";
import { WalletsPage } from "./pages/wallets";

export function App() {
  return (
    <Router>
      <Route path="/" component={HomePage} />
      <Route path="/asset-app" component={HomePage} />
      <Route path="/perpetuals" component={PerpetualsPage} />
      <Route path="/heatmap" component={HeatmapPage} />
      <Route path="/liquidations" component={LiquidationsPage} />
      <Route path="/market-flow" component={MarketFlowPage} />
      <Route path="/unstaking" component={UnstakingPage} />
      <Route path="/wallet" component={() => <Navigate href="/wallets" />} />
      <Route path="/wallets" component={WalletsPage} />
      <Route path="/wallets/:address" component={WalletPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="*all" component={() => <Navigate href="/" />} />
    </Router>
  );
}
