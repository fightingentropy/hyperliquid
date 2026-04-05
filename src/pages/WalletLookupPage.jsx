import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import WalletPickerPanel from "../components/WalletPickerPanel";

export default function WalletLookupPage() {
  const navigate = useNavigate();
  const [walletInput, setWalletInput] = useState("");

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Qwantify";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  const handleWalletJump = (nextWalletAddress) => {
    navigate(`/app/wallets/${encodeURIComponent(nextWalletAddress)}`);
  };

  return (
    <div className="space-y-6">
      <WalletPickerPanel
        value={walletInput}
        onChange={setWalletInput}
        onSubmit={handleWalletJump}
      />

      <div className="rounded-sm border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        Choose one of your pinned wallets above or paste any EVM address to open its wallet view.
      </div>
    </div>
  );
}
