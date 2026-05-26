#!/usr/bin/env bash
# Register this repo so the LockedIn Copilot.app can find and auto-start the backend.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUPPORT_DIR="$HOME/Library/Application Support/com.lockedin.copilot"

bash "$ROOT/scripts/ensure-dev-env.sh"
mkdir -p "$SUPPORT_DIR"
printf '%s\n' "$ROOT" > "$SUPPORT_DIR/repo-path.txt"
echo "Registered backend path:"
echo "  $SUPPORT_DIR/repo-path.txt"
echo "  → $ROOT"
echo ""
echo "Open LockedIn Copilot from Applications — API and worker will start automatically."
