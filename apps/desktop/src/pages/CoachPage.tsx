import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, getStoredToken } from "../lib/api";
import { startLiveCoach } from "../lib/startLiveCoach";
import {
  defaultAudioInputMode,
  isMacOsTauri,
  isSystemAudioSupportedOnPlatform,
  macOsSystemAudioHelpText,
} from "../lib/systemAudio";
import { useCoachState } from "../hooks/useCoachState";
import { requestMicrophonePermission, PermissionState } from "../lib/permissions";
import { AudioInputMode } from "../stores/coachTypes";
import { retryCoachConnection, stopCoachSession } from "../stores/sessionStore";

type Session = {
  id: string;
  title: string;
  status: string;
  config?: { mode?: string; company?: string };
};

function listeningHint(mode: string) {
  if (mode === "system") return "Listening to call/system audio from your screen share";
  if (mode === "both") return "Listening to call audio + your microphone";
  if (mode === "browser") return "Listening via live speech recognition (microphone)";
  if (mode === "server") return "Listening via server transcription (microphone)";
  return "Not listening yet";
}

export function CoachPage() {
  const token = getStoredToken();
  const [searchParams] = useSearchParams();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState(searchParams.get("session") || "");
  const [audioInput, setAudioInput] = useState<AudioInputMode>(defaultAudioInputMode());
  const [micPermission, setMicPermission] = useState<PermissionState>("unknown");
  const [permissionMessage, setPermissionMessage] = useState("");
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const coach = useCoachState();
  const active = coach.fsmState !== "idle" && coach.fsmState !== "ended";
  const systemAudioAvailable = isSystemAudioSupportedOnPlatform();

  useEffect(() => {
    if (token) {
      api.listSessions().then((list) => setSessions(list as Session[])).catch(() => undefined);
    }
  }, [token]);

  useEffect(() => {
    const fromQuery = searchParams.get("session");
    if (fromQuery) setSessionId(fromQuery);
  }, [searchParams]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey && event.code === "KeyD") {
        event.preventDefault();
        setShowDebug((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  async function handleStartCoaching() {
    setStartError("");
    const selected = sessions.find((s) => s.id === sessionId);
    if (!selected) {
      setStartError("Select a session first.");
      return;
    }
    setStarting(true);
    try {
      await startLiveCoach({
        sessionId: selected.id,
        title: selected.title,
        config: {
          mode: selected.config?.mode,
          company: selected.config?.company,
        },
        audioInput,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
              ? (err as { message: string }).message
              : "Could not start audio capture.";
      setStartError(message);
      try {
        await invoke("hide_overlay");
      } catch {
        // ignore
      }
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    await stopCoachSession();
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
          Start coaching opens the floating overlay and attaches it to this session. Speak questions aloud
          (or use ⌘⇧M to mark the last heard line as a question).
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
            <option value="mic">Microphone — recommended on macOS</option>
            {systemAudioAvailable && (
              <option value="system">Call audio (system)</option>
            )}
            {systemAudioAvailable && <option value="both">Call audio + microphone</option>}
          </select>
        </div>
        <div className="controls">
          {!active ? (
            <button className="primary" disabled={!sessionId || starting} onClick={() => void handleStartCoaching()}>
              {starting ? "Starting…" : "Start coaching"}
            </button>
          ) : (
            <button onClick={() => void handleStop()}>Stop coaching</button>
          )}
          {(coach.fsmState === "error" || coach.errorRecoverable) && (
            <button type="button" className="secondary" onClick={() => void retryCoachConnection()}>
              Retry connection
            </button>
          )}
          <span className="badge">{coach.connectionState}</span>
          <span className="badge">{coach.fsmState}</span>
        </div>
        {(isMacOsTauri() || !systemAudioAvailable) && (
          <p className="hint">{macOsSystemAudioHelpText()}</p>
        )}
      </section>

      <section className="card grid">
        <h3>Permissions</h3>
        <p className="hint">
          Grant microphone access before your first coaching session. LockedIn Copilot appears in macOS Privacy
          settings only after you allow access once.
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
            {showDebug ? "Hide debug" : "Show debug (⌘⇧D)"}
          </button>
        </div>
        <p className="hint">{listeningHint(coach.listeningMode)}</p>
        {coach.error && (
          <p className={coach.errorRecoverable ? "hint" : "error"}>
            {coach.errorRecoverable ? `Recoverable: ${coach.error}` : coach.error}
          </p>
        )}
        {coach.currentQuestion && (
          <p>
            <strong>Latest question:</strong> {coach.currentQuestion}
          </p>
        )}
        {coach.queuedQuestion && <p className="hint">Next question detected — queued</p>}
        {showDebug && (
          <div className="grid">
            <div className="grid grid-2">
              <div>
                <strong>FSM</strong>
                <p>{coach.fsmState}</p>
              </div>
              <div>
                <strong>Connection</strong>
                <p>{coach.connectionState}</p>
              </div>
              <div>
                <strong>Audio mode</strong>
                <p>{coach.metrics.audioMode}</p>
              </div>
              <div>
                <strong>Reconnects</strong>
                <p>{coach.metrics.reconnectCount}</p>
              </div>
              <div>
                <strong>Errors</strong>
                <p>{coach.metrics.errorCount}</p>
              </div>
              <div>
                <strong>STT latency</strong>
                <p>{coach.metrics.lastSttLatencyMs ?? "—"} ms</p>
              </div>
              <div>
                <strong>First token</strong>
                <p>{coach.metrics.firstTokenLatencyMs ?? "—"} ms</p>
              </div>
            </div>
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

      {startError && <p className="error">{startError}</p>}
    </div>
  );
}
