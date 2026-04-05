import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

const LOCAL_SERVICE_WORKER_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const SERVICE_WORKER_RELOAD_KEY = "qf-local-sw-cleanup-reload";

async function cleanupLocalServiceWorkers() {
  if (
    typeof window === "undefined" ||
    !LOCAL_SERVICE_WORKER_HOSTS.has(window.location.hostname) ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (!registrations.length) {
      window.sessionStorage.removeItem(SERVICE_WORKER_RELOAD_KEY);
      return;
    }

    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ("caches" in window) {
      const cacheKeys = await window.caches.keys();
      await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)));
    }

    // Reload once so the current page is no longer controlled by a stale worker.
    if (
      navigator.serviceWorker.controller &&
      !window.sessionStorage.getItem(SERVICE_WORKER_RELOAD_KEY)
    ) {
      window.sessionStorage.setItem(SERVICE_WORKER_RELOAD_KEY, "1");
      window.location.reload();
      return;
    }

    window.sessionStorage.removeItem(SERVICE_WORKER_RELOAD_KEY);
  } catch (error) {
    console.warn("Failed to clean up local service workers.", error);
  }
}

void cleanupLocalServiceWorkers();

document.documentElement.dataset.theme = "dark";
document.documentElement.classList.add("dark");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
