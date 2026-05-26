import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { useOverlayControls } from "../hooks/useOverlayControls";
import { useCoachState } from "../hooks/useCoachState";
import {
  COACH_CONTROL_EVENT,
  CoachControlPayload,
  SessionFsmState,
} from "../stores/coachTypes";
import "../styles/overlay.css";

function statusDot(
  fsm: SessionFsmState,
  connectionState: string,
  thinking: boolean,
  errorRecoverable: boolean,
) {
  if (fsm === "error" && !errorRecoverable) return "red";
  if (errorRecoverable || connectionState === "connecting" || connectionState === "reconnecting") {
    return "yellow";
  }
  if (thinking || fsm === "processing" || fsm === "answer_streaming") return "yellow";
  if (fsm === "active" && connectionState === "connected") return "green";
  return "gray";
}

function statusLabel(
  fsm: SessionFsmState,
  connectionState: string,
  thinking: boolean,
  turnPhase: string,
) {
  if (turnPhase === "your_turn") return "Your turn — answer now";
  if (turnPhase === "coaching" || thinking) return "Thinking…";
  if (fsm === "error") return "Error";
  if (connectionState === "reconnecting") return "Reconnecting…";
  if (connectionState === "connecting" || fsm === "connecting") return "Connecting…";
  if (fsm === "answer_streaming") return "Streaming…";
  if (fsm === "ending") return "Ending…";
  if (fsm === "ended") return "Ended";
  if (fsm === "active" || connectionState === "connected") return "Listening…";
  return "Idle";
}

