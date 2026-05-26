export type SessionFsmState =
  | "idle"
  | "connecting"
  | "active"
  | "processing"
  | "answer_streaming"
  | "ending"
  | "ended"
  | "error";

export type AudioInputMode = "mic" | "system" | "both";
export type ListeningMode = "browser" | "server" | "system" | "both" | "none";
export type VisualProfile = "discrete" | "focused";
export type TurnPhase = "listening" | "your_turn" | "coaching";

export interface TranscriptFeedEntry {
  id: string;
  speaker: string;
  text: string;
  timestampMs: number;
  isFinal: boolean;
}

export interface CoachMetrics {
  reconnectCount: number;
  errorCount: number;
  lastSttLatencyMs: number | null;
  firstTokenLatencyMs: number | null;
  audioMode: AudioInputMode;
}

export interface CoachStateSnapshot {
  fsmState: SessionFsmState;
  sessionId: string;
  sessionTitle: string;
  sessionMode: string;
  sessionCompany: string;
  sessionStrategy: "live_answer" | "critique";
  practiceQuestion: string;
  connectionState: string;
  listeningMode: ListeningMode;
  turnPhase: TurnPhase;
  currentQuestion: string;
  livePartial: string;
  transcriptFeed: TranscriptFeedEntry[];
  suggestion: string;
  suggestionFinal: boolean;
  suggestionOutputId: string;
  queuedQuestion: boolean;
  thinking: boolean;
  transcriptHistory: Array<{ question: string; answer: string }>;
  error: string | null;
  errorRecoverable: boolean;
  visualProfile: VisualProfile;
  opacity: number;
  metrics: CoachMetrics;
}

export const COACH_STATE_EVENT = "coach/state";
export const COACH_CONTROL_EVENT = "coach/control";

export type CoachControlAction = "stop" | "retry" | "hide";

export interface CoachControlPayload {
  action: CoachControlAction;
}
