import { Navbar } from "../components/navbar";
import { AssetDashboard } from "../components/asset-dashboard";
import { useBodyClass } from "../lib/use-body-class";

export function HomePage() {
  useBodyClass("asset-shell-page");

  return (
    <>
      <Navbar mode="asset" />
      <main class="asset-page-shell bg-transparent text-[#a0adbe]">
        <AssetDashboard />
      </main>
    </>
  );
}