function formatTranscriptTime(timestampMs: number) {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function speakerLabel(speaker: string) {
  return speaker === "user" ? "You" : "Interviewer";
}

export function OverlayPage() {
  const coach = useCoachState({ tauriEventsOnly: true });
  const { opacity, setOpacity, clickThrough, setClickThrough, toggleClickThrough, visualProfile, toggleVisualProfile } =
    useOverlayControls();
  const [flashFinal, setFlashFinal] = useState(false);
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; winX: number; winY: number } | null>(
    null,
  );
  const prevFinalRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add("overlay-root");
    void setClickThrough(false);
    return () => document.documentElement.classList.remove("overlay-root");
  }, [setClickThrough]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        void hideOverlay();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (coach.suggestionFinal && !prevFinalRef.current && coach.suggestion) {
      setFlashFinal(true);
      const timer = setTimeout(() => setFlashFinal(false), 600);
      prevFinalRef.current = true;
      return () => clearTimeout(timer);
    }
    if (!coach.suggestionFinal) prevFinalRef.current = false;
    return undefined;
  }, [coach.suggestion, coach.suggestionFinal]);

  async function emitControl(action: CoachControlPayload["action"]) {
    await emit(COACH_CONTROL_EVENT, { action });
  }

  async function hideOverlay() {
    await emitControl("hide");
  }

  async function stopSession() {
    await emitControl("stop");
  }

  async function copyAnswer() {
    if (!coach.suggestion || clickThrough) return;
    await navigator.clipboard.writeText(coach.suggestion);
  }

  async function onStatusMouseDown(event: React.MouseEvent) {
    if (clickThrough) return;
    event.preventDefault();
    try {
      const bounds = await invoke<{ x: number; y: number; width: number; height: number }>("get_overlay_bounds");
      dragRef.current = {
        dragging: true,
        startX: event.screenX,
        startY: event.screenY,
        winX: bounds.x,
        winY: bounds.y,
      };
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    async function onMouseMove(event: MouseEvent) {
      const drag = dragRef.current;
      if (!drag?.dragging || clickThrough) return;
      const dx = event.screenX - drag.startX;
      const dy = event.screenY - drag.startY;
      try {
        await invoke("set_overlay_position", { x: drag.winX + dx, y: drag.winY + dy });
      } catch {
        // ignore
      }
    }

    async function onMouseUp() {
      const drag = dragRef.current;
      if (!drag?.dragging) return;
      dragRef.current = null;
      try {
        await invoke("snap_overlay_nearest");
      } catch {
        // ignore snap failures
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [clickThrough]);

  const meta = [coach.sessionMode, coach.sessionCompany].filter(Boolean).join(" · ");
  const sessionActive =
    coach.fsmState !== "idle" && coach.fsmState !== "ended" && Boolean(coach.sessionId);
  const questionText = sessionActive
    ? coach.currentQuestion || coach.practiceQuestion || ""
    : "";
  const showLiveHeard =
    coach.livePartial &&
    coach.fsmState !== "idle" &&
    coach.fsmState !== "ended" &&
    coach.livePartial !== questionText;
  const recentTranscript = coach.transcriptFeed.slice(-4);

  return (
    <div
      className={`overlay-page ${visualProfile}`}
      style={{ ["--panel-alpha" as string]: String(opacity) }}
    >
      {coach.error && (
        <div className={`overlay-banner ${coach.errorRecoverable ? "recoverable" : "fatal"}`}>
          <span>{coach.errorRecoverable ? coach.error : `AI error — ${coach.error}`}</span>
          {(coach.errorRecoverable || coach.fsmState === "error") && (
            <button type="button" onClick={() => void emitControl("retry")}>
              Retry
            </button>
          )}
        </div>
      )}

      <div className="overlay-panel">
        <div
          className={`overlay-status ${clickThrough ? "locked" : ""}`}
          onMouseDown={(e) => void onStatusMouseDown(e)}
        >
          <span
            className={`status-dot ${statusDot(coach.fsmState, coach.connectionState, coach.thinking, coach.errorRecoverable)}`}
          />
          <strong>{statusLabel(coach.fsmState, coach.connectionState, coach.thinking, coach.turnPhase)}</strong>
          {meta && <span className="overlay-meta">{meta}</span>}
          {clickThrough ? (
            <span className="overlay-hint">⌘⇧I to interact</span>
          ) : (
            <button
              type="button"
              className="overlay-close"
              title="Hide overlay (session keeps running)"
              onClick={(e) => {
                e.stopPropagation();
                void hideOverlay();
              }}
            >
              ✕
            </button>
          )}
        </div>

        <div className="overlay-content">
          {!sessionActive ? (
            <p className="overlay-empty">Start coaching from Control Center</p>
          ) : (
            <>
              {showLiveHeard && (
                <div className="overlay-heard" aria-live="polite">
                  {coach.livePartial}
                </div>
              )}

              {recentTranscript.length > 0 && (
                <div className="overlay-transcript-feed">
                  {recentTranscript.map((entry) => (
                    <div key={entry.id} className="overlay-transcript-line">
                      <span className="overlay-transcript-meta">
                        {speakerLabel(entry.speaker)} · {formatTranscriptTime(entry.timestampMs)}
                      </span>
                      <span className="overlay-transcript-text">{entry.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {questionText ? (
                <div className="overlay-question">Q: {questionText}</div>
              ) : (
                <div className="overlay-question overlay-empty">
                  {coach.turnPhase === "your_turn"
                    ? "Answer the question aloud — coaching suggestion below"
                    : "Listening for the interviewer…"}
                </div>
              )}

              {coach.queuedQuestion && <div className="overlay-queued">Next question detected…</div>}

              <div
                className={`overlay-answer ${coach.thinking && !coach.suggestion ? "thinking" : ""} ${flashFinal ? "final-flash" : ""}`}
              >
                {coach.fsmState === "answer_streaming" && coach.suggestion
                  ? coach.suggestion
                  : coach.thinking && !coach.suggestion
                    ? "Thinking…"
                    : coach.suggestion ||
                      (coach.fsmState === "active"
                        ? coach.sessionStrategy === "critique"
                          ? "Feedback will appear here…"
                          : "Answer will appear here…"
                        : "")}
              </div>
            </>
          )}
        </div>

        <div className={`overlay-controls ${clickThrough ? "locked" : ""}`}>
          <button
            type="button"
            className="overlay-btn-label"
            title="Stop session"
            onClick={() => void stopSession()}
            disabled={clickThrough}
          >
            Stop
          </button>
          <input
            type="range"
            min={0.15}
            max={0.85}
            step={0.05}
            value={opacity}
            onChange={(e) => void setOpacity(Number(e.target.value))}
            disabled={clickThrough}
            title="Panel transparency"
          />
          <span className="overlay-opacity-label">{Math.round(opacity * 100)}%</span>
          <button
            type="button"
            className="overlay-btn-label"
            title="Toggle visual profile"
            onClick={() => void toggleVisualProfile()}
            disabled={clickThrough}
          >
            {visualProfile === "discrete" ? "Discrete" : "Focused"}
          </button>
          <button
            type="button"
            className={`overlay-btn-label overlay-lock-btn ${clickThrough ? "active locked" : ""}`}
            title={clickThrough ? "Locked — clicks pass through (⌘⇧I to unlock)" : "Interactive — click and drag"}
            onClick={() => void toggleClickThrough()}
          >
            {clickThrough ? "🔒 Locked" : "Interactive"}
          </button>
          <button
            type="button"
            className="overlay-btn-label"
            title="Copy answer"
            onClick={() => void copyAnswer()}
            disabled={clickThrough || !coach.suggestion}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
