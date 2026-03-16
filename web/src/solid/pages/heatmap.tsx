import { Navbar } from "../components/navbar";
import { useBodyClass } from "../lib/use-body-class";
import { useModuleMount } from "../lib/use-module-mount";

export function HeatmapPage() {
  useBodyClass("perpetuals-page heatmap-page");
  useModuleMount(async () => {
    // @ts-expect-error legacy JS mount module
    const mod = await import("../legacy/heatmap.js");
    return mod.mountHeatmapPage();
  });

  return (
    <>
      <Navbar />
      <main class="layout perpetuals-layout">
        <section class="panel perpetuals-panel">
          <div class="perpetuals-toolbar">
            <div class="search">
              <input id="heatmap-search" type="text" placeholder="Search..." />
            </div>
            <div class="segmented" id="heatmap-metric">
              <button data-metric="change1d" class="active">
                1D Change
              </button>
              <button data-metric="oi1h">OI Chg 1H</button>
              <button data-metric="oi1d">OI Chg 1D</button>
            </div>
          </div>
          <div id="heatmap-grid" class="heatmap-grid"></div>
        </section>
      </main>
    </>
  );
}
