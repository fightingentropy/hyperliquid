import { fetchHypeTwapPressure, fetchNetworkFeeStats } from "../api/hypurrscan";
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

  const twapResource = usePollingResource(fetchHypeTwapPressure, [], {
    intervalMs: 60_000,
    initialData: null,
    cacheKey: "hypurrscan:twap-pressure",
    staleTimeMs: 30_000,
  });

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <NetworkFeesCard
        data={feesResource.data}
        loading={feesResource.isLoading}
        error={feesResource.error}
      />
      <TwapPressureCard
        activeTwaps={twapResource.data?.activeTwaps}
        loading={twapResource.isLoading}
        error={twapResource.error}
      />
    </section>
  );
}
