# LockedIn Copilot MVP

Real-time interview and meeting copilot — all-in-one desktop app with live coaching and post-session analysis.

## Architecture

- **apps/desktop** — Tauri + React app (login, profile, sessions, history, live coach, tray icon)
- **apps/web** — Optional Next.js dashboard (legacy; desktop app is the main UI)
- **services/api** — FastAPI REST + WebSocket backend
- **services/worker** — Background jobs for summarization and document parsing
- **packages/shared** — Shared TypeScript schemas and prompt templates

## Quick start

### 1. Backend (required)

Requires Python 3.12:

```bash
cp .env.example .env
cd services/api
/opt/homebrew/bin/python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ../..
npm run dev:api
```

Optional — post-session summaries:

```bash
npm run dev:worker
```

### 2. Launch the app

Requires [Rust](https://rustup.rs/) for Tauri:

```bash
npm install
npm run dev:desktop
```

Everything is in the desktop app — register, create sessions, live coach, and history. No browser needed.

### 3. Tray icon & shortcuts

- **Click tray icon** — show/hide app
- **⌘⇧W** — hide to tray
- **⌘Q** — quit
- **⌘⇧I** — disable click-through (overlay mode)
- **Close window (✕)** — hides to tray (does not quit)

### 4. Live coaching

1. Sign in → **New Session** → create a session
2. **Live Coach** → select session → **Start coaching**
3. Speak interview questions aloud
4. Optional: **Overlay mode** for always-on-top floating window

## Mock mode

Set `USE_MOCK_AI=true` in `.env` to run without API keys.

## Default account

Register inside the desktop app on first launch.
