#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/.cloudflare/pages"

if [ ! -d "${ROOT_DIR}/node_modules" ]; then
  bun install --frozen-lockfile
fi

bun run web:build

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}/web"

cp "${ROOT_DIR}/about.html" "${OUT_DIR}/about.html"
cp "${ROOT_DIR}/heatmap.html" "${OUT_DIR}/heatmap.html"
cp "${ROOT_DIR}/liquidations.html" "${OUT_DIR}/liquidations.html"
cp "${ROOT_DIR}/perpetuals.html" "${OUT_DIR}/perpetuals.html"
cp "${ROOT_DIR}/settings.html" "${OUT_DIR}/settings.html"
cp "${ROOT_DIR}/unstaking.html" "${OUT_DIR}/unstaking.html"
cp "${ROOT_DIR}/wallet.html" "${OUT_DIR}/wallet.html"
cp "${ROOT_DIR}/heatmap.js" "${OUT_DIR}/heatmap.js"
cp "${ROOT_DIR}/liquidations.js" "${OUT_DIR}/liquidations.js"
cp "${ROOT_DIR}/perpetuals.js" "${OUT_DIR}/perpetuals.js"
cp "${ROOT_DIR}/settings.js" "${OUT_DIR}/settings.js"
cp "${ROOT_DIR}/unstaking.js" "${OUT_DIR}/unstaking.js"
cp "${ROOT_DIR}/wallet.js" "${OUT_DIR}/wallet.js"
cp "${ROOT_DIR}/styles.css" "${OUT_DIR}/styles.css"
cp "${ROOT_DIR}/wallet.css" "${OUT_DIR}/wallet.css"
cp "${ROOT_DIR}/theme.js" "${OUT_DIR}/theme.js"
cp "${ROOT_DIR}/navbar.js" "${OUT_DIR}/navbar.js"
cp "${ROOT_DIR}/geist.css" "${OUT_DIR}/geist.css"
cp "${ROOT_DIR}/favicon.svg" "${OUT_DIR}/favicon.svg"
cp "${ROOT_DIR}/_headers" "${OUT_DIR}/_headers"
cp "${ROOT_DIR}/_redirects" "${OUT_DIR}/_redirects"
cp -R "${ROOT_DIR}/fonts" "${OUT_DIR}/fonts"
cp -R "${ROOT_DIR}/imgs" "${OUT_DIR}/imgs"
cp -R "${ROOT_DIR}/web/dist" "${OUT_DIR}/web/dist"
cp "${ROOT_DIR}/web/dist/index.html" "${OUT_DIR}/asset-app.html"
