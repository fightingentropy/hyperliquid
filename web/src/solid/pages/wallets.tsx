import { A } from "@solidjs/router";
import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import { Navbar } from "../components/navbar";
import { PageOrbs } from "../components/page-orbs";
import { useBodyClass } from "../lib/use-body-class";

const FOLLOWED_WALLETS_KEY = "hl-followed-wallets-v2";
const DEFAULT_FOLLOWED_WALLETS = [
  "0xaf0FDd39e5D92499B0eD9F68693DA99C0ec1e92e",
  "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae",
  "0xcb58b8f5ec6d47985f0728465c25a08ef9ad2c7b",
  "0xadD12ADBbD5Db87674b38Af99b6dD34Dd2A45e0d",
  "0x519c721de735f7c9e6146d167852e60d60496a47",
  "0x4cb5f4d145cd16460932bbb9b871bb6fd5db97e3",
  "0x9c2a2a966ed8e47f0c8b7e2ec2b91424f229f6a8",
] as const;
const DEFAULT_FOLLOWED_WALLET_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "0xaf0fdd39e5d92499b0ed9f68693da99c0ec1e92e": "purple surfer",
  "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae": "loracle",
  "0xcb58b8f5ec6d47985f0728465c25a08ef9ad2c7b": "CL",
  "0xadd12adbbd5db87674b38af99b6dd34dd2a45e0d": "nexus",
  "0x519c721de735f7c9e6146d167852e60d60496a47": "Hyper Longer",
  "0x9c2a2a966ed8e47f0c8b7e2ec2b91424f229f6a8": "Phantom Yak",
});
const PREFERRED_FOLLOWED_WALLET_CASE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(DEFAULT_FOLLOWED_WALLETS.map((address) => [address.trim().toLowerCase(), address])),
);

type WalletTabKey = "system" | "team" | "mine";
type WalletRow = {
  address: string;
  label: string | null;
  namespace: "EVM";
  type: "Tracked";
  linkedEntity: string;
  createdAt: string;
};

const WALLET_TABS: Array<{ key: WalletTabKey; label: string }> = [
  { key: "system", label: "System Wallets" },
  { key: "team", label: "Team Wallets" },
  { key: "mine", label: "My Wallets" },
];

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function addressKey(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeAddress(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!isAddress(trimmed)) return null;
  return PREFERRED_FOLLOWED_WALLET_CASE[addressKey(trimmed)] || trimmed;
}

function formatAddressShort(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function walletLabel(address: string) {
  return DEFAULT_FOLLOWED_WALLET_LABELS[addressKey(address)] ?? null;
}

function normalizeWalletList(candidates: readonly string[]) {
  const seen = new Set<string>();
  const wallets: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeAddress(candidate);
    const key = addressKey(normalized);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    wallets.push(normalized);
  }
  return wallets;
}

function loadFollowedWallets() {
  const defaults = normalizeWalletList(DEFAULT_FOLLOWED_WALLETS);
  if (typeof window === "undefined") return defaults.slice();

  try {
    const raw = window.localStorage.getItem(FOLLOWED_WALLETS_KEY);
    if (!raw) return defaults.slice();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults.slice();
    const wallets = normalizeWalletList(parsed);
    if (!wallets.length) return defaults.slice();
    for (const wallet of defaults) {
      if (!wallets.some((entry) => addressKey(entry) === addressKey(wallet))) {
        wallets.push(wallet);
      }
    }
    return wallets;
  } catch {
    return defaults.slice();
  }
}

function saveFollowedWallets(wallets: readonly string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FOLLOWED_WALLETS_KEY, JSON.stringify(wallets));
  } catch {
    // Ignore storage failures.
  }
}

function copyToClipboard(value: string) {
  if (typeof navigator === "undefined") return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).catch(() => {});
  }
}

