import { Link } from "react-router-dom";
import { cx } from "../lib/cx";
import {
  formatCount,
  formatCurrency,
  formatPercent,
  shortAddress,
} from "../lib/formatters";
import {
  getAverageEntry,
  getAverageTradeSize,
  getShareOfWindow,
  splitVolume,
} from "../lib/marketFlow";

function resolveLabel(labels, wallet) {
  return labels?.[wallet.trim().toLowerCase()];
}

export default function ParticipantListCard({
  title,
  rows,
  labels,
  mode,
  tone = "neutral",
  volumeDelta,
}) {
  const toneClassName =
    tone === "positive"
      ? "text-profit"
      : tone === "negative"
        ? "text-loss"
        : "text-foreground";
  const totalVolume =
    volumeDelta &&
    Number.isFinite(volumeDelta.buyUsd) &&
    Number.isFinite(volumeDelta.sellUsd)
      ? (volumeDelta.buyUsd ?? 0) + (volumeDelta.sellUsd ?? 0)
      : null;

  return (
    <section className="rounded-sm border border-border bg-card">
      <div className="p-6 pb-4">
        <h3 className="text-lg font-light text-foreground">{title}</h3>
        {mode === "total" && totalVolume !== null ? (
          <div className="mt-2 text-sm text-muted-foreground">
            Total volume (maker + taker): {formatCurrency(totalVolume, 2)}
          </div>
        ) : null}
      </div>

      <div className="px-6 pb-6">
        {rows.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No data yet.</p> : null}

        <div className="space-y-0 text-sm">
          {rows.map((row, index) => {
            const label = resolveLabel(labels, row.wallet);
            const displayName = label?.name || shortAddress(row.wallet);
            const subtitle = label?.name ? row.wallet : null;
            const averageEntry = getAverageEntry(row);
            const averageTradeSize = getAverageTradeSize(row);
            const shareOfWindow = getShareOfWindow(row.totalUsd, volumeDelta);
            const { buyUsd, sellUsd } = splitVolume(row);

            return (
              <Link
                key={`${row.wallet}-${index}`}
                className="-mx-2 flex items-center justify-between gap-4 rounded-sm border-b border-border px-2 py-3 transition-colors last:border-b-0 hover:bg-muted/30"
                to={`/app/wallets/${encodeURIComponent(row.wallet.trim())}`}
                title="View wallet summary"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="w-6 text-xs font-mono tabular-nums text-muted-foreground">
                    #{index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-foreground">{displayName}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {subtitle ?? row.wallet}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  {mode === "net" ? (
                    <>
                      <span className={cx("tabular-nums font-medium", toneClassName)}>
                        {formatCurrency(Math.abs(row.netUsd), 2)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Trades {formatCount(row.tradeCount)} · Avg entry{" "}
                        {averageEntry === null ? "—" : formatCurrency(averageEntry, 2)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="tabular-nums font-medium text-foreground">
                        {formatCurrency(row.totalUsd, 2)}{" "}
                        <span className="text-[11px] text-muted-foreground">
                          ({shareOfWindow === null ? "—" : formatPercent(shareOfWindow)})
                        </span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Buy {formatCurrency(buyUsd, 2)} · Sell {formatCurrency(sellUsd, 2)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Trades {formatCount(row.tradeCount)} · Avg size{" "}
                        {averageTradeSize === null ? "—" : formatCurrency(averageTradeSize, 2)}
                      </span>
                    </>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
