import { fetchNetworkFeeStats } from "../api/hypurrscan";
import { useHypeTwapPressure } from "../hooks/useHypeTwapPressure";
import { usePollingResource } from "../hooks/usePollingResource";
import NetworkFeesCard from "./NetworkFeesCard";
import TwapPressureCard from "./TwapPressureCard";

// Live HypurrScan dashboard stats: network-wide 24h fees and the projected HYPE
// spot TWAP buy/sell pressure.
export default function NetworkPulse() {
  const feesResource = usePollingResource(fetchNetworkFeeStats, [], {
    intervalMs: 300_000,
    initialData: null,
    cacheKey: "hypurrscan:fees",
    staleTimeMs: 120_000,
  });

  const twap = useHypeTwapPressure();

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <NetworkFeesCard
        data={feesResource.data}
        loading={feesResource.isLoading}
        error={feesResource.error}
      />
      <TwapPressureCard
        activeTwaps={twap.activeTwaps}
        loading={twap.isLoading}
        error={twap.error}
      />
    </section>
  );
}
