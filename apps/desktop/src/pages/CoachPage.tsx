import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, getStoredToken } from "../lib/api";
import { useCoachState } from "../hooks/useCoachState";
import { requestMicrophonePermission, PermissionState } from "../lib/permissions";
import { AudioInputMode } from "../stores/coachTypes";
import {
  isSystemAudioSupported,
  prepareCoachCapture,
  startCoachSession,
  stopCoachSession,
} from "../stores/sessionStore";

type Session = {
  id: string;
  title: string;
  status: string;
  config?: { mode?: string; company?: string };
};

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
  const [micPermission, setMicPermission] = useState<PermissionState>("unknown");
  const [permissionMessage, setPermissionMessage] = useState("");
  const [startError, setStartError] = useState("");
  const [showMicFallback, setShowMicFallback] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const coach = useCoachState();
  const active = coach.fsmState !== "idle" && coach.fsmState !== "ended";

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
      setPermissionMessage(
        "Microphone enabled. LockedIn Copilot should now appear in System Settings → Privacy & Security → Microphone.",
      );
    } else if (result === "denied") {
      setPermissionMessage(
        "Microphone access denied. Open System Settings → Privacy & Security → Microphone, allow LockedIn Copilot, then restart the app.",
      );
    } else {
      setPermissionMessage("Microphone access is not available in this environment.");
    }
  }

  async function handleStartCoaching(nextAudioInput: AudioInputMode = audioInput) {
    setStartError("");
    setShowMicFallback(false);
    const selected = sessions.find((s) => s.id === sessionId);
    if (!selected) {
      setStartError("Select a session first.");
      return;
    }
    try {
      await prepareCoachCapture(nextAudioInput);
      await invoke("show_overlay");
      await startCoachSession({
        sessionId: selected.id,
        sessionTitle: selected.title,
        sessionMode: selected.config?.mode || "",
        sessionCompany: selected.config?.company || "",
        audioInput: nextAudioInput,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start audio capture.";
      setStartError(message);
      setShowMicFallback(nextAudioInput !== "mic");
      try {
        await invoke("hide_overlay");
      } catch {
        // ignore
      }
    }
  }

  async function handleStop() {
    await stopCoachSession();
    try {
      await invoke("hide_overlay");
    } catch {
      // browser dev fallback
    }
  }

  async function handleHide() {
    await handleStop();
    try {
      await invoke("hide_window");
    } catch {
      // browser dev fallback
    }
  }

  return (
    <div className="coach-page">
      <section className="card">
        <div className="coach-header">
          <h2>Live Coach</h2>
          <div className="controls">
            <button type="button" className="secondary" onClick={() => void handleHide()}>
              Hide to tray
            </button>
          </div>
        </div>
        <p className="muted">
          Start coaching to open the overlay window. Capture interview questions from your video call and get
          real-time answers grounded in your resume and job description.
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
            <button onClick={() => void handleStop()}>Stop coaching</button>
          )}
          <span className="badge">{coach.connectionState}</span>
          <span className="badge">{coach.fsmState}</span>
        </div>
        {audioInput !== "mic" && (
          <p className="hint">
            On macOS, call-audio capture is unreliable in desktop apps. If screen share succeeds but audio
            fails, use <strong>Microphone only</strong> and point your mic at the call (or use speakers).
          </p>
        )}
        {showMicFallback && (
          <div className="controls">
            <button type="button" className="primary" onClick={() => void handleStartCoaching("mic")}>
              Start with microphone instead
            </button>
          </div>
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

      <section className="card">
        <div className="coach-header">
          <h3>Live status</h3>
          <button type="button" className="secondary" onClick={() => setShowDebug((v) => !v)}>
            {showDebug ? "Hide debug" : "Show debug transcript"}
          </button>
        </div>
        <p className="hint">{listeningHint(coach.listeningMode, audioInput)}</p>
        {coach.currentQuestion && (
          <p>
            <strong>Latest question:</strong> {coach.currentQuestion}
          </p>
        )}
        {coach.queuedQuestion && <p className="hint">Next question detected — queued</p>}
        {showDebug && (
          <div className="grid">
            {coach.transcriptHistory.length === 0 ? (
              <pre className="muted">No Q/A pairs yet.</pre>
            ) : (
              coach.transcriptHistory.map((pair, idx) => (
                <div key={idx}>
                  <p>
                    <strong>Q:</strong> {pair.question}
                  </p>
                  <pre>{pair.answer || "(pending answer)"}</pre>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {(coach.error || startError) && <p className="error">{coach.error || startError}</p>}
    </div>
  );
}
