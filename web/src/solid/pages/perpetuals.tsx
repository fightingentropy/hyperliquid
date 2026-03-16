import { Navbar } from "../components/navbar";
import { useBodyClass } from "../lib/use-body-class";
import { useModuleMount } from "../lib/use-module-mount";

export function PerpetualsPage() {
  useBodyClass("perpetuals-page");
  useModuleMount(async () => {
    // @ts-expect-error legacy JS mount module
    const mod = await import("../legacy/perpetuals.js");
    return mod.mountPerpetualsPage();
  });

  return (
    <>
      <Navbar />
      <main class="layout perpetuals-layout">
        <section class="panel perpetuals-panel">
          <div class="perpetuals-toolbar">
            <div class="search">
              <input id="market-search" type="text" placeholder="Search..." />
            </div>
            <div class="segmented" id="metric-toggle">
              <button data-sort="screener" class="active">
                Screener
              </button>
              <button data-sort="funding">Funding</button>
              <button data-sort="volume">Volume</button>
              <button data-sort="openInterest">Open Interest</button>
            </div>
          </div>

          <div class="table-wrap perpetuals-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Price</th>
                  <th>24H Trend</th>
                  <th>Chg % (1D)</th>
                  <th>Chg % (1H)</th>
                  <th>OI $</th>
                  <th>OI Chg (1D)</th>
                  <th>OI Chg (1H)</th>
                  <th>Vol (1D)</th>
                  <th>L/S</th>
                </tr>
              </thead>
              <tbody id="market-body"></tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
