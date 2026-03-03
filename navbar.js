(function registerNavbar() {
  if (customElements.get("hl-navbar")) return;

  const NAV_ITEMS = [
    { label: "Perpetuals Analytics", href: "/perpetuals" },
    { label: "Heatmap", href: "/heatmap" },
    { label: "Liquidations", href: "/liquidations" },
    { label: "Unstaking", href: "/unstaking" },
    { label: "Wallet", href: "/wallet" },
    { label: "Settings", href: "/settings" },
    { label: "About", href: "/about" },
  ];

  function isActive(pathname, href) {
    return pathname === href || pathname.startsWith(href + "/");
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
      const pathname = window.location.pathname;
      const modeClass = this.getAttribute("mode") === "asset" ? " asset-shared-nav" : "";

      const links = NAV_ITEMS.map((item) => {
        const activeClass = isActive(pathname, item.href) ? " active" : "";
        return '<a class="nav-link' + activeClass + '" href="' + item.href + '">' + item.label + "</a>";
      }).join("");

      this.innerHTML =
        '<nav class="top-nav' +
        modeClass +
        '">' +
        '<a class="brand" href="/">' +
        '<span class="brand-logo" aria-hidden="true"></span>' +
        '<span class="brand-text">Stats</span>' +
        "</a>" +
        '<div class="nav-links">' +
        links +
        "</div>" +
        "</nav>";
    }
  }

  customElements.define("hl-navbar", HLNavbar);
})();
