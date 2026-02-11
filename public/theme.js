(function () {
  const STORAGE_KEY = "vite-ui-theme";
  const THEMES = new Set(["light", "dark", "system"]);

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function apply(theme) {
    const resolved = theme === "system" ? systemTheme() : theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }

  function setTheme(theme) {
    const next = THEMES.has(theme) ? theme : "dark";
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    apply(next);
  }

  function getTheme() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (THEMES.has(raw)) return raw;
    } catch {
      // ignore
    }
    return "dark";
  }

  const initial = getTheme();
  apply(initial);

  // Keep in sync if user chooses "system".
  if (window.matchMedia) {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getTheme() === "system") apply("system");
    };
    if (typeof mql.addEventListener === "function") mql.addEventListener("change", onChange);
    else if (typeof mql.addListener === "function") mql.addListener(onChange);
  }

  window.hlTheme = {
    get: getTheme,
    set: setTheme,
    apply,
  };
})();

