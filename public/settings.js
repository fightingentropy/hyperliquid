const SETTINGS_KEY = "hl-settings:v1";
const DEFAULT_SETTINGS = {
  showBinSize: false,
  binPercent: 0.005,
  accountLimit: 5000,
};

const ui = {
  showBinSize: document.getElementById("show-bin-size"),
  binPercent: document.getElementById("bin-percent"),
  binPercentValue: document.getElementById("bin-percent-value"),
  accountLimit: document.getElementById("account-limit"),
  accountLimitValue: document.getElementById("account-limit-value"),
  resetButton: document.getElementById("settings-reset"),
  themeToggle: document.getElementById("theme-toggle"),
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
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

  ui.resetButton?.addEventListener("click", () => {
    settings = { ...DEFAULT_SETTINGS };
    applySettings(settings);
    saveSettings(settings);
  });
}

init();
