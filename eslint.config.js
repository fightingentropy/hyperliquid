import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      ".cloudflare/**",
      ".wrangler/**",
      "dist/**",
      "node_modules/**",
      "worker-configuration.d.ts",
      "functions/**/*.ts",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, ...globals.worker },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
