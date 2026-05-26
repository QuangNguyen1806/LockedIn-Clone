#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "Building shared package..."
npm run build:shared

echo "Building web app..."
npm run build:web

echo "Building desktop frontend..."
npm run build:desktop

if command -v cargo >/dev/null 2>&1; then
  echo "Building Tauri desktop bundle..."
  npm run tauri build --workspace=@lockedin/desktop
else
  echo "Rust not installed; skipped Tauri native bundle."
  echo "Install Rust from https://rustup.rs and rerun this script."
fi

echo "Done."
