import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, getStoredToken } from "../lib/api";
import {
  AudioInputMode,
  isSystemAudioSupported,
  useRealtimeSession,
} from "../hooks/useSession";
import { requestMicrophonePermission, PermissionState } from "../lib/permissions";
import { useWindowControls } from "../hooks/useWindowControls";

type Session = { id: string; title: string; status: string };

function listeningHint(mode: string, audioInput: AudioInputMode) {
  if (mode === "system") return "Listening to call/system audio from your screen share";
  if (mode === "both") return "Listening to call audio + your microphone";
  if (mode === "browser") return "Listening via live speech recognition (microphone)";
  if (mode === "server") return "Listening via server transcription (microphone)";
  if (audioInput === "system") return "Waiting for screen share permission...";
  return "Not listening yet";
}

export function CoachPage() {
  const token = getStoredToken();
  const [searchParams] = useSearchParams();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState(searchParams.get("session") || "");
  const [audioInput, setAudioInput] = useState<AudioInputMode>(
    isSystemAudioSupported() ? "system" : "mic",
  );
  const [active, setActive] = useState(false);
  const [overlayMode, setOverlayMode] = useState(false);
  const [micPermission, setMicPermission] = useState<PermissionState>("unknown");
  const [permissionMessage, setPermissionMessage] = useState("");
  const [startError, setStartError] = useState("");
  const { opacity, setOpacity, clickThrough, toggleClickThrough } = useWindowControls();
  const { connectionState, transcript, suggestion, error, listeningMode, prepareCapture, disconnect } =
    useRealtimeSession(sessionId, token, active, audioInput);

  useEffect(() => {
    if (token) {
      api.listSessions().then((list) => setSessions(list as Session[])).catch(() => undefined);
    }
  }, [token]);

  useEffect(() => {
    const fromQuery = searchParams.get("session");
    if (fromQuery) setSessionId(fromQuery);
  }, [searchParams]);

  async function handleRequestMicrophone() {
    setPermissionMessage("");
    const result = await requestMicrophonePermission();
    setMicPermission(result);
    if (result === "granted") {
      setPermissionMessage("Microphone enabled. LockedIn Copilot should now appear in System Settings → Privacy & Security → Microphone.");
    } else if (result === "denied") {
      setPermissionMessage(
        "Microphone access denied. Open System Settings → Privacy & Security → Microphone, allow LockedIn Copilot, then restart the app.",
      );
    } else {
      setPermissionMessage("Microphone access is not available in this environment.");
    }
  }

  async function setOverlay(enabled: boolean) {
    try {
      await invoke("set_overlay_mode", { enabled });
      setOverlayMode(enabled);
    } catch {
      setOverlayMode(enabled);
    }
  }

  async function handleStartCoaching() {
    setStartError("");
    try {
      await prepareCapture();
      setActive(true);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not start audio capture.");
    }
  }

  function handleStop() {
    setActive(false);
    disconnect();
  }

  async function handleHide() {
    handleStop();
    if (overlayMode) await setOverlay(false);
    try {
      await invoke("hide_window");
    } catch {
      // browser dev fallback
    }
  }

  return (
    <div className={`coach-page ${overlayMode ? "overlay-mode" : ""}`} style={overlayMode ? { opacity } : undefined}>
      <section className="card">
        <div className="coach-header">
          <h2>Live Coach</h2>
          <div className="controls">
            <button type="button" className="secondary" onClick={() => void handleHide()}>
              Hide to tray
            </button>
            {!overlayMode ? (
              <button type="button" className="primary" onClick={() => void setOverlay(true)}>
                Overlay mode
              </button>
            ) : (
              <button type="button" className="secondary" onClick={() => void setOverlay(false)}>
                Exit overlay
              </button>
            )}
          </div>
        </div>
        <p className="muted">
          Capture interview questions from your video call, then get real-time answers grounded in your resume and
          job description (upload both in Profile first).
        </p>
      </section>

      <section className="card grid">
        <div>
          <label htmlFor="session">Session</label>
          <select id="session" value={sessionId} onChange={(e) => setSessionId(e.target.value)} disabled={active}>
            <option value="">Select session</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.status})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audioInput">Audio source</label>
          <select
            id="audioInput"
            value={audioInput}
            onChange={(e) => setAudioInput(e.target.value as AudioInputMode)}
            disabled={active}
          >
            {isSystemAudioSupported() && (
              <option value="system">Call audio (system) — recommended for interviews</option>
            )}
            <option value="mic">Microphone only</option>
            {isSystemAudioSupported() && <option value="both">Call audio + microphone</option>}
          </select>
        </div>
        <div className="controls">
          {!active ? (
            <button className="primary" disabled={!sessionId} onClick={() => void handleStartCoaching()}>
              Start coaching
            </button>
          ) : (
            <button onClick={handleStop}>Stop coaching</button>
          )}
          <span className="badge">{connectionState}</span>
        </div>
        {audioInput !== "mic" && (
          <p className="hint">
            Call audio uses <strong>Screen & System Audio Recording</strong>, not Microphone. When prompted,
            share your entire screen with <strong>Share system audio</strong> enabled.
          </p>
        )}
      </section>

      <section className="card grid">
        <h3>Permissions</h3>
        <p className="hint">
          LockedIn Copilot only appears in macOS Privacy settings <strong>after</strong> you grant access once.
          Call-audio mode needs Screen Recording; microphone modes need Microphone.
        </p>
        <div className="controls">
          <button type="button" className="secondary" onClick={() => void handleRequestMicrophone()} disabled={active}>
            Enable microphone access
          </button>
          {micPermission === "granted" && <span className="badge">mic ok</span>}
        </div>
        {permissionMessage && <p className="muted">{permissionMessage}</p>}
      </section>

      {overlayMode && (
        <section className="card grid">
          <h3>Overlay controls</h3>
          <label>
            Opacity
            <input
              type="range"
              min={0.4}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </label>
          <button onClick={() => void toggleClickThrough()}>
            Click-through: {clickThrough ? "On" : "Off"}
          </button>
          <p className="hint">
            If click-through locks you out: ⌘⇧I to interact, ⌘⇧L to toggle, ⌘⇧W to hide, ⌘⇧Q to quit.
          </p>
        </section>
      )}

      <section className="card">
        <h3>Live transcript</h3>
        <p className="hint">{listeningHint(listeningMode, audioInput)}</p>
        <pre>{transcript || "Interviewer questions will appear here..."}</pre>
      </section>

      <section className="card">
        <h3>Coaching answer</h3>
        <pre>{suggestion || "Suggested answers appear here."}</pre>
      </section>

      {(error || startError) && <p className="error">{error || startError}</p>}
    </div>
  );
}
