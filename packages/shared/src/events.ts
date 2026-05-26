export type RealtimeEventType =
  | "session.started"
  | "session.ended"
  | "transcript.partial"
  | "transcript.final"
  | "suggestion.partial"
  | "suggestion.final"
  | "error"
  | "ping"
  | "pong";

export interface RealtimeEvent<T = unknown> {
  type: RealtimeEventType;
  sessionId: string;
  timestamp: string;
  payload: T;
}

export interface TranscriptPayload {
  segmentId: string;
  speaker: "user" | "interviewer" | "unknown";
  text: string;
  isFinal: boolean;
  timestampMs: number;
}

export interface SuggestionPayload {
  outputId: string;
  content: string;
  isFinal: boolean;
}

export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface ClientAudioMessage {
  type: "audio";
  data: string;
  encoding: "pcm16" | "webm";
  sampleRate: number;
}

export interface ClientTranscriptMessage {
  type: "transcript";
  text: string;
  isFinal: boolean;
  speaker: "user" | "interviewer" | "unknown";
}

export interface ClientControlMessage {
  type: "control";
  action: "start" | "stop" | "pause" | "resume" | "mark_question";
}

export type ClientMessage = ClientAudioMessage | ClientTranscriptMessage | ClientControlMessage;
