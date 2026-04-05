import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isValidEvmAddress } from "../lib/wallet";

export default function WalletLookupPage() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const trimmedValue = value.trim();
  const valid = isValidEvmAddress(trimmedValue);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Qwantify";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!valid) {
      return;
    }

    navigate(`/app/wallets/${encodeURIComponent(trimmedValue)}`, {
      state: { origin: "/app/wallets" },
    });
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-xl space-y-5">
        <div className="space-y-2 text-center">
          <p className="text-base text-muted-foreground">
            Enter a wallet address to view its performance breakdown.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-full space-y-1">
            <input
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="0x..."
              aria-label="Wallet address"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full rounded-sm border border-border bg-card px-3 font-mono text-sm text-foreground outline-none transition focus:border-ring"
            />
            {trimmedValue.length > 0 && !valid ? (
              <div className="text-xs text-muted-foreground">
                Must be a valid EVM address (0x + 40 hex characters).
              </div>
            ) : null}
          </div>

          <button
            type="submit"
            className="h-11 rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!valid}
          >
            View Summary
          </button>
        </form>
      </div>
    </div>
  );
}
