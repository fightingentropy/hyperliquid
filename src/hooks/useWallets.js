import { useCallback, useEffect, useMemo, useState } from "react";
import { PINNED_WALLETS, isValidEvmAddress } from "../lib/wallet";

const STORAGE_KEY = "hl-custom-wallets";
const CHANGE_EVENT = "hl-custom-wallets-changed";

const DEFAULT_ADDRESS_KEYS = new Set(
  PINNED_WALLETS.map((wallet) => wallet.address.toLowerCase()),
);

function readStorage() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => ({
        address: String(entry?.address ?? "").trim(),
        label: String(entry?.label ?? "").trim(),
      }))
      .filter((entry) => isValidEvmAddress(entry.address));
  } catch {
    return [];
  }
}

function writeStorage(wallets) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useWallets() {
  const [customWallets, setCustomWallets] = useState(() => readStorage());

  useEffect(() => {
    const syncFromStorage = () => setCustomWallets(readStorage());

    window.addEventListener(CHANGE_EVENT, syncFromStorage);
    window.addEventListener("storage", syncFromStorage);

    return () => {
      window.removeEventListener(CHANGE_EVENT, syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  const wallets = useMemo(() => {
    const seen = new Set();
    const merged = [];

    for (const wallet of PINNED_WALLETS) {
      const key = wallet.address.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push({ ...wallet, isDefault: true });
    }

    for (const wallet of customWallets) {
      const key = wallet.address.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push({ ...wallet, isDefault: false });
    }

    return merged;
  }, [customWallets]);

  const addWallet = useCallback((address, label) => {
    const trimmedAddress = String(address ?? "").trim();
    const trimmedLabel = String(label ?? "").trim();

    if (!isValidEvmAddress(trimmedAddress)) {
      return false;
    }

    const key = trimmedAddress.toLowerCase();
    if (DEFAULT_ADDRESS_KEYS.has(key)) {
      return false;
    }

    const current = readStorage();
    const next = current.filter((entry) => entry.address.toLowerCase() !== key);
    next.push({ address: trimmedAddress, label: trimmedLabel });
    writeStorage(next);
    return true;
  }, []);

  const removeWallet = useCallback((address) => {
    const key = String(address ?? "").trim().toLowerCase();
    if (!key || DEFAULT_ADDRESS_KEYS.has(key)) {
      return;
    }

    const current = readStorage();
    writeStorage(current.filter((entry) => entry.address.toLowerCase() !== key));
  }, []);

  const isSaved = useCallback(
    (address) => {
      const key = String(address ?? "").trim().toLowerCase();
      return key.length > 0 && wallets.some((wallet) => wallet.address.toLowerCase() === key);
    },
    [wallets],
  );

  return { wallets, customWallets, addWallet, removeWallet, isSaved };
}
