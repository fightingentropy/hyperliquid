import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { isValidEvmAddress } from "../lib/wallet";

export default function WalletFormModal({
  open,
  onClose,
  onSubmit,
  initialAddress = "",
  initialLabel = "",
  title = "Add wallet",
  submitLabel = "Save wallet",
  lockAddress = false,
}) {
  const [label, setLabel] = useState(initialLabel);
  const [address, setAddress] = useState(initialAddress);
  const [error, setError] = useState("");
  const labelId = useId();
  const addressId = useId();
  const labelInputRef = useRef(null);
  const addressInputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setLabel(initialLabel);
    setAddress(initialAddress);
    setError("");
  }, [open, initialAddress, initialLabel]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusTarget = lockAddress || initialAddress
      ? labelInputRef.current
      : addressInputRef.current;
    focusTarget?.focus();
    focusTarget?.select?.();
  }, [open, lockAddress, initialAddress]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const trimmedAddress = address.trim();
  const trimmedLabel = label.trim();
  const addressValid = isValidEvmAddress(trimmedAddress);

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!addressValid) {
      setError("Must be a valid EVM address (0x + 40 hex characters).");
      return;
    }

    if (!trimmedLabel) {
      setError("Label is required.");
      return;
    }

    const result = onSubmit({ address: trimmedAddress, label: trimmedLabel });

    if (result === false) {
      setError("That wallet is already in your list.");
      return;
    }

    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${labelId}-dialog-title`}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md rounded-sm border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id={`${labelId}-dialog-title`}
              className="text-base font-medium text-foreground"
            >
              {title}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Label a wallet to save it to your sidebar picker.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-sm border border-border text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="space-y-1">
            <label
              htmlFor={labelId}
              className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground"
            >
              Label
            </label>
            <input
              id={labelId}
              ref={labelInputRef}
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. My main wallet"
              maxLength={40}
              className="h-10 w-full rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-ring"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor={addressId}
              className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground"
            >
              Address
            </label>
            <input
              id={addressId}
              ref={addressInputRef}
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
              readOnly={lockAddress}
              className="h-10 w-full rounded-sm border border-border bg-background px-3 font-mono text-sm text-foreground outline-none transition focus:border-ring disabled:opacity-70"
            />
          </div>

          {error ? (
            <div className="text-xs text-[color:var(--destructive,#f87171)]">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-sm border border-border bg-transparent px-4 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!addressValid || !trimmedLabel}
              className="h-10 rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
