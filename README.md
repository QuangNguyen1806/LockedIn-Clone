# LockedIn Copilot MVP

Real-time interview and meeting copilot — all-in-one desktop app with live coaching and post-session analysis.

## Architecture

- **apps/desktop** — Tauri + React app (login, profile, sessions, history, live coach, tray icon)
- **apps/web** — Optional Next.js dashboard (legacy; desktop app is the main UI)
- **services/api** — FastAPI REST + WebSocket backend
- **services/worker** — Background jobs for summarization and document parsing
- **packages/shared** — Shared TypeScript schemas and prompt templates

## Quick start

### One command (recommended)

From the project folder:

```bash
npm install
npm run dev
```

This starts **API**, **worker**, and **desktop app** together in one terminal.

**In Cursor / VS Code:** opening this folder auto-runs the dev stack (you may need to click **Allow Automatic Tasks** the first time).

**From Finder (macOS):** double-click `scripts/Start LockedIn Dev.command`.

### Manual start (optional)

Requires Python 3.12:

```bash
cp .env.example .env
cd services/api
/opt/homebrew/bin/python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ../..
npm run dev:api          # terminal 1
npm run dev:worker       # terminal 2 (summaries + document parsing)
npm run dev:desktop      # terminal 3
```

Or run individual services via **Terminal → Run Task → LockedIn: …** in Cursor.

### Launch from the app icon (macOS)

Install once, then open from Applications like any other app — **no terminal commands needed**:

```bash
npm run install:mac
```

The app automatically starts the **API** and **worker** when you open it, and stops them when you quit (**⌘Q** or tray → Quit).

If you already installed before this feature, register the project path once:

```bash
bash scripts/register-app-path.sh
```

Or reinstall with `npm run install:mac`.

To disable autostart (e.g. you run the API yourself): set `LOCKEDIN_BACKEND_AUTOSTART=0` before opening the app.

### Tray icon & shortcuts

- **Click tray icon** — show/hide app
- **⌘⇧W** — hide to tray (main window + overlay)
- **⌘Q** — quit
- **⌘⇧L** — toggle overlay click-through (Locked / Interactive)
- **⌘⇧I** — force Interactive mode (disable click-through)
- **⌘⇧D** — toggle debug metrics on Live Coach page
- **Escape** (overlay focused) — hide overlay (session keeps running)
- **Close window (✕)** — hides to tray (does not quit)

### 4. Live coaching

1. **Presets** → **Start coaching** (one click), or **New Session** → **Create & start coaching**
2. Overlay opens with discrete profile by default (semi-transparent, compact when idle)
3. **Locked** mode passes clicks through to your call UI; **Interactive** mode lets you drag, copy, and adjust controls
4. Drag overlay and release to snap to nearest screen corner (position restored on next show)
5. **✕** hides overlay; **Stop** ends the session
6. **⌘⇧M** (global) marks the last heard transcript as a question for coaching

### 5. Overlay states

| Dot | Label | Meaning |
|-----|-------|---------|
| Yellow | Connecting… | WebSocket opening |
| Green | Listening… | Connected, waiting for questions |
| Yellow | Thinking… | Question detected, LLM starting |
| Yellow | Streaming… | Answer tokens arriving |
| Yellow | Reconnecting… | Recoverable connection issue |
| Red | Error | Fatal error — use Retry |

## Mock mode

Set `USE_MOCK_AI=true` in `.env` to run without API keys.

## Default account

Register inside the desktop app on first launch.

## Manual QA

See [docs/desktop-qa.md](docs/desktop-qa.md) for a checklist covering preset→overlay, click-through, snap restore, mark_question, reconnect, and practice critique flows.
