export type SessionMode = "behavioral" | "meeting" | "technical";
export type SessionStatus = "draft" | "active" | "paused" | "completed" | "failed";
export type ToneStyle = "concise" | "conversational" | "star";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  headline?: string;
  skills: string[];
  createdAt: string;
}

export interface SessionConfig {
  mode: SessionMode;
  company?: string;
  role?: string;
  tone: ToneStyle;
  customInstructions?: string;
  resumeContext?: string;
  jobDescriptionContext?: string;
}

export interface Session {
  id: string;
  userId: string;
  title: string;
  status: SessionStatus;
  config: SessionConfig;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  speaker: "user" | "interviewer" | "unknown";
  text: string;
  isFinal: boolean;
  timestampMs: number;
  createdAt: string;
}

export interface AiOutput {
  id: string;
  sessionId: string;
  kind: "suggestion" | "critique" | "summary";
  content: string;
  promptVersion: string;
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  sessionId: string;
  summary: string;
  questions: string[];
  feedbackBullets: string[];
  promptVersion: string;
  createdAt: string;
}

export interface DocumentRecord {
  id: string;
  userId: string;
  kind: "resume" | "job_description";
  filename: string;
  parseStatus: "pending" | "processing" | "completed" | "failed";
  parsedText?: string;
  createdAt: string;
}

export interface CreateSessionRequest {
  title: string;
  config: SessionConfig;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  user: UserProfile;
}
