import { Navbar } from "../components/navbar";
import { PageOrbs } from "../components/page-orbs";
import { useBodyClass } from "../lib/use-body-class";

export function AboutPage() {
  useBodyClass("app-shell-page");
  return (
    <>
      <PageOrbs />
      <Navbar />

      <header class="hero about-hero">
        <div class="hero-content">
          <p class="eyebrow">Hyperliquid Intelligence</p>
          <h1>About HL Stats</h1>
          <p class="lede">
            HL Stats is a lightweight dashboard for scanning the largest Hyperliquid accounts. It
            highlights top open positions, clusters liquidation exposure, and lets you drill into
            each wallet in context.
          </p>
        </div>
        <div class="hero-metrics">
          <div class="metric">
            <span class="label">Dashboards</span>
            <span class="value">4 core views</span>
          </div>
          <div class="metric">
            <span class="label">Assets</span>
            <span class="value">HYPE, BTC, ETH</span>
          </div>
          <div class="metric">
            <span class="label">Data Sources</span>
            <span class="value">3 endpoints</span>
          </div>
        </div>
      </header>

      <main class="layout about-layout">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>What It Tracks</h2>
              <p class="muted">
                Actionable snapshots of size, risk, and positioning across Hyperliquid leaderboard
                accounts.
              </p>
            </div>
          </div>

          <div class="about-grid">
            <div class="about-card">
              <h3>Pulse</h3>
              <p class="muted">
                Ranks the largest open positions by notional value for HYPE, BTC, and ETH, so you
                can see where the concentration sits.
              </p>
            </div>
            <div class="about-card">
              <h3>Liquidation Clusters</h3>
              <p class="muted">
                Buckets liquidation prices into ranges to show stacked risk zones and the
                long/short bias at each level.
              </p>
            </div>
            <div class="about-card">
              <h3>Account Detail</h3>
              <p class="muted">
                Click any wallet to inspect open positions, liquidation history, and key account
                stats with a direct link to the explorer.
              </p>
            </div>
            <div class="about-card">
              <h3>Unstaking Queue</h3>
              <p class="muted">
                Visualizes HYPE tokens in the 7-day unstaking queue, with daily unlock schedules and
                the largest pending withdrawals.
              </p>
            </div>
            <div class="about-card">
              <h3>Settings</h3>
              <p class="muted">
                Tune scan limits, bucket sizes, and display preferences. Settings save locally in
                your browser.
              </p>
            </div>
          </div>

          <div class="detail-section">
            <div class="section-header">
              <h3>How It Works</h3>
            </div>
            <ul class="about-list">
              <li>
                <strong>Leaderboard focus</strong>
                <span class="muted">
                  Uses the largest Hyperliquid accounts to surface market-wide positioning signals.
                </span>
              </li>
              <li>
                <strong>Asset toggles</strong>
                <span class="muted">
                  Switch between HYPE, BTC, and ETH views without losing your selected wallet
                  context.
                </span>
              </li>
              <li>
                <strong>On-demand refresh</strong>
                <span class="muted">
                  Refresh buttons pull the latest public snapshot so you can re-check conditions
                  quickly.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <aside class="panel detail-panel">
          <div class="panel-header">
            <div>
              <h2>Data + Usage</h2>
              <p class="muted">Built for quick reads, not heavy spreadsheets.</p>
            </div>
          </div>

          <div class="detail-section">
            <div class="about-callout">
              <h3>Browser-first</h3>
              <p class="muted">
                HL Stats runs entirely in your browser and stores view preferences locally to keep
                repeat visits fast.
              </p>
            </div>
          </div>

          <div class="detail-section">
            <div class="section-header">
              <h3>Data Sources</h3>
            </div>
            <div class="about-meta">
              <p class="muted">
                Market and leaderboard data are pulled from Hyperliquid public endpoints:
              </p>
              <div class="stat">
                <span class="label">Leaderboard</span>
                <span class="value mono">stats-data.hyperliquid.xyz</span>
              </div>
              <div class="stat">
                <span class="label">Account + Market</span>
                <span class="value mono">api.hyperliquid.xyz</span>
              </div>
              <div class="stat">
                <span class="label">Staking Data</span>
                <span class="value mono">api.hypurrscan.io</span>
              </div>
            </div>
          </div>
        </aside>
      </main>

      <footer class="footer">
        <p>Data: stats-data.hyperliquid.xyz + api.hyperliquid.xyz</p>
      </footer>
    </>
  );
}
