import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import WalletPickerPanel from "../components/WalletPickerPanel";

export default function WalletLookupPage() {
  const navigate = useNavigate();
  const [walletInput, setWalletInput] = useState("");

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Hyperliquid";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  const handleWalletJump = (nextWalletAddress) => {
    navigate(`/wallets/${encodeURIComponent(nextWalletAddress)}`);
  };

  return (
    <div className="space-y-6">
      <WalletPickerPanel
        value={walletInput}
        onChange={setWalletInput}
        onSubmit={handleWalletJump}
        showWallets={false}
      />

      <div className="rounded-sm border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        Paste any EVM address to open its wallet view. The wallets you track, with their
        positioning and flows, are under{" "}
        <Link to="/tracked" className="text-foreground underline-offset-2 hover:underline">
          Tracked Wallets
        </Link>
        .
      </div>
    </div>
  );
}
