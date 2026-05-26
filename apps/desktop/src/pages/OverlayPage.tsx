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

function statusDot(fsm: SessionFsmState, connectionState: string, thinking: boolean) {
  if (fsm === "error") return "red";
  if (connectionState === "connecting" || connectionState === "reconnecting") return "yellow";
  if (thinking || fsm === "processing") return "yellow";
  if (fsm === "active" && connectionState === "connected") return "green";
  return "gray";
}

function statusLabel(fsm: SessionFsmState, connectionState: string, thinking: boolean) {
  if (fsm === "error") return "Error";
  if (connectionState === "reconnecting") return "Reconnecting…";
  if (connectionState === "connecting" || fsm === "connecting") return "Connecting…";
  if (thinking || fsm === "processing") return "Thinking…";
  if (fsm === "ending") return "Ending…";
  if (fsm === "ended") return "Ended";
  if (fsm === "active") return "Listening…";
  return "Idle";
}

function nearestCorner(x: number, y: number, width: number, height: number, screenW: number, screenH: number) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const left = cx < screenW / 2;
  const top = cy < screenH / 2;
  if (top && left) return "top-left";
  if (top && !left) return "top-right";
  if (!top && left) return "bottom-left";
  return "bottom-right";
}

export function OverlayPage() {
  const coach = useCoachState({ tauriEventsOnly: true });
  const { opacity, setOpacity, clickThrough, toggleClickThrough, visualProfile, toggleVisualProfile } =
    useOverlayControls();
  const [flashFinal, setFlashFinal] = useState(false);
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; winX: number; winY: number } | null>(
    null,
  );
  const prevFinalRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add("overlay-root");
    return () => document.documentElement.classList.remove("overlay-root");
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

  async function dismissOverlayWindow() {
    await emitControl("dismiss");
    try {
      await invoke("hide_overlay");
    } catch {
      // browser dev fallback
    }
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
      if (!drag?.dragging) return;
      const dx = event.screenX - drag.startX;
      const dy = event.screenY - drag.startY;
      try {
        await invoke("set_overlay_position", { x: drag.winX + dx, y: drag.winY + dy });
      } catch {
        // ignore
      }
    }

    async function onMouseUp(event: MouseEvent) {
      const drag = dragRef.current;
      if (!drag?.dragging) return;
      dragRef.current = null;
      try {
        const bounds = await invoke<{ x: number; y: number; width: number; height: number }>("get_overlay_bounds");
        const monitor = window.screen;
        const corner = nearestCorner(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          monitor.availWidth,
          monitor.availHeight,
        );
        await invoke("snap_overlay", { corner });
      } catch {
        // ignore snap failures
      }
      void event;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const meta = [coach.sessionMode, coach.sessionCompany].filter(Boolean).join(" · ");
  const showPartial =
    visualProfile === "focused" && coach.livePartial && !coach.thinking && coach.fsmState !== "processing";

  return (
    <div
      className={`overlay-page ${visualProfile}`}
      style={{ opacity: visualProfile === "discrete" ? opacity : 1 }}
    >
      <div className="overlay-panel">
        <div className="overlay-status" onMouseDown={(e) => void onStatusMouseDown(e)}>
          <span className={`status-dot ${statusDot(coach.fsmState, coach.connectionState, coach.thinking)}`} />
          <strong>{statusLabel(coach.fsmState, coach.connectionState, coach.thinking)}</strong>
          {meta && <span className="overlay-meta">{meta}</span>}
          <button
            type="button"
            className="overlay-close"
            title="Close overlay"
            onClick={(e) => {
              e.stopPropagation();
              void dismissOverlayWindow();
            }}
          >
            ✕
          </button>
        </div>

        <div className="overlay-content">
          {coach.fsmState === "idle" && !coach.sessionId ? (
            <p className="overlay-empty">Start coaching from Control Center</p>
          ) : (
            <>
              {coach.currentQuestion ? (
                <div className="overlay-question">Q: {coach.currentQuestion}</div>
              ) : (
                <div className="overlay-question overlay-empty">Waiting for a question…</div>
              )}
              {showPartial && <div className="overlay-question overlay-empty">{coach.livePartial}</div>}
              {coach.queuedQuestion && <div className="overlay-queued">Next question detected…</div>}
              <div
                className={`overlay-answer ${coach.thinking && !coach.suggestion ? "thinking" : ""} ${flashFinal ? "final-flash" : ""}`}
              >
                {coach.thinking && !coach.suggestion
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

        {coach.error && <div className="overlay-error">{coach.error}</div>}

        <div className="overlay-controls">
          <button type="button" title="Stop" onClick={() => void dismissOverlayWindow()} disabled={clickThrough}>
            ⏹
          </button>
          <input
            type="range"
            min={0.25}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => void setOpacity(Number(e.target.value))}
            disabled={clickThrough}
            title="Opacity"
          />
          <button type="button" title="Visual profile" onClick={() => void toggleVisualProfile()}>
            👁
          </button>
          <button type="button" title="Click-through" onClick={() => void toggleClickThrough()}>
            {clickThrough ? "🔒" : "🔓"}
          </button>
          <button type="button" title="Copy answer" onClick={() => void copyAnswer()} disabled={clickThrough || !coach.suggestion}>
            📋
          </button>
          {coach.fsmState === "error" && (
            <button type="button" onClick={() => void emitControl("retry")}>
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
