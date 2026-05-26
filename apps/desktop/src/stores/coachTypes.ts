export type SessionFsmState =
  | "idle"
  | "connecting"
  | "active"
  | "processing"
  | "ending"
  | "ended"
  | "error";

export type AudioInputMode = "mic" | "system" | "both";
export type ListeningMode = "browser" | "server" | "system" | "both" | "none";
export type VisualProfile = "discrete" | "focused";

export interface CoachStateSnapshot {
  fsmState: SessionFsmState;
  sessionId: string;
  sessionTitle: string;
  sessionMode: string;
  sessionCompany: string;
  sessionStrategy: "live_answer" | "critique";
  connectionState: string;
  listeningMode: ListeningMode;
  currentQuestion: string;
  livePartial: string;
  suggestion: string;
  suggestionFinal: boolean;
  suggestionOutputId: string;
  queuedQuestion: boolean;
  thinking: boolean;
  transcriptHistory: Array<{ question: string; answer: string }>;
  error: string | null;
  visualProfile: VisualProfile;
  opacity: number;
}

export const COACH_STATE_EVENT = "coach/state";
export const COACH_CONTROL_EVENT = "coach/control";

export type CoachControlAction = "stop" | "retry" | "dismiss";

export interface CoachControlPayload {
  action: CoachControlAction;
}
