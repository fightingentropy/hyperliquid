import path from "node:path";
import { fileURLToPath } from "node:url";

import solid from "vite-plugin-solid";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootDir,
  plugins: [solid()],
  base: "/web/dist/",
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("lightweight-charts")) return "lightweight-charts";
          if (id.includes("/solid-js/") || id.includes("/@solidjs/router/")) {
            return "solid-vendor";
          }
          if (
            id.includes("@radix-ui/") ||
            id.includes("lucide-react") ||
            id.includes("class-variance-authority") ||
            id.includes("clsx") ||
            id.includes("tailwind-merge")
          ) {
            return "ui-vendor";
          }
        },
      },
    },
  },
});
