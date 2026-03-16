import { Navbar } from "../components/navbar";
import { PageOrbs } from "../components/page-orbs";
import { useBodyClass } from "../lib/use-body-class";
import { useModuleMount } from "../lib/use-module-mount";

export function MarketFlowPage() {
  useBodyClass("app-shell-page market-flow-page");
  useModuleMount(async () => {
    // @ts-expect-error legacy JS mount module
    const mod = await import("../legacy/market-flow.js");
    return mod.mountMarketFlowPage();
  });

  return (
    <>
      <PageOrbs />
      <Navbar />

      <main class="layout market-flow-layout">
        <section class="market-flow-hero-panel">
          <div class="market-flow-intro">
            <p class="market-flow-intro-copy">
              Participant market flow from Hyperliquid trade data: buy vs sell pressure across
              HYPE spot &amp; perps, plus a curated set of perps and index markets.
            </p>
          </div>

          <div id="asset-toggle" class="market-flow-asset-tabs" aria-label="Asset"></div>

          <div
            id="market-toggle-wrap"
            class="market-flow-market-toggle-wrap"
            aria-label="Market variant"
          >
            <div id="market-toggle" class="segmented market-flow-market-toggle"></div>
          </div>

          <div id="hero-deltas" class="market-flow-hero-deltas"></div>

          <section class="market-flow-chart-card">
            <div class="market-flow-chart-header">
              <div class="market-flow-chart-heading">
                <h1 id="chart-title">Net flow per hour (last 7D)</h1>
                <p id="chart-subtitle" class="muted mono">
                  HYPE Perp
                </p>
              </div>

              <div class="market-flow-chart-toolbar">
                <div
                  id="chart-mode-toggle"
                  class="segmented market-flow-chart-toggle"
                  aria-label="Chart mode"
                ></div>
                <div
                  id="chart-window-toggle"
                  class="segmented market-flow-chart-toggle"
                  aria-label="Chart window"
                ></div>
              </div>
            </div>

            <div class="market-flow-chart-shell">
              <svg
                id="market-flow-chart"
                class="market-flow-chart-svg"
                viewBox="0 0 1200 480"
                role="img"
                aria-label="Market flow chart"
                preserveAspectRatio="none"
              ></svg>
              <div id="chart-empty" class="market-flow-chart-empty" hidden>
                Loading chart...
              </div>
            </div>

            <div class="market-flow-chart-footer">
              <p id="chart-status" class="market-flow-chart-status muted">
                Loading chart...
              </p>
            </div>
          </section>
        </section>

        <section class="market-flow-panel">
          <div class="market-flow-header">
            <div class="market-flow-heading">
              <h2>Participant net flow</h2>
              <p id="market-flow-description" class="lede">
                Aggregated buys minus sells (includes passive + aggressive trades).
              </p>
            </div>

            <div class="market-flow-toolbar">
              <div id="window-toggle" class="segmented market-flow-toggle" aria-label="Window"></div>
              <div class="market-flow-separator" aria-hidden="true"></div>
              <div id="limit-toggle" class="segmented market-flow-toggle" aria-label="Top limit"></div>
            </div>
          </div>

          <div class="market-flow-tabs">
            <button id="tab-net" type="button" class="market-flow-tab active" data-view="net">
              Net flow
            </button>
            <button id="tab-total" type="button" class="market-flow-tab" data-view="total">
              Total volume
            </button>
          </div>

          <div class="market-flow-meta">
            <div class="market-flow-meta-item">
              <span class="label">Market</span>
              <span id="market-id" class="value mono">
                HYPE-PERP
              </span>
            </div>
            <div class="market-flow-meta-item">
              <span class="label">Updated</span>
              <span id="market-updated" class="value">
                —
              </span>
            </div>
            <div class="market-flow-meta-item">
              <span class="label">Window</span>
              <span id="market-window" class="value">
                24H
              </span>
            </div>
            <button id="market-flow-refresh" type="button" class="ghost market-flow-refresh">
              Refresh
            </button>
          </div>

          <p id="market-flow-status" class="market-flow-status muted">
            Loading participant market flow...
          </p>

          <div id="market-flow-grid" class="market-flow-grid">
            <section id="buyers-card" class="market-flow-card">
              <div class="market-flow-card-header">
                <h3 id="buyers-title">Top net buyers (24H)</h3>
              </div>
              <div id="buyers-list" class="market-flow-list"></div>
            </section>

            <section id="sellers-card" class="market-flow-card">
              <div class="market-flow-card-header">
                <h3 id="sellers-title">Top net sellers (24H)</h3>
              </div>
              <div id="sellers-list" class="market-flow-list"></div>
            </section>
          </div>
        </section>
      </main>
    </>
  );
}
