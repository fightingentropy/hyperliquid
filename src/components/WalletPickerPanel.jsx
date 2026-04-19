import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { cx } from "../lib/cx";
import { shortAddress } from "../lib/formatters";
import { isValidEvmAddress } from "../lib/wallet";
import { useWallets } from "../hooks/useWallets";
import WalletFormModal from "./WalletFormModal";

function getWalletLabel(wallet) {
  const label = String(wallet.label ?? "").trim();

  return label.length ? label : shortAddress(wallet.address);
}

export default function WalletPickerPanel({
  value,
  onChange,
  onSubmit,
  activeAddress = "",
}) {
  const { wallets, addWallet, removeWallet } = useWallets();
  const [modalOpen, setModalOpen] = useState(false);

  const trimmedValue = value.trim();
  const valid = isValidEvmAddress(trimmedValue);
  const normalizedActiveAddress = activeAddress.trim().toLowerCase();

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!valid) {
      return;
    }

    onSubmit(trimmedValue);
  };

  const handleRemove = (event, address) => {
    event.preventDefault();
    event.stopPropagation();
    removeWallet(address);
  };

  return (
    <section className="rounded-sm border border-border bg-card px-4 py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
            My Wallets
          </div>

          <div className="flex flex-wrap gap-2">
            {wallets.map((wallet) => {
              const isActive =
                normalizedActiveAddress.length > 0 &&
                wallet.address.toLowerCase() === normalizedActiveAddress;

              return (
                <Link
                  key={wallet.address}
                  to={`/app/wallets/${wallet.address}`}
                  className={cx(
                    "qf-wallet-chip group inline-flex min-h-10 items-center gap-1.5 rounded-sm border px-3 text-sm transition",
                    isActive
                      ? "is-active border-border bg-[#202024]"
                      : "border-border hover:bg-[#202024]",
                  )}
                  title={wallet.address}
                >
                  <span>{getWalletLabel(wallet)}</span>
                  {!wallet.isDefault ? (
                    <button
                      type="button"
                      onClick={(event) => handleRemove(event, wallet.address)}
                      aria-label={`Remove ${getWalletLabel(wallet)}`}
                      className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground transition hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                </Link>
              );
            })}

            <button
              type="button"
              onClick={() => setModalOpen(true)}
              aria-label="Add wallet"
              title="Add wallet"
              className="inline-flex size-10 items-center justify-center rounded-sm border border-dashed border-border text-muted-foreground transition hover:border-border hover:bg-[#202024] hover:text-foreground"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-2xl flex-col gap-3 sm:flex-row"
        >
          <div className="w-full space-y-1">
            <input
              type="text"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="0x..."
              aria-label="Wallet address"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full rounded-sm border border-border bg-background px-3 font-mono text-sm text-foreground outline-none transition focus:border-ring"
            />
            {trimmedValue.length > 0 && !valid ? (
              <div className="text-xs text-muted-foreground">
                Must be a valid EVM address (0x + 40 hex characters).
              </div>
            ) : null}
          </div>

          <button
            type="submit"
            className="h-11 whitespace-nowrap rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition sm:min-w-[7.5rem] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!valid}
          >
            View Wallet
          </button>
        </form>
      </div>

      <WalletFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={({ address, label }) => addWallet(address, label)}
        title="Add wallet"
        submitLabel="Save wallet"
      />
    </section>
  );
}
