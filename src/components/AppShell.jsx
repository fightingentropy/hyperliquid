import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  ExternalLink,
  Flame,
  Gift,
  Heart,
  LogIn,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Plus,
  Settings,
  Sun,
  UserPlus,
  Users,
  Users2,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { Link, NavLink, Outlet, matchPath, useLocation } from "react-router-dom";
import { cx } from "../lib/cx";
import { useWallets } from "../hooks/useWallets";
import WalletFormModal from "./WalletFormModal";

const SIDEBAR_COLLAPSE_STORAGE_KEY = "qf-sidebar-collapsed";
const HYPURRSCAN_URL = "https://hypurrscan.io/address";

function decodePathParam(value) {
  try {
    return decodeURIComponent(value ?? "");
  } catch {
    return value ?? "";
  }
}

function MarketFlowIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4.5 15.5 9 11l3 3 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 8H18v4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const NAV_SECTIONS = [
  {
    title: "Hyperliquid",
    items: [
      {
        label: "Wallets",
        path: "/app/wallets",
        icon: Wallet,
        subtitle: "Holdings and flows",
      },
      {
        label: "Market Flow",
        path: "/app/market-flow",
        icon: MarketFlowIcon,
        subtitle: "Buy/sell pressure tracking",
      },
      {
        label: "Relative Strength",
        path: "/app/relative-strength",
        icon: Activity,
        subtitle: "Cross-market momentum map",
      },
      {
        label: "Liquidations",
        path: "/app/liquidations",
        icon: Flame,
        subtitle: "Real-time liquidation feed and analyt…",
        placeholder: true,
      },
    ],
  },
  {
    title: "Public",
    items: [
      {
        label: "Research",
        path: "/app/research",
        icon: BookOpen,
        subtitle: "Public research results",
        placeholder: true,
      },
    ],
  },
];

function resolvePageHeader(pathname) {
  const walletMatch = matchPath("/app/wallets/:address", pathname);

  if (walletMatch) {
    const walletAddress = decodePathParam(walletMatch.params.address);

    return {
      title: "Wallet",
      meta: walletAddress,
      walletAddress,
    };
  }

  const routeTitles = [
    { pattern: "/app/market-flow", title: "Market Flow" },
    { pattern: "/app/relative-strength", title: "Relative Strength" },
    { pattern: "/app/wallets", title: "Wallets" },
  ];

  for (const route of routeTitles) {
    if (matchPath(route.pattern, pathname)) {
      return {
        title: route.title,
        meta: null,
        walletAddress: null,
      };
    }
  }

  return {
    title: "Qwantify",
    meta: null,
    walletAddress: null,
  };
}

function Brand({ className, onNavigate }) {
  return (
    <Link
      to="/app/market-flow"
      className={cx("qf-brand", className)}
      onClick={onNavigate}
    >
      <div className="qf-brand__mark" aria-hidden="true">
        <img
          src="/assets/hyperliquid-symbol-light.png"
          alt=""
          className="qf-brand__logo"
        />
      </div>
      <span className="qf-brand__wordmark">Stats</span>
    </Link>
  );
}

