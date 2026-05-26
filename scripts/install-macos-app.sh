#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_SRC="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/LockedIn Copilot.app"
APP_DEST="/Applications/LockedIn Copilot.app"

echo "Building LockedIn Copilot..."
source "$HOME/.cargo/env" 2>/dev/null || true
cd "$ROOT"
npm run build:shared
npm run tauri build --workspace=@lockedin/desktop

if [ ! -d "$APP_SRC" ]; then
  echo "Build failed: $APP_SRC not found"
  exit 1
fi

echo "Installing to Applications..."
rm -rf "$APP_DEST"
cp -R "$APP_SRC" "/Applications/"

echo "Signing app with microphone entitlements..."
codesign --force --deep --sign - \
  --entitlements "$ROOT/apps/desktop/src-tauri/Entitlements.plist" \
  "$APP_DEST"

echo "Installed: $APP_DEST"
echo "Open from Applications folder or Spotlight (Cmd+Space → LockedIn)."
