# Desktop QA checklist

Manual verification for copilot UX and realtime hardening.

## Preset → overlay (one click)

- [ ] Open **Presets**, click **Start coaching** on a saved preset
- [ ] Overlay appears without visiting Live Coach first
- [ ] Control Center navigates to `/coach?session=…`
- [ ] Session status becomes active in history

## Overlay layout & sizing

- [ ] Overlay shows four zones: status bar, question line, answer area, control row
- [ ] Window cannot grow taller than ~280px (does not cover full call UI)
- [ ] Discrete + idle collapses answer area to one line until a question arrives

## Click-through & drag

- [ ] **Locked** label shown when click-through enabled; **Interactive** when disabled
- [ ] Locked: clicks pass through to apps behind overlay; drag and controls disabled
- [ ] **⌘⇧I** switches to Interactive; hint "⌘⇧I to interact" visible when locked
- [ ] Interactive: drag status bar repositions overlay; release snaps to nearest corner
- [ ] Quit app and relaunch — overlay restores to saved corner and click-through state

## Hide vs Stop

- [ ] **✕** or **Escape** hides overlay only; coaching session continues
- [ ] **Stop** ends session, hides overlay, and enqueues summary
- [ ] **⌘⇧W** from tray hides main window and overlay even when locked

## Realtime coaching

- [ ] Speak a question with "how", "what", "can you" — coaching triggers (not on "however")
- [ ] **⌘⇧M** forces coaching on last heard transcript (STT path)
- [ ] Partial answers show **Streaming…** status; final returns to **Listening…**
- [ ] Recoverable errors (STT/LLM) show yellow banner with Retry; fatal errors show red

## Reconnect

- [ ] Stop API briefly during mic-only session — overlay shows Reconnecting…
- [ ] Restart API — session reconnects without requiring manual stop (up to 5 attempts)
- [ ] After exhausted retries, fatal error with Retry button on overlay and Live Coach

## Practice mode

- [ ] Select practice question → **Start practice**
- [ ] Overlay shows practice question in question line
- [ ] Focused profile + mic enabled by default
- [ ] Stop practice navigates to session detail in history

## History & detail

- [ ] History rows show company/role, duration badge, date filter works
- [ ] Session detail pairs interviewer transcript lines with subsequent AI outputs as Q/A blocks
- [ ] **Start coaching** on detail page opens overlay directly

## Summarize + delete data

- [ ] Profile setting **delete data on session end** enabled
- [ ] End session — summary job runs before transcript segments are deleted
