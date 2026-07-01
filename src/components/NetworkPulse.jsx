import { fetchNetworkFeeStats } from "../api/hypurrscan";
import { useActiveTwaps } from "../hooks/useActiveTwaps";
import { usePollingResource } from "../hooks/usePollingResource";
import ActiveTwapsCard from "./ActiveTwapsCard";
import NetworkFeesCard from "./NetworkFeesCard";
import TwapPressureCard from "./TwapPressureCard";

// Live HypurrScan dashboard stats: network-wide 24h fees, the projected HYPE
// spot TWAP buy/sell pressure, and the network-wide active TWAP table.
export default function NetworkPulse() {
  const feesResource = usePollingResource(fetchNetworkFeeStats, [], {
    intervalMs: 300_000,
    initialData: null,
    cacheKey: "hypurrscan:fees",
    staleTimeMs: 120_000,
  });

  const twaps = useActiveTwaps();

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4">
        <NetworkFeesCard
          data={feesResource.data}
          loading={feesResource.isLoading}
          error={feesResource.error}
        />
        <TwapPressureCard
          activeTwaps={twaps.hypeSpotTwaps}
          loading={twaps.isLoading}
          error={twaps.error}
        />
      </div>

      <div className="lg:col-span-2">
        <ActiveTwapsCard
          rows={twaps.activeTwaps}
          loading={twaps.isLoading}
          error={twaps.error}
        />
      </div>
    </section>
  );
}