export function WalletsPage() {
  useBodyClass("app-shell-page wallet-page wallets-index-page");

  const [activeTab, setActiveTab] = createSignal<WalletTabKey>("mine");
  const [search, setSearch] = createSignal("");
  const [followedWallets, setFollowedWallets] = createSignal<string[]>(loadFollowedWallets());

  onMount(() => {
    const syncWallets = () => setFollowedWallets(loadFollowedWallets());
    syncWallets();
    window.addEventListener("storage", syncWallets);
    onCleanup(() => window.removeEventListener("storage", syncWallets));
  });

  const rows = createMemo<Record<WalletTabKey, WalletRow[]>>(() => {
    const mine = followedWallets().map((address) => {
      const label = walletLabel(address);
      return {
        address,
        label,
        namespace: "EVM" as const,
        type: "Tracked" as const,
        linkedEntity: label ? `${label} wallet` : "Tracked wallet",
        createdAt: "Local",
      };
    });

    return {
      system: [],
      team: [],
      mine,
    };
  });

  const filteredRows = createMemo(() => {
    const query = search().trim().toLowerCase();
    const currentRows = rows()[activeTab()];
    if (!query) return currentRows;
    return currentRows.filter((row) => {
      return (
        row.address.toLowerCase().includes(query) ||
        (row.label ?? "").toLowerCase().includes(query) ||
        row.linkedEntity.toLowerCase().includes(query)
      );
    });
  });

  function removeWallet(address: string) {
    const nextWallets = followedWallets().filter((entry) => addressKey(entry) !== addressKey(address));
    setFollowedWallets(nextWallets);
    saveFollowedWallets(nextWallets);
  }

  function tabCount(key: WalletTabKey) {
    return rows()[key].length;
  }

  const emptyMessage = createMemo(() => {
    if (activeTab() === "mine") {
      return search().trim()
        ? "No saved wallets match the current search."
        : "No saved wallets yet. Add wallets from the detail page or market flow.";
    }
    return "Reserved for future wallet operations.";
  });

  return (
    <>
      <PageOrbs />
      <Navbar />

      <main class="wallet-shell wallets-index-shell">
        <header class="wallets-index-topbar">
          <div class="wallets-index-copy">
            <p class="wallet-kicker">Wallets</p>
            <h1>Wallets</h1>
            <p class="wallets-index-caption">
              Saved wallets live here. Open a row to view the account overview on its dedicated
              `/wallets/0x...` page.
            </p>
          </div>

          <div class="wallets-index-actions">
            <button type="button" class="wallet-secondary-button" title="Planned for later" disabled>
              Import
            </button>
            <button type="button" class="wallet-secondary-button" title="Planned for later" disabled>
              Add Wallets (Bulk)
            </button>
            <button type="button" class="wallet-primary-button" title="Planned for later" disabled>
              Create Wallet
            </button>
          </div>
        </header>

        <section class="wallets-index-panel">
          <div class="wallets-index-toolbar">
            <div class="wallets-index-tabs" role="tablist" aria-label="Wallet groups">
              <For each={WALLET_TABS}>
                {(tab) => (
                  <button
                    type="button"
                    class={`wallets-index-tab${activeTab() === tab.key ? " active" : ""}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label} <span>({tabCount(tab.key)})</span>
                  </button>
                )}
              </For>
            </div>

            <label class="wallets-index-search">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle
                  cx="11"
                  cy="11"
                  r="6.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                />
                <path
                  d="M16 16L20 20"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
              <input
                type="search"
                value={search()}
                onInput={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search by address, label, or linked entity..."
                spellcheck={false}
              />
            </label>
          </div>

          <div class="wallets-index-table-card">
            <div class="wallet-table-wrap wallets-index-table-wrap">
              <table class="wallets-index-table">
                <thead>
                  <tr>
                    <th>Namespace</th>
                    <th>Address</th>
                    <th>Global Label</th>
                    <th>Type</th>
                    <th>Linked Entity</th>
                    <th>Created At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={filteredRows()}>
                    {(row) => (
                      <tr>
                        <td>{row.namespace}</td>
                        <td class="wallets-index-address-cell">
                          <A href={`/wallets/${row.address}`} class="wallets-index-address-link mono">
                            {row.address}
                          </A>
                          <button
                            type="button"
                            class="wallets-index-inline-button"
                            aria-label={`Copy ${row.address}`}
                            onClick={() => copyToClipboard(row.address)}
                          >
                            Copy
                          </button>
                        </td>
                        <td>{row.label ?? "—"}</td>
                        <td>
                          <span class="wallets-index-pill">{row.type}</span>
                        </td>
                        <td>{row.linkedEntity}</td>
                        <td>{row.createdAt}</td>
                        <td class="wallets-index-actions-cell">
                          <A href={`/wallets/${row.address}`} class="wallets-index-open-button">
                            Open
                          </A>
                          <button
                            type="button"
                            class="wallets-index-inline-button destructive"
                            onClick={() => removeWallet(row.address)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )}
                  </For>
                  {filteredRows().length === 0 ? (
                    <tr>
                      <td colSpan={7} class="wallet-empty-row">
                        {emptyMessage()}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
