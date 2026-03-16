(function registerNavbar() {
  const SIDEBAR_COLLAPSED_STORAGE_KEY = "hl-sidebar-collapsed";
  const NAV_SECTIONS = [
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
  ];

  function normalizePath(pathname) {
    const normalized =
      pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    return normalized === "/asset-app" ? "/" : normalized;
  }

  function isActive(pathname, item) {
    const currentPath = normalizePath(pathname);
    if (item.matchMode === "home") {
      return currentPath === "/";
    }
    if (item.matchMode === "wallets") {
      return currentPath === "/wallets" || currentPath.indexOf("/wallets/") === 0;
    }
    const href = normalizePath(item.href);
    return currentPath === href || currentPath.indexOf(href + "/") === 0;
  }

  function readSidebarCollapsedState() {
    if (typeof document !== "undefined" && document.documentElement.classList.contains("app-sidebar-collapsed")) {
      return true;
    }
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  }

  function writeSidebarCollapsedState(collapsed) {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("app-sidebar-collapsed", collapsed);
    }
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  function iconMarkup(kind) {
    switch (kind) {
      case "dashboard":
        return '<span class="sidebar-hype-symbol" aria-hidden="true"></span>';
      case "perpetuals":
        return (
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M4 17.5L8.2 12.8L11 15.4L16 8.8L20 11.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
          "</svg>"
        );
      case "heatmap":
        return (
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<rect x="4" y="4" width="7" height="7" rx="1.5" fill="currentColor"></rect>' +
          '<rect x="13" y="4" width="7" height="11" rx="1.5" fill="currentColor" opacity="0.85"></rect>' +
          '<rect x="4" y="13" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.75"></rect>' +
          '<rect x="13" y="17" width="7" height="3" rx="1.5" fill="currentColor" opacity="0.6"></rect>' +
          "</svg>"
        );
      case "liquidations":
        return (
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M11.6 3L6.8 13.1H11L9.8 21L17.2 10.8H13.1L15 3H11.6Z" fill="currentColor"></path>' +
          "</svg>"
        );
      case "flow":
        return (
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M16 7h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
          '<path d="m22 7-8.5 8.5-5-5L2 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
          "</svg>"
        );
      case "clock":
        return (
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"></circle>' +
          '<path d="M12 7V12L15.5 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
          "</svg>"
        );
      case "wallet":
        return (
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
          '<path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
          "</svg>"
        );
      case "settings":
        return (
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>' +
          '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"></circle>' +
          "</svg>"
        );
      case "about":
        return (
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"></circle>' +
          '<circle cx="12" cy="8" r="1.2" fill="currentColor"></circle>' +
          '<path d="M12 11V16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>' +
          "</svg>"
        );
      default:
        return "";
    }
  }

  function renderNavbarMarkup(element) {
    const pathname = window.location.pathname;
    const mode = element.getAttribute("mode");
    const modeClass = mode === "asset" ? " asset-shared-nav" : "";
    const collapsed = readSidebarCollapsedState();
    writeSidebarCollapsedState(collapsed);

    const sections = NAV_SECTIONS.map(function renderSection(section) {
      const links = section.items
        .map(function renderItem(item) {
          const activeClass = isActive(pathname, item) ? " active" : "";
          return (
            '<a class="nav-link sidebar-link' +
            activeClass +
            '" href="' +
            item.href +
            '" aria-label="' +
            item.label +
            '" title="' +
            item.label +
            '">' +
            '<span class="sidebar-link-icon" aria-hidden="true">' +
            iconMarkup(item.icon) +
            "</span>" +
            '<span class="sidebar-link-copy">' +
            '<span class="sidebar-link-label">' +
            item.label +
            "</span>" +
            '<span class="sidebar-link-description">' +
            item.description +
            "</span>" +
            "</span>" +
            "</a>"
          );
        })
        .join("");

      return (
        '<section class="sidebar-section">' +
        '<p class="sidebar-section-label">' +
        section.title +
        "</p>" +
        '<div class="nav-links sidebar-links">' +
        links +
        "</div>" +
        "</section>"
      );
    }).join("");

    element.innerHTML =
      '<aside class="top-nav app-sidebar' +
      modeClass +
      (collapsed ? " is-collapsed" : "") +
      '">' +
      '<div class="sidebar-brand-row">' +
      '<a class="brand sidebar-brand" href="/">' +
      '<span class="sidebar-brand-mark" aria-hidden="true"><img class="sidebar-brand-logo" src="https://app.hyperliquid.xyz/apple-touch-icon.png" alt="" width="24" height="24"></span>' +
      '<span class="sidebar-brand-copy">' +
      '<span class="sidebar-brand-text">Stats</span>' +
      '<span class="sidebar-brand-subtitle">Hyperliquid analytics</span>' +
      "</span>" +
      "</a>" +
      '<button class="sidebar-collapse-button' +
      (collapsed ? " is-collapsed" : "") +
      '" type="button" data-sidebar-toggle aria-label="' +
      (collapsed ? "Expand sidebar" : "Collapse sidebar") +
      '" aria-expanded="' +
      String(!collapsed) +
      '" title="' +
      (collapsed ? "Expand sidebar" : "Collapse sidebar") +
      '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M14.5 6L8.5 12L14.5 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
      "</svg>" +
      "</button>" +
      "</div>" +
      '<nav class="sidebar-nav" aria-label="Primary">' +
      sections +
      "</nav>" +
      '<div class="sidebar-footer">' +
      '<div class="sidebar-footer-card">' +
      '<span class="sidebar-footer-label">Shared Shell</span>' +
      '<p class="sidebar-footer-copy">Solid app navigation with wallet and analytics routes.</p>' +
      "</div>" +
      "</div>" +
      "</aside>";

    const toggle = element.querySelector("[data-sidebar-toggle]");
    if (toggle) {
      toggle.addEventListener("click", function handleSidebarToggle() {
        writeSidebarCollapsedState(!readSidebarCollapsedState());
        renderNavbarMarkup(element);
      });
    }
  }

  const ExistingNavbar = customElements.get("hl-navbar");
  if (ExistingNavbar) {
    if (typeof ExistingNavbar.prototype.render === "function") {
      ExistingNavbar.prototype.render = function patchRender() {
        renderNavbarMarkup(this);
      };
    }

    document.querySelectorAll("hl-navbar").forEach(function rerender(element) {
      if (typeof element.render === "function") element.render();
      else renderNavbarMarkup(element);
    });
    return;
  }

  class HLNavbar extends HTMLElement {
    connectedCallback() {
      this.render();
      this._onPopState = () => this.render();
      window.addEventListener("popstate", this._onPopState);
    }

    disconnectedCallback() {
      if (this._onPopState) {
        window.removeEventListener("popstate", this._onPopState);
      }
    }

    static get observedAttributes() {
      return ["mode"];
    }

    attributeChangedCallback() {
      this.render();
    }

    render() {
      renderNavbarMarkup(this);
    }
  }

  customElements.define("hl-navbar", HLNavbar);
})();
