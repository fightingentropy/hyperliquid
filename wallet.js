(function () {
  const TABLE_WINDOWS = ["1h", "4h", "12h", "1d", "7d"];
  const WALLET_PATH_REGEX = /^\/wallets\/(0x[a-fA-F0-9]{40})\/?$/;
  const FOLLOWED_WALLETS_KEY = "hl-followed-wallets-v1";
  const DEFAULT_FOLLOWED_WALLETS = [
    "0xaf0FDd39e5D92499B0eD9F68693DA99C0ec1e92e",
    "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae",
    "0xcb58b8f5ec6d47985f0728465c25a08ef9ad2c7b",
    "0xadD12ADBbD5Db87674b38Af99b6dD34Dd2A45e0d",
    "0x519c721de735f7c9e6146d167852e60d60496a47",
    "0x4cb5f4d145cd16460932bbb9b871bb6fd5db97e3",
    "0x9c2a2a966ed8e47f0c8b7e2ec2b91424f229f6a8",
  ];
  const DEFAULT_FOLLOWED_WALLET_LABELS = Object.freeze({
    "0xaf0fdd39e5d92499b0ed9f68693da99c0ec1e92e": "purple surfer",
    "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae": "loracle",
    "0xcb58b8f5ec6d47985f0728465c25a08ef9ad2c7b": "CL",
    "0xadd12adbbd5db87674b38af99b6dd34dd2a45e0d": "nexus",
    "0x519c721de735f7c9e6146d167852e60d60496a47": "Hyper Longer",
    "0x9c2a2a966ed8e47f0c8b7e2ec2b91424f229f6a8": "Phantom Yak",
  });
  const PREFERRED_FOLLOWED_WALLET_CASE = Object.freeze(
    Object.fromEntries(
      DEFAULT_FOLLOWED_WALLETS.map((address) => [address.trim().toLowerCase(), address]),
    ),
  );

  const ui = {
    addressInput: document.getElementById("address-input"),
    lookupButton: document.getElementById("lookup-button"),
    followWalletButton: document.getElementById("follow-wallet-button"),
    refreshButton: document.getElementById("refresh-button"),
    addressError: document.getElementById("address-error"),
    walletStatus: document.getElementById("wallet-status"),
    followedWalletsList: document.getElementById("followed-wallets-list"),
    walletAddressTitle: document.getElementById("wallet-address-title"),
    metricWalletId: document.getElementById("metric-wallet-id"),
    metricGeneratedAt: document.getElementById("metric-generated-at"),
    metricAssetCount: document.getElementById("metric-asset-count"),
    flowResolve: document.getElementById("flow-resolve"),
    flowDeltas: document.getElementById("flow-deltas"),
    notionalDeltasBody: document.getElementById("notional-deltas-body"),
  };

  const state = {
    address: null,
    followedWallets: [],
    loadId: 0,
  };

  function isAddress(value) {
    return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
  }

  function addressKey(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function normalizeAddress(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!isAddress(trimmed)) return null;
    return PREFERRED_FOLLOWED_WALLET_CASE[addressKey(trimmed)] || trimmed;
  }

  function setText(element, value) {
    if (!element) return;
    element.textContent = value ?? "";
  }

  function setButtonsDisabled(disabled) {
    if (ui.lookupButton) ui.lookupButton.disabled = disabled;
    if (ui.refreshButton) ui.refreshButton.disabled = disabled;
  }

  function setAddressError(message) {
    setText(ui.addressError, message || "");
  }

  function setStatus(message) {
    setText(ui.walletStatus, message || "");
  }

  function formatAddressShort(address) {
    if (!isAddress(address)) return address ?? "—";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  function walletLabel(address) {
    const normalized = normalizeAddress(address);
    if (!normalized) return null;
    return DEFAULT_FOLLOWED_WALLET_LABELS[addressKey(normalized)] ?? null;
  }

  function formatFollowedWalletLabel(address) {
    const short = formatAddressShort(address);
    const label = walletLabel(address);
    if (!label) return short;
    return `${label} (${short})`;
  }

  function formatDate(value) {
    const timestamp = Date.parse(String(value ?? ""));
    if (!Number.isFinite(timestamp)) return "—";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  }

  function formatSignedUsd(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (number === 0) return "$0";

    const absolute = Math.abs(number);
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: absolute >= 1000 ? "compact" : "standard",
      compactDisplay: "short",
      minimumFractionDigits: absolute >= 1000 ? 2 : 0,
      maximumFractionDigits: 2,
    });

    const prefix = number > 0 ? "+" : "-";
    return `${prefix}${formatter.format(absolute)}`;
  }

  function updateFlow(address, walletId) {
    const shownAddress = address || "0x...";
    const shownWalletId = walletId || ":walletId";
    setText(
      ui.flowResolve,
      `https://api.qwantify.io/api/wallets/resolve?address=${shownAddress}`,
    );
    setText(
      ui.flowDeltas,
      `https://api.qwantify.io/api/wallets/${shownWalletId}/notional-deltas`,
    );
  }

  function renderEmptyRow(message) {
    if (!ui.notionalDeltasBody) return;
    const row = document.createElement("tr");
    row.className = "wallet-empty-row";
    const cell = document.createElement("td");
    cell.colSpan = TABLE_WINDOWS.length + 1;
    cell.textContent = message;
    row.appendChild(cell);
    ui.notionalDeltasBody.replaceChildren(row);
  }

  function renderTableRows(deltas) {
    if (!ui.notionalDeltasBody) return;

    if (!Array.isArray(deltas) || deltas.length === 0) {
      renderEmptyRow("No net notional delta rows were returned for this wallet.");
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const entry of deltas) {
      const row = document.createElement("tr");

      const symbolCell = document.createElement("td");
      symbolCell.className = "wallet-symbol";
      symbolCell.textContent = String(entry?.symbol ?? "—");
      row.appendChild(symbolCell);

      for (const windowKey of TABLE_WINDOWS) {
        const cell = document.createElement("td");
        const rawValue = entry?.deltas?.[windowKey];
        const numericValue = Number(rawValue);

        cell.className = "wallet-delta-cell";
        if (Number.isFinite(numericValue)) {
          if (numericValue > 0) cell.classList.add("positive");
          else if (numericValue < 0) cell.classList.add("negative");
          else cell.classList.add("neutral");
        } else {
          cell.classList.add("neutral");
        }

        cell.textContent = formatSignedUsd(rawValue);
        row.appendChild(cell);
      }

      fragment.appendChild(row);
    }

    ui.notionalDeltasBody.replaceChildren(fragment);
  }

  function normalizeWalletList(candidates) {
    const seen = new Set();
    const wallets = [];

    for (const candidate of candidates ?? []) {
      const normalized = normalizeAddress(candidate);
      const key = addressKey(normalized);
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      wallets.push(normalized);
    }

    return wallets;
  }

  function saveFollowedWallets() {
    try {
      localStorage.setItem(FOLLOWED_WALLETS_KEY, JSON.stringify(state.followedWallets));
    } catch {
      // Ignore storage failures.
    }
  }

  function loadFollowedWallets() {
    const defaults = normalizeWalletList(DEFAULT_FOLLOWED_WALLETS);

    try {
      const raw = localStorage.getItem(FOLLOWED_WALLETS_KEY);
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

  function renderFollowedWallets() {
    if (!ui.followedWalletsList) return;

    ui.followedWalletsList.innerHTML = "";

    if (!state.followedWallets.length) {
      const empty = document.createElement("p");
      empty.className = "followed-wallet-empty";
      empty.textContent = "No tracked wallets yet.";
      ui.followedWalletsList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const wallet of state.followedWallets) {
      const chip = document.createElement("div");
      chip.className = "followed-wallet-chip";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "followed-wallet-open";
      if (addressKey(wallet) === addressKey(state.address)) {
        openButton.classList.add("active");
      }
      openButton.dataset.role = "open";
      openButton.dataset.address = wallet;
      openButton.textContent = formatFollowedWalletLabel(wallet);
      openButton.title = walletLabel(wallet)
        ? `${walletLabel(wallet)} - ${wallet}`
        : wallet;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "followed-wallet-remove";
      removeButton.dataset.role = "remove";
      removeButton.dataset.address = wallet;
      removeButton.ariaLabel = `Remove ${formatFollowedWalletLabel(wallet)} from tracked wallets`;
      removeButton.textContent = "x";

      chip.appendChild(openButton);
      chip.appendChild(removeButton);
      fragment.appendChild(chip);
    }

    ui.followedWalletsList.appendChild(fragment);
  }

  function addFollowedWallet(value) {
    const normalized = normalizeAddress(value);
    if (!normalized) return false;

    state.followedWallets = [
      normalized,
      ...state.followedWallets.filter((wallet) => addressKey(wallet) !== addressKey(normalized)),
    ];
    saveFollowedWallets();
    renderFollowedWallets();
    return true;
  }

  function removeFollowedWallet(value) {
    const normalized = normalizeAddress(value);
    if (!normalized) return;

    state.followedWallets = state.followedWallets.filter(
      (wallet) => addressKey(wallet) !== addressKey(normalized),
    );
    saveFollowedWallets();
    renderFollowedWallets();
  }

  function resetMeta() {
    setText(ui.metricWalletId, "—");
    setText(ui.metricGeneratedAt, "—");
    setText(ui.metricAssetCount, "—");
    updateFlow(state.address, null);
  }

  function applyPayload(payload) {
    const resolvedAddress = normalizeAddress(payload?.walletAddress) || state.address;
    state.address = resolvedAddress;

    setText(ui.walletAddressTitle, payload?.walletAddress || state.address || "No wallet loaded");
    setText(ui.metricWalletId, payload?.walletId || "Not indexed");
    setText(ui.metricGeneratedAt, formatDate(payload?.generatedAt));
    setText(ui.metricAssetCount, String(payload?.deltas?.length ?? 0));
    updateFlow(payload?.walletAddress || state.address, payload?.walletId || null);
    renderTableRows(payload?.deltas);
    renderFollowedWallets();
  }

  async function fetchWalletNotionalDeltas(address, refresh) {
    const requestUrl = new URL(
      `/api/qwantify/wallet-notional-deltas/${encodeURIComponent(address)}`,
      location.origin,
    );
    if (refresh) requestUrl.searchParams.set("refresh", "1");

    const response = await fetch(requestUrl.toString(), {
      headers: { Accept: "application/json" },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload && typeof payload.error === "string"
          ? payload.error
          : "Failed to load wallet notional delta data.";
      throw new Error(message);
    }

    return payload;
  }

  function updateHistory(address, replace) {
    const path = address ? `/wallets/${address}` : "/wallets";
    if (location.pathname === path) return;
    const method = replace ? "replaceState" : "pushState";
    history[method]({ address }, "", path);
  }

  async function loadWallet(rawAddress, options) {
    const normalized = normalizeAddress(rawAddress);
    if (!normalized) {
      setAddressError("Enter a valid EVM wallet address.");
      setStatus("Waiting for a valid wallet address.");
      renderEmptyRow("Load a wallet to see net notional delta data.");
      state.address = null;
      setText(ui.walletAddressTitle, "No wallet loaded");
      resetMeta();
      renderFollowedWallets();
      return;
    }

    const opts = options || {};
    const requestId = ++state.loadId;
    state.address = normalized;

    if (ui.addressInput) ui.addressInput.value = normalized;
    if (!opts.skipHistory) updateHistory(normalized, false);

    setAddressError("");
    setStatus("Resolving wallet in Qwantify and loading net notional deltas...");
    setText(ui.walletAddressTitle, normalized);
    updateFlow(normalized, null);
    renderEmptyRow("Loading live notional delta data...");
    setButtonsDisabled(true);

    try {
      const payload = await fetchWalletNotionalDeltas(normalized, Boolean(opts.refresh));
      if (requestId !== state.loadId) return;

      applyPayload(payload);
      if (state.address) updateHistory(state.address, true);
      if (payload?.resolved === false) {
        renderEmptyRow(payload?.message || "This wallet is not indexed in Qwantify yet.");
        setStatus(payload?.message || "This wallet is not indexed in Qwantify yet.");
      } else {
        setStatus(
          `Loaded ${payload?.deltas?.length ?? 0} symbols from Qwantify.`,
        );
      }
    } catch (error) {
      if (requestId !== state.loadId) return;
      resetMeta();
      renderEmptyRow("Unable to load Qwantify notional delta data.");
      setStatus("Qwantify data could not be loaded.");
      setAddressError(error?.message || "Failed to load wallet data.");
      renderFollowedWallets();
    } finally {
      if (requestId === state.loadId) {
        setButtonsDisabled(false);
      }
    }
  }

  function readAddressFromPath() {
    const match = location.pathname.match(WALLET_PATH_REGEX);
    return match ? normalizeAddress(match[1]) : null;
  }

  function bindEvents() {
    ui.lookupButton?.addEventListener("click", () => {
      loadWallet(ui.addressInput?.value || "", { skipHistory: false });
    });

    ui.followWalletButton?.addEventListener("click", () => {
      const candidate = ui.addressInput?.value || state.address || "";
      if (!addFollowedWallet(candidate)) {
        setAddressError("Enter a valid wallet address first.");
        return;
      }

      setAddressError("");
    });

    ui.refreshButton?.addEventListener("click", () => {
      if (!state.address) {
        setAddressError("Enter a valid wallet address first.");
        return;
      }
      loadWallet(state.address, { refresh: true, skipHistory: true });
    });

    ui.addressInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      loadWallet(ui.addressInput?.value || "", { skipHistory: false });
    });

    ui.followedWalletsList?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement)) return;

      const address = button.dataset.address;
      if (!address) return;

      if (button.dataset.role === "remove") {
        removeFollowedWallet(address);
        return;
      }

      if (button.dataset.role === "open") {
        if (ui.addressInput) ui.addressInput.value = address;
        loadWallet(address, { skipHistory: false });
      }
    });

    window.addEventListener("popstate", () => {
      const address = readAddressFromPath();
      if (address) {
        loadWallet(address, { skipHistory: true });
        return;
      }

      state.address = null;
      if (ui.addressInput) ui.addressInput.value = "";
      setAddressError("");
      setStatus("Enter a wallet address or open a `/wallets/0x...` route.");
      setText(ui.walletAddressTitle, "No wallet loaded");
      resetMeta();
      renderEmptyRow("Load a wallet to see net notional delta data.");
      renderFollowedWallets();
    });
  }

  bindEvents();
  state.followedWallets = loadFollowedWallets();
  saveFollowedWallets();
  renderFollowedWallets();
  resetMeta();

  const initialAddress = readAddressFromPath();
  if (initialAddress) {
    loadWallet(initialAddress, { skipHistory: true });
  }
})();
