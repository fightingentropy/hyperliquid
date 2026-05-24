import { ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";

const COINGLASS_LIQUIDATION_MAP_URL =
  "https://www.coinglass.com/hyperliquid-liquidation-map";

export default function LiquidationMapPage() {
  const [frameKey, setFrameKey] = useState(0);

  return (
    <div className="qf-embed-page">
      <section className="qf-embed-page__header">
        <div className="qf-embed-page__copy">
          <p className="text-sm text-muted-foreground">
            CoinGlass Hyperliquid whale liquidations in a live embedded view, including real-time
            liquidation activity and price-level distribution.
          </p>
        </div>

        <div className="qf-embed-page__actions">
          <button
            type="button"
            className="qf-embed-page__button"
            onClick={() => setFrameKey((key) => key + 1)}
            aria-label="Reload liquidation map"
            title="Reload liquidation map"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Reload</span>
          </button>

          <a
            href={COINGLASS_LIQUIDATION_MAP_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="qf-embed-page__button qf-embed-page__button--primary"
            aria-label="Open liquidation map on CoinGlass"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            <span>Open source</span>
          </a>
        </div>
      </section>

      <section className="qf-embed-frame" aria-label="CoinGlass Hyperliquid liquidation map">
        <iframe
          key={frameKey}
          title="CoinGlass Hyperliquid liquidation map"
          src={COINGLASS_LIQUIDATION_MAP_URL}
          className="qf-embed-frame__iframe"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </section>
    </div>
  );
}
