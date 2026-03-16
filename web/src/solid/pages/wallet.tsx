import { Navbar } from "../components/navbar";
import { PageOrbs } from "../components/page-orbs";
import { useBodyClass } from "../lib/use-body-class";
import { useModuleMount } from "../lib/use-module-mount";

export function WalletPage() {
  useBodyClass("app-shell-page wallet-page");
  useModuleMount(async () => {
    // @ts-expect-error legacy JS mount module
    const mod = await import("../legacy/wallet.js");
    return mod.mountWalletPage();
  });

  return (
    <>
      <PageOrbs />
      <Navbar />

      <main class="wallet-shell">
        <header class="wallet-topbar">
          <div class="wallet-topbar-copy">
            <p class="wallet-kicker">Wallet</p>
            <div class="wallet-heading-row">
              <h1>Wallet</h1>
              <p id="wallet-address-title" class="wallet-address-title mono">
                No wallet loaded
              </p>
            </div>
            <p id="wallet-summary-caption" class="wallet-topbar-caption">
              Account overview powered by Hyperliquid portfolio, positions, spot balances, and
              Qwantify deltas.
            </p>
          </div>

          <div class="wallet-topbar-actions">
            <button
              id="copy-address-button"
              type="button"
              class="wallet-icon-button"
              aria-label="Copy wallet address"
            >
              Copy
            </button>
            <a
              id="open-qwantify-link"
              class="wallet-icon-button"
              href="https://www.qwantify.io/app/wallets/"
              target="_blank"
              rel="noreferrer"
            >
              Qwantify
            </a>
            <button id="follow-wallet-button" class="wallet-primary-button" type="button">
              Add To Tracked
            </button>
            <button id="refresh-button" class="wallet-secondary-button" type="button">
              Refresh
            </button>
          </div>
        </header>

        <section class="wallet-toolbar-card">
          <div class="wallet-toolbar">
            <input
              id="address-input"
              type="text"
              placeholder="0xadD12ADBbD5Db87674b38Af99b6dD34Dd2A45e0d"
              spellcheck={false}
              autocomplete="off"
            />
            <button id="lookup-button" class="wallet-primary-button" type="button">
              Load Wallet
            </button>
          </div>
          <p id="address-error" class="address-error" aria-live="polite"></p>
        </section>

        <section class="wallet-section">
          <div class="wallet-section-heading">
            <h2>Account Overview</h2>
            <p>Snapshot • Spot + Perps + Staked</p>
          </div>

          <div class="wallet-overview-grid">
            <article class="wallet-overview-card">
              <div class="wallet-card-label">Total Equity</div>
              <div id="metric-total-equity" class="wallet-card-value">
                —
              </div>
              <div class="wallet-progress">
                <div id="metric-total-equity-bar" class="wallet-progress-bar accent"></div>
              </div>
              <div id="metric-total-equity-subtext" class="wallet-card-subtext mono">
                Spot 0% • Perps 0% • Staked 0%
              </div>
            </article>

            <article class="wallet-overview-card">
              <div class="wallet-card-label">Realized PnL (All Time)</div>
              <div id="metric-realized-pnl" class="wallet-card-value">
                —
              </div>
              <div class="wallet-mini-grid">
                <div class="wallet-mini-pill">
                  <span>24h</span>
                  <strong id="metric-realized-pnl-day">—</strong>
                </div>
                <div class="wallet-mini-pill">
                  <span>7d</span>
                  <strong id="metric-realized-pnl-week">—</strong>
                </div>
              </div>
            </article>

            <article class="wallet-overview-card">
              <div class="wallet-card-label">Margin Utilization</div>
              <div id="metric-margin-utilization" class="wallet-card-value">
                —
              </div>
              <div class="wallet-progress">
                <div id="metric-margin-utilization-bar" class="wallet-progress-bar warning"></div>
              </div>
              <div id="metric-margin-utilization-subtext" class="wallet-card-subtext mono">
                Used — / Perp equity —
              </div>
            </article>

            <article class="wallet-overview-card">
              <div class="wallet-card-label">Risk Profile</div>
              <div id="metric-risk-profile" class="wallet-card-value">
                —
              </div>
              <div class="wallet-progress dual">
                <div id="metric-risk-long-bar" class="wallet-progress-bar positive"></div>
                <div id="metric-risk-short-bar" class="wallet-progress-bar negative"></div>
              </div>
              <div id="metric-risk-profile-subtext" class="wallet-card-subtext mono">
                Long — • Short —
              </div>
            </article>
          </div>
        </section>

        <section class="wallet-section">
          <div class="wallet-section-heading">
            <h2>Performance &amp; Allocation</h2>
            <p>Perp or perp + spot history alongside current account mix.</p>
          </div>

          <div class="wallet-performance-grid">
            <article class="wallet-panel-card">
              <div class="wallet-panel-head">
                <div>
                  <h3>Performance chart</h3>
                </div>

                <div class="wallet-panel-controls">
                  <div id="chart-type-toggle" class="wallet-toggle-group">
                    <button type="button" data-chart-type="pnl" class="active">
                      PnL
                    </button>
                    <button type="button" data-chart-type="accountValue">
                      Account value
                    </button>
                  </div>

                  <div id="chart-scope-toggle" class="wallet-toggle-group">
                    <button type="button" data-chart-scope="perp">
                      Perp
                    </button>
                    <button type="button" data-chart-scope="total" class="active">
                      Perp + Spot
                    </button>
                  </div>

                  <div id="chart-window-toggle" class="wallet-toggle-group">
                    <button type="button" data-chart-window="day">
                      24h
                    </button>
                    <button type="button" data-chart-window="week">
                      7d
                    </button>
                    <button type="button" data-chart-window="month" class="active">
                      30d
                    </button>
                    <button type="button" data-chart-window="allTime">
                      All
                    </button>
                  </div>
                </div>
              </div>

              <div class="wallet-chart-shell">
                <svg
                  id="wallet-performance-chart"
                  class="wallet-performance-chart"
                  viewBox="0 0 1200 420"
                  role="img"
                  aria-label="Wallet performance chart"
                  preserveAspectRatio="none"
                ></svg>
                <div id="wallet-performance-empty" class="wallet-chart-empty">
                  Loading performance…
                </div>
              </div>
            </article>

            <aside class="wallet-panel-card wallet-composition-card">
              <div class="wallet-panel-head compact">
                <div>
                  <h3>Account composition</h3>
                  <p>Spot vs staked HYPE vs perps (perp equity).</p>
                </div>
              </div>

              <div class="wallet-composition-shell">
                <div id="wallet-composition-donut" class="wallet-composition-donut">
                  <div class="wallet-composition-center">
                    <span>Total</span>
                    <strong id="wallet-composition-total">—</strong>
                  </div>
                </div>
                <div id="wallet-composition-legend" class="wallet-composition-legend"></div>
              </div>
            </aside>
          </div>
        </section>

        <section class="wallet-section">
          <div id="wallet-tabbar" class="wallet-tabbar">
            <button type="button" data-tab="positions" class="active">
              Positions
            </button>
            <button type="button" data-tab="fills">
              Recent Fills
            </button>
            <button type="button" data-tab="holdings">
              Holdings
            </button>
            <button type="button" data-tab="notional">
              Notional Deltas
            </button>
            <button type="button" data-tab="statistics">
              Statistics
            </button>
          </div>

          <div class="wallet-tab-content">
            <section data-tab-panel="positions" class="wallet-panel-card wallet-tab-panel active">
              <div class="wallet-substats">
                <div class="wallet-substat">
                  <span>Long</span>
                  <strong id="positions-long-total">—</strong>
                </div>
                <div class="wallet-substat">
                  <span>Short</span>
                  <strong id="positions-short-total">—</strong>
                </div>
                <div class="wallet-substat">
                  <span>Perp Equity</span>
                  <strong id="positions-equity-total">—</strong>
                </div>
                <div class="wallet-substat">
                  <span>Notional</span>
                  <strong id="positions-notional-total">—</strong>
                </div>
              </div>

              <div class="wallet-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Size</th>
                      <th>Entry</th>
                      <th>Mark</th>
                      <th>Position Value</th>
                      <th>Unrealized PnL</th>
                      <th>ROE</th>
                      <th>Funding</th>
                      <th>Liq. Price</th>
                    </tr>
                  </thead>
                  <tbody id="positions-body">
                    <tr class="wallet-empty-row">
                      <td colspan="9">Load a wallet to see current positions.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section data-tab-panel="fills" class="wallet-panel-card wallet-tab-panel">
              <div class="wallet-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Symbol</th>
                      <th>Direction</th>
                      <th>Size</th>
                      <th>Price</th>
                      <th>Closed PnL</th>
                      <th>Fee</th>
                    </tr>
                  </thead>
                  <tbody id="fills-body">
                    <tr class="wallet-empty-row">
                      <td colspan="7">Load a wallet to see recent fills.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section data-tab-panel="holdings" class="wallet-panel-card wallet-tab-panel">
              <div class="wallet-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Coin</th>
                      <th>Total</th>
                      <th>Available</th>
                      <th>Value</th>
                      <th>Avg Entry</th>
                      <th>Unrealized</th>
                    </tr>
                  </thead>
                  <tbody id="holdings-body">
                    <tr class="wallet-empty-row">
                      <td colspan="6">Load a wallet to see spot and staked holdings.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section data-tab-panel="notional" class="wallet-panel-card wallet-tab-panel">
              <div class="wallet-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Δ1H</th>
                      <th>Δ4H</th>
                      <th>Δ12H</th>
                      <th>Δ1D</th>
                      <th>Δ7D</th>
                    </tr>
                  </thead>
                  <tbody id="notional-deltas-body">
                    <tr class="wallet-empty-row">
                      <td colspan="6">Load a wallet to see Qwantify net notional deltas.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section data-tab-panel="statistics" class="wallet-panel-card wallet-tab-panel">
              <div id="wallet-statistics-grid" class="wallet-statistics-grid">
                <article class="wallet-stat-card">
                  <span class="label">All-Time PnL</span>
                  <strong id="stat-all-time-pnl">—</strong>
                </article>
                <article class="wallet-stat-card">
                  <span class="label">30D PnL</span>
                  <strong id="stat-month-pnl">—</strong>
                </article>
                <article class="wallet-stat-card">
                  <span class="label">Recent Fills</span>
                  <strong id="stat-recent-fills">—</strong>
                </article>
                <article class="wallet-stat-card">
                  <span class="label">Open Positions</span>
                  <strong id="stat-open-positions">—</strong>
                </article>
                <article class="wallet-stat-card">
                  <span class="label">Spot Assets</span>
                  <strong id="stat-spot-assets">—</strong>
                </article>
                <article class="wallet-stat-card">
                  <span class="label">Tracked Wallets</span>
                  <strong id="stat-tracked-wallets">—</strong>
                </article>
              </div>
            </section>
          </div>
        </section>
      </main>
    </>
  );
}
