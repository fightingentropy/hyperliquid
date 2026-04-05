#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/.cloudflare/pages"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

npm run build -- --outDir "${OUT_DIR}"

cp "${ROOT_DIR}/_headers" "${OUT_DIR}/_headers"
