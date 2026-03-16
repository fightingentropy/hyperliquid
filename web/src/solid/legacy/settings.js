export function mountSettingsPage() {
const SETTINGS_KEY = "hl-settings:v1";
const DEFAULT_RELATIVE_STRENGTH_SYMBOLS = [
  "HYPE",
  "GRASS",
  "AIXBT",
  "NEAR",
  "AAVE",
  "JUP",
  "JTO",
  "UNI",
  "BONK",
  "PUMP",
  "FIL",
  "TRX",
  "ARB",
  "TIA",
  "ORDI",
  "OP",
  "BTC",
  "FLOKI",
  "LDO",
  "PENGU",
  "VIRTUAL",
  "S",
  "ETC",
  "LTC",
  "ALGO",
  "WLD",
  "POPCAT",
  "LIT",
  "WIF",
  "PNUT",
  "TRUMP",
  "SUI",
  "BCH",
  "RENDER",
  "ETH",
  "TAO",
  "ATOM",
  "DOGE",
  "XRP",
  "CRV",
  "XPL",
  "AVAX",
  "SOL",
  "INJ",
  "APT",
  "HBAR",
  "TON",
  "ONDO",
  "ADA",
  "LINK",
  "STX",
  "POL",
  "ASTER",
  "MOODENG",
  "SHIB",
  "KAITO",
  "PEPE",
  "FARTCOIN",
  "ZEC",
  "DOT",
  "IP",
];
const HYPE_SECTOR_ROTATION_SYMBOLS = [
  "HYPE",
  "SPY",
  "XLC",
  "XLY",
  "XLP",
  "XLE",
  "XLF",
  "XLV",
  "XLI",
  "XLB",
  "XLRE",
  "XLK",
  "XLU",
];
const RELATIVE_STRENGTH_LIMIT = 128;
const DEFAULT_SETTINGS = {
  showBinSize: false,
  binPercent: 0.005,
  accountLimit: 5000,
  relativeStrengthDefaults: DEFAULT_RELATIVE_STRENGTH_SYMBOLS,
};

const ui = {
  showBinSize: document.getElementById("show-bin-size"),
  binPercent: document.getElementById("bin-percent"),
  binPercentValue: document.getElementById("bin-percent-value"),
  accountLimit: document.getElementById("account-limit"),
  accountLimitValue: document.getElementById("account-limit-value"),
  relativeDefaults: document.getElementById("relative-defaults"),
  relativeDefaultsCount: document.getElementById("relative-defaults-count"),
  relativeDefaultsPresetSectors: document.getElementById(
    "relative-defaults-preset-sectors",
  ),
  relativeDefaultsReset: document.getElementById("relative-defaults-reset"),
  resetButton: document.getElementById("settings-reset"),
  themeToggle: document.getElementById("theme-toggle"),
};

function normalizeRelativeStrengthSymbol(rawValue) {
  if (typeof rawValue !== "string") return null;
  const compact = rawValue.trim().toUpperCase().replace(/\s+/g, "");
  if (!compact) return null;

  const [baseCandidate = ""] = compact.split("/");
  const sanitized = baseCandidate.replace(/[^A-Z0-9]/g, "");
  if (!sanitized) return null;

  if (sanitized.endsWith("USDT") && sanitized.length > 4) {
    return sanitized.slice(0, -4);
  }

  if (sanitized.endsWith("USD") && sanitized.length > 3) {
    return sanitized.slice(0, -3);
  }

  return sanitized;
}

function parseRelativeStrengthDefaults(rawValue) {
  const source = Array.isArray(rawValue)
    ? rawValue.map((value) => String(value)).join(",")
    : typeof rawValue === "string"
      ? rawValue
      : "";

  const seen = new Set();
  const symbols = [];
  for (const token of source.split(/[\s,]+/g)) {
    const normalized = normalizeRelativeStrengthSymbol(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    symbols.push(normalized);
    if (symbols.length >= RELATIVE_STRENGTH_LIMIT) break;
  }

  return symbols;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const parsedObject = parsed && typeof parsed === "object" ? parsed : {};
    const hasRelativeDefaults = Object.prototype.hasOwnProperty.call(
      parsedObject,
      "relativeStrengthDefaults",
    );
    const relativeStrengthDefaults = hasRelativeDefaults
      ? parseRelativeStrengthDefaults(parsedObject.relativeStrengthDefaults)
      : [...DEFAULT_RELATIVE_STRENGTH_SYMBOLS];
    return {
      ...DEFAULT_SETTINGS,
      ...parsedObject,
      relativeStrengthDefaults,
    };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(next) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `${(num * 100).toFixed(2)}%`;
}

function applySettings(settings) {
  const relativeDefaults = parseRelativeStrengthDefaults(
    settings.relativeStrengthDefaults,
  );

  if (ui.showBinSize) {
    ui.showBinSize.checked = Boolean(settings.showBinSize);
  }
  if (ui.binPercent) {
    ui.binPercent.value = String(settings.binPercent);
  }
  if (ui.binPercentValue) {
    ui.binPercentValue.textContent = formatPercent(settings.binPercent);
  }
  if (ui.accountLimit) {
    ui.accountLimit.value = String(settings.accountLimit);
  }
  if (ui.accountLimitValue) {
    ui.accountLimitValue.textContent = String(settings.accountLimit);
  }
  if (ui.relativeDefaults) {
    ui.relativeDefaults.value = relativeDefaults.join(", ");
  }
  if (ui.relativeDefaultsCount) {
    ui.relativeDefaultsCount.textContent = String(relativeDefaults.length);
  }
}

function init() {
  let settings = loadSettings();
  applySettings(settings);

  function syncThemeToggle() {
    const group = ui.themeToggle;
    if (!group) return;
    const current = window.hlTheme?.get?.() ?? "dark";
    for (const btn of group.querySelectorAll("button[data-theme]")) {
      const t = btn.getAttribute("data-theme");
      btn.classList.toggle("active", t === current);
    }
  }

  ui.themeToggle?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest("button[data-theme]");
    if (!btn) return;
    const theme = btn.getAttribute("data-theme") || "dark";
    window.hlTheme?.set?.(theme);
    syncThemeToggle();
  });

  syncThemeToggle();

  ui.showBinSize?.addEventListener("change", () => {
    settings = { ...settings, showBinSize: ui.showBinSize.checked };
    saveSettings(settings);
  });

  ui.binPercent?.addEventListener("input", () => {
    const value = Number(ui.binPercent.value);
    if (!Number.isFinite(value)) return;
    settings = { ...settings, binPercent: value };
    applySettings(settings);
    saveSettings(settings);
  });

  ui.accountLimit?.addEventListener("input", () => {
    const value = Number(ui.accountLimit.value);
    if (!Number.isFinite(value)) return;
    settings = { ...settings, accountLimit: value };
    applySettings(settings);
    saveSettings(settings);
  });

  ui.relativeDefaults?.addEventListener("input", () => {
    const value = parseRelativeStrengthDefaults(ui.relativeDefaults.value);
    settings = { ...settings, relativeStrengthDefaults: value };
    if (ui.relativeDefaultsCount) {
      ui.relativeDefaultsCount.textContent = String(value.length);
    }
    saveSettings(settings);
  });

  ui.relativeDefaults?.addEventListener("blur", () => {
    applySettings(settings);
  });

  ui.relativeDefaultsReset?.addEventListener("click", () => {
    settings = {
      ...settings,
      relativeStrengthDefaults: [...DEFAULT_RELATIVE_STRENGTH_SYMBOLS],
    };
    applySettings(settings);
    saveSettings(settings);
  });

  ui.relativeDefaultsPresetSectors?.addEventListener("click", () => {
    settings = {
      ...settings,
      relativeStrengthDefaults: [...HYPE_SECTOR_ROTATION_SYMBOLS],
    };
    applySettings(settings);
    saveSettings(settings);
  });

  ui.resetButton?.addEventListener("click", () => {
    settings = { ...DEFAULT_SETTINGS };
    applySettings(settings);
    saveSettings(settings);
  });
}

init();
return undefined;
}
