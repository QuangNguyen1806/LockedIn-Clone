#!/usr/bin/env bash
# Ensures Python venv and deps exist before starting dev services.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/services/api"
VENV="$API_DIR/.venv"
PYTHON="${PYTHON:-/opt/homebrew/bin/python3.12}"

if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating API virtualenv at services/api/.venv ..."
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    PYTHON="python3"
  fi
  "$PYTHON" -m venv "$VENV"
  "$VENV/bin/pip" install -q -r "$API_DIR/requirements.txt"
fi

if [ ! -f "$ROOT/.env" ] && [ -f "$ROOT/.env.example" ]; then
  echo "Copying .env.example → .env (edit with your API keys)"
  cp "$ROOT/.env.example" "$ROOT/.env"
fi
