import { A, useLocation } from "@solidjs/router";
import { For, createSignal, onMount } from "solid-js";

type NavIconName =
  | "dashboard"
  | "perpetuals"
  | "heatmap"
  | "liquidations"
  | "flow"
  | "clock"
  | "wallet"
  | "settings"
  | "about";

type NavItem = {
  label: string;
  href: string;
  description: string;
  icon: NavIconName;
  matchMode?: "home" | "wallets";
};

type NavSection = {
  title: string;
  items: readonly NavItem[];
};

const SIDEBAR_COLLAPSED_STORAGE_KEY = "hl-sidebar-collapsed";

const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: "Workspace",
    items: [
      {
        label: "Dashboard",
        href: "/",
        description: "Spot, perps, and strength",
        icon: "dashboard",
        matchMode: "home",
      },
    ],
  },
  {
    title: "Analytics",
    items: [
      {
        label: "Perpetuals",
        href: "/perpetuals",
        description: "Perp market overview",
        icon: "perpetuals",
      },
      {
        label: "Heatmap",
        href: "/heatmap",
        description: "Cross-market tile view",
        icon: "heatmap",
      },
      {
        label: "Liquidations",
        href: "/liquidations",
        description: "Clustered risk buckets",
        icon: "liquidations",
      },
      {
        label: "Market Flow",
        href: "/market-flow",
        description: "Buy and sell pressure",
        icon: "flow",
      },
      {
        label: "Unstaking",
        href: "/unstaking",
        description: "HYPE unlock queue",
        icon: "clock",
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        label: "Wallets",
        href: "/wallets",
        description: "Holdings and account views",
        icon: "wallet",
        matchMode: "wallets",
      },
      {
        label: "Settings",
        href: "/settings",
        description: "Local preferences",
        icon: "settings",
      },
      {
        label: "About",
        href: "/about",
        description: "Project overview",
        icon: "about",
      },
    ],
  },
] as const;

function normalizePath(pathname: string) {
  const normalized = pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return normalized === "/asset-app" ? "/" : normalized;
}

function isActive(pathname: string, item: NavItem) {
  const currentPath = normalizePath(pathname);
  if (item.matchMode === "home") {
    return currentPath === "/";
  }
  if (item.matchMode === "wallets") {
    return currentPath === "/wallets" || currentPath.startsWith("/wallets/");
  }
  const itemPath = normalizePath(item.href);
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

function readSidebarCollapsedState() {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("app-sidebar-collapsed")) {
    return true;
  }
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
}

function writeSidebarCollapsedState(collapsed: boolean) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("app-sidebar-collapsed", collapsed);
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignore storage failures.
  }
}

function NavIcon(props: { kind: NavIconName }) {
  switch (props.kind) {
    case "dashboard":
      return (
        <span class="sidebar-hype-symbol" aria-hidden="true"></span>
      );
    case "perpetuals":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 17.5L8.2 12.8L11 15.4L16 8.8L20 11.6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      );
    case "heatmap":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="7" height="7" rx="1.5" fill="currentColor" />
          <rect x="13" y="4" width="7" height="11" rx="1.5" fill="currentColor" opacity="0.85" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.75" />
          <rect x="13" y="17" width="7" height="3" rx="1.5" fill="currentColor" opacity="0.6" />
        </svg>
      );
    case "liquidations":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M11.6 3L6.8 13.1H11L9.8 21L17.2 10.8H13.1L15 3H11.6Z"
            fill="currentColor"
          />
        </svg>
      );
    case "flow":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16 7h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <path d="m22 7-8.5 8.5-5-5L2 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          />
          <path
            d="M12 7V12L15.5 14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      );
    case "wallet":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
      );
    case "about":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          />
          <circle cx="12" cy="8" r="1.2" fill="currentColor" />
          <path
            d="M12 11V16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      );
  }
}

export function Navbar(props: { mode?: "asset" | "legacy" }) {
  const location = useLocation();
  const modeClass = () => (props.mode === "asset" ? " asset-shared-nav" : "");
  const [collapsed, setCollapsed] = createSignal(readSidebarCollapsedState());

  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("app-sidebar-collapsed", collapsed());
  }

  onMount(() => {
    const next = readSidebarCollapsedState();
    setCollapsed(next);
    writeSidebarCollapsedState(next);
  });

  function toggleCollapsed() {
    const next = !collapsed();
    setCollapsed(next);
    writeSidebarCollapsedState(next);
  }

  return (
    <aside class={`top-nav app-sidebar${modeClass()}${collapsed() ? " is-collapsed" : ""}`}>
      <div class="sidebar-brand-row">
        <A class="brand sidebar-brand" href="/">
          <span class="sidebar-brand-mark" aria-hidden="true">
            <img
              class="sidebar-brand-logo"
              src="https://app.hyperliquid.xyz/apple-touch-icon.png"
              alt=""
              width="24"
              height="24"
            />
          </span>
          <span class="sidebar-brand-copy">
            <span class="sidebar-brand-text">Stats</span>
            <span class="sidebar-brand-subtitle">Hyperliquid analytics</span>
          </span>
        </A>

        <button
          type="button"
          class={`sidebar-collapse-button${collapsed() ? " is-collapsed" : ""}`}
          onClick={toggleCollapsed}
          aria-label={collapsed() ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed()}
          title={collapsed() ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M14.5 6L8.5 12L14.5 18"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      <nav class="sidebar-nav" aria-label="Primary">
        <For each={NAV_SECTIONS}>
          {(section) => (
            <section class="sidebar-section">
              <p class="sidebar-section-label">{section.title}</p>
              <div class="nav-links sidebar-links">
                <For each={section.items}>
                  {(item) => (
                    <A
                      href={item.href}
                      class={`nav-link sidebar-link${isActive(location.pathname, item) ? " active" : ""}`}
                      aria-label={item.label}
                      title={item.label}
                    >
                      <span class="sidebar-link-icon" aria-hidden="true">
                        <NavIcon kind={item.icon} />
                      </span>
                      <span class="sidebar-link-copy">
                        <span class="sidebar-link-label">{item.label}</span>
                        <span class="sidebar-link-description">{item.description}</span>
                      </span>
                    </A>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-footer-card">
          <span class="sidebar-footer-label">Shared Shell</span>
          <p class="sidebar-footer-copy">Solid app navigation with wallet and analytics routes.</p>
        </div>
      </div>
    </aside>
  );
}