function NavItem({ collapsed, item, onNavigate }) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        cx("qf-nav-link", isActive && "is-active", collapsed && "is-collapsed")
      }
      onClick={onNavigate}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      end={item.path === "/app/wallets"}
    >
      {({ isActive }) => (
        <>
          <span className="qf-nav-icon-wrap" aria-hidden="true">
            <Icon
              className={cx(
                "qf-nav-icon",
                isActive ? "is-active" : "is-inactive",
              )}
            />
          </span>
          <div className="qf-nav-copy">
            <span className="qf-nav-label">{item.label}</span>
            {item.subtitle ? (
              <span className="qf-nav-subtitle">{item.subtitle}</span>
            ) : null}
          </div>
          {item.expandable ? (
            <ChevronRight className="qf-nav-chevron" aria-hidden="true" />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

function PageLoadingState() {
  return (
    <div className="rounded-sm border border-border bg-card p-6 text-sm text-muted-foreground">
      Loading view...
    </div>
  );
}

function ThemeToggleButton() {
  const [isLight, setIsLight] = useState(() => {
    if (typeof document === "undefined") {
      return false;
    }
    return document.documentElement.classList.contains("light");
  });

  const toggle = () => {
    setIsLight((value) => {
      const next = !value;
      if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("light", next);
      }
      return next;
    });
  };

  return (
    <button
      type="button"
      className="qf-sidebar-toggle"
      onClick={toggle}
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {isLight ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

export default function AppShell() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === "1";
  });
  const [copiedWalletAddress, setCopiedWalletAddress] = useState("");
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const pageHeader = useMemo(() => resolvePageHeader(location.pathname), [location.pathname]);

  const { addWallet, isSaved } = useWallets();
  const walletIsPinned = pageHeader.walletAddress ? isSaved(pageHeader.walletAddress) : false;

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setCopiedWalletAddress("");
  }, [pageHeader.walletAddress]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      SIDEBAR_COLLAPSE_STORAGE_KEY,
      sidebarCollapsed ? "1" : "0",
    );
  }, [sidebarCollapsed]);

  const sidebarToggleLabel = sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const walletCopyLabel =
    copiedWalletAddress && copiedWalletAddress === pageHeader.walletAddress
      ? "Copied wallet address"
      : "Copy wallet address";

  const handleCopyWalletAddress = async () => {
    if (!pageHeader.walletAddress) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pageHeader.walletAddress);
      setCopiedWalletAddress(pageHeader.walletAddress);
      window.setTimeout(() => {
        setCopiedWalletAddress((current) =>
          current === pageHeader.walletAddress ? "" : current,
        );
      }, 1200);
    } catch {
      setCopiedWalletAddress("");
    }
  };

  return (
    <div className={cx("qf-app", sidebarCollapsed && "is-sidebar-collapsed")}>
      <aside className={cx("qf-sidebar", sidebarOpen && "is-open", sidebarCollapsed && "is-collapsed")}>
        <div className="qf-sidebar__inner">
          <div className="qf-sidebar__masthead">
            <div className="qf-sidebar__header qf-sidebar__header--expanded">
              <Brand onNavigate={() => setSidebarOpen(false)} />
              <div className="qf-sidebar__header-actions">
                <ThemeToggleButton />
                <button
                  type="button"
                  className="qf-sidebar-toggle qf-sidebar-toggle--desktop"
                  onClick={() => setSidebarCollapsed((value) => !value)}
                  aria-label={sidebarToggleLabel}
                  aria-pressed={sidebarCollapsed}
                >
                  {sidebarCollapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
                </button>
                <button
                  type="button"
                  className="qf-mobile-close"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Close navigation"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="qf-sidebar__header qf-sidebar__header--collapsed">
              <button
                type="button"
                className="qf-sidebar-toggle qf-sidebar-toggle--rail"
                onClick={() => setSidebarCollapsed(false)}
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen className="size-5" />
              </button>
            </div>
          </div>

          <div className="qf-sidebar__divider" />

          <nav className="qf-sidebar__nav" aria-label="Main navigation">
            <div className="qf-sidebar__sections">
              {NAV_SECTIONS.map((section, index) => (
                <section key={section.title} className="qf-sidebar__section">
                  <div className="qf-sidebar__section-title">
                    {section.title}
                  </div>
                  <div className="qf-sidebar__items">
                    {section.items.map((item) => (
                      <NavItem
                        collapsed={sidebarCollapsed}
                        key={`${section.title}-${item.path}`}
                        item={item}
                        onNavigate={() => setSidebarOpen(false)}
                      />
                    ))}
                  </div>
                  {index < NAV_SECTIONS.length - 1 ? (
                    <div className="qf-sidebar__section-divider" />
                  ) : null}
                </section>
              ))}
            </div>
          </nav>
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          className="qf-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation overlay"
        />
      ) : null}

      <div className="qf-main">
        <header className="qf-topbar">
          <div className="qf-topbar__leading">
            <div className="qf-mobile-brand">
              <button
                type="button"
                className="qf-mobile-menu"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="size-4" />
              </button>
              <Brand onNavigate={() => setSidebarOpen(false)} />
            </div>

            <div className="qf-topbar__heading">
              <h1 className="qf-topbar__title">{pageHeader.title}</h1>
              {pageHeader.meta ? (
                <span className="qf-topbar__meta" title={pageHeader.meta}>
                  {pageHeader.meta}
                </span>
              ) : null}
            </div>
          </div>

          {pageHeader.walletAddress ? (
            <div className="qf-topbar__actions">
              <button
                type="button"
                className="qf-topbar__icon-button"
                onClick={handleCopyWalletAddress}
                aria-label={walletCopyLabel}
                title={walletCopyLabel}
              >
                {copiedWalletAddress === pageHeader.walletAddress ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>

              <a
                href={`${HYPURRSCAN_URL}/${pageHeader.walletAddress}`}
                target="_blank"
                rel="noreferrer noopener"
                className="qf-topbar__icon-split"
                aria-label="Open wallet externally"
                title="Open wallet externally"
              >
                <ExternalLink className="size-4" />
                <ChevronDown className="size-3 qf-topbar__icon-split-caret" />
              </a>

              <button
                type="button"
                className={cx(
                  "qf-topbar__cta",
                  walletIsPinned && "is-pinned",
                )}
                disabled={walletIsPinned}
                aria-label={walletIsPinned ? "Wallet already saved" : "Add to my wallets"}
                onClick={() => {
                  if (!walletIsPinned) {
                    setSaveModalOpen(true);
                  }
                }}
              >
                {walletIsPinned ? (
                  <>
                    <Check className="size-4" aria-hidden="true" />
                    <span>SAVED</span>
                  </>
                ) : (
                  <>
                    <Plus className="size-4" aria-hidden="true" />
                    <span>ADD TO MY WALLETS</span>
                  </>
                )}
              </button>
            </div>
          ) : null}
        </header>

        <main className="qf-page">
          <Suspense fallback={<PageLoadingState />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <WalletFormModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        onSubmit={({ address, label }) => addWallet(address, label)}
        initialAddress={pageHeader.walletAddress ?? ""}
        lockAddress
        title="Save wallet"
        submitLabel="Save wallet"
      />
    </div>
  );
}
