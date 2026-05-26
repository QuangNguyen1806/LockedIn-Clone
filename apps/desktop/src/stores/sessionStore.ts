import { emit, listen } from "@tauri-apps/api/event";
import { buildWsUrl, getStoredToken, api } from "../lib/api";
import { requestSystemAudioStream, formatSystemAudioError } from "../lib/systemAudio";
import {
  AudioInputMode,
  CoachControlPayload,
  CoachStateSnapshot,
  COACH_CONTROL_EVENT,
  COACH_STATE_EVENT,
  ListeningMode,
  SessionFsmState,
  VisualProfile,
} from "./coachTypes";

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const listeners = new Set<(state: CoachStateSnapshot) => void>();
let controlUnlisten: (() => void) | null = null;
let markQuestionUnlisten: (() => void) | null = null;

async function ensureControlListeners() {
  if (!controlUnlisten) {
    const unlisten = await listen<CoachControlPayload>(COACH_CONTROL_EVENT, (event) => {
      if (event.payload.action === "stop") {
        void stopCoachSession();
      }
      if (event.payload.action === "retry") {
        reconnectAttempts = 0;
        void connect();
      }
      if (event.payload.action === "dismiss") {
        void dismissOverlay();
      }
    });
    controlUnlisten = unlisten;
  }
  if (!markQuestionUnlisten) {
    markQuestionUnlisten = await listen("coach/mark-question", () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "control", action: "mark_question" }));
      }
    });
  }
}

let ws: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let mediaRecorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let systemStream: MediaStream | null = null;
let recognition: SpeechRecognitionLike | null = null;
let reconnectAttempts = 0;
let active = false;
let audioInput: AudioInputMode = "system";
let sessionId = "";
let sessionTitle = "";
let sessionMode = "";
let sessionCompany = "";
let suggestionTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSuggestion = "";
let pendingSuggestionOutputId = "";
let pendingSuggestionFinal = false;

const state: CoachStateSnapshot = {
  fsmState: "idle",
  sessionId: "",
  sessionTitle: "",
  sessionMode: "",
  sessionCompany: "",
  sessionStrategy: "live_answer",
  connectionState: "idle",
  listeningMode: "none",
  currentQuestion: "",
  livePartial: "",
  suggestion: "",
  suggestionFinal: false,
  suggestionOutputId: "",
  queuedQuestion: false,
  thinking: false,
  transcriptHistory: [],
  error: null,
  visualProfile: "discrete",
  opacity: 0.45,
};

function notify() {
  const snapshot = { ...state, transcriptHistory: [...state.transcriptHistory] };
  listeners.forEach((listener) => listener(snapshot));
  void emit(COACH_STATE_EVENT, snapshot).catch(() => undefined);
}

function setFsm(next: SessionFsmState) {
  state.fsmState = next;
  notify();
}

function setError(message: string | null) {
  state.error = message;
  if (message) {
    state.fsmState = "error";
    state.connectionState = "error";
  }
  notify();
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function attachMediaRecorder(target: MediaStream) {
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  mediaRecorder = new MediaRecorder(target, { mimeType });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      void sendAudioChunk(event.data);
    }
  };
  mediaRecorder.start(2000);
}

async function sendAudioChunk(blob: Blob) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  ws.send(
    JSON.stringify({
      type: "audio",
      data: btoa(binary),
      encoding: "webm",
      sampleRate: 16000,
    }),
  );
}

function sendTranscript(text: string, isFinal: boolean) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return;
  ws.send(
    JSON.stringify({
      type: "transcript",
      text: text.trim(),
      isFinal,
      speaker: "interviewer",
    }),
  );
}

function flushSuggestion() {
  if (suggestionTimer) {
    clearTimeout(suggestionTimer);
    suggestionTimer = null;
  }
  state.suggestion = pendingSuggestion;
  state.suggestionOutputId = pendingSuggestionOutputId;
  state.suggestionFinal = pendingSuggestionFinal;
  if (pendingSuggestionFinal) {
    state.thinking = false;
    state.queuedQuestion = false;
    if (state.fsmState !== "error") {
      state.fsmState = "active";
    }
    const last = state.transcriptHistory[state.transcriptHistory.length - 1];
    if (last) {
      last.answer = pendingSuggestion;
    } else if (state.currentQuestion) {
      state.transcriptHistory = [
        ...state.transcriptHistory.slice(-4),
        { question: state.currentQuestion, answer: pendingSuggestion },
      ];
    }
  }
  notify();
}

function queueSuggestionUpdate(content: string, outputId: string, isFinal: boolean) {
  if (outputId && state.suggestionOutputId && outputId !== state.suggestionOutputId && !isFinal) {
    return;
  }
  pendingSuggestion = content;
  pendingSuggestionOutputId = outputId;
  pendingSuggestionFinal = isFinal;
  if (suggestionTimer) return;
  suggestionTimer = setTimeout(() => {
    suggestionTimer = null;
    flushSuggestion();
    if (!pendingSuggestionFinal && pendingSuggestion) {
      queueSuggestionUpdate(pendingSuggestion, pendingSuggestionOutputId, pendingSuggestionFinal);
    }
  }, 80);
}

function stopCaptureTracks() {
  recognition?.stop();
  recognition = null;
  mediaRecorder?.stop();
  mediaRecorder = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  systemStream?.getTracks().forEach((track) => track.stop());
  systemStream = null;
  state.listeningMode = "none";
}

async function requestMicrophone() {
  const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (!stream) stream = micStream;
  return micStream;
}

async function startBrowserSpeech() {
  const SpeechRecognitionCtor = getSpeechRecognition();
  if (!SpeechRecognitionCtor) return false;
  await requestMicrophone();
  const rec = new SpeechRecognitionCtor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  rec.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript || "";
      if (result.isFinal) finalText += text;
      else interim += text;
    }
    if (interim && state.visualProfile === "focused") {
      state.livePartial = interim;
      sendTranscript(interim, false);
      notify();
    }
    if (finalText.trim()) {
      state.currentQuestion = finalText.trim();
      state.livePartial = "";
      sendTranscript(finalText.trim(), true);
      notify();
    }
  };
  rec.onerror = (event) => {
    if (event.error && event.error !== "no-speech") {
      setError(`Speech recognition error: ${event.error}`);
    }
  };
  rec.onend = () => {
    if (ws?.readyState === WebSocket.OPEN && active) {
      try {
        rec.start();
      } catch {
        // ignore restart race
      }
    }
  };
  rec.start();
  recognition = rec;
  return true;
}

function attachSystemStream(target: MediaStream) {
  stream = target;
  attachMediaRecorder(target);
  state.listeningMode = "system";
}

async function startCaptureFromPrepared() {
  if (audioInput === "system") {
    if (!systemStream) {
      setError("System audio was not prepared. Click Start coaching again.");
      return;
    }
    attachSystemStream(systemStream);
    return;
  }

  if (audioInput === "both") {
    if (systemStream) {
      attachSystemStream(systemStream);
    }
    const browserStarted = await startBrowserSpeech();
    state.listeningMode = systemStream && browserStarted ? "both" : browserStarted ? "browser" : "system";
    notify();
    return;
  }

  const browserStarted = await startBrowserSpeech();
  if (!browserStarted) {
    const micStream = stream || (await requestMicrophone());
    if (!stream) stream = micStream;
    attachMediaRecorder(micStream);
    state.listeningMode = "server";
  } else {
    state.listeningMode = "browser";
  }
  notify();
}

async function rehydrateSession(id: string) {
  try {
    const detail = (await api.getSession(id)) as {
      transcript?: Array<{ speaker: string; text: string }>;
      aiOutputs?: Array<{ content: string; kind: string }>;
    };
    const finals = (detail.transcript || []).filter((segment) => segment.speaker === "interviewer");
    if (finals.length > 0) {
      state.currentQuestion = finals[finals.length - 1]?.text || "";
    }
    const outputs = (detail.aiOutputs || []).filter(
      (output) => output.kind === "suggestion" || output.kind === "critique",
    );
    if (outputs.length > 0) {
      state.suggestion = outputs[outputs.length - 1]?.content || "";
      state.suggestionFinal = true;
    }
    state.transcriptHistory = finals.slice(-5).map((segment, index) => ({
      question: segment.text,
      answer: outputs[index]?.content || "",
    }));
    notify();
  } catch {
    // ignore rehydrate failures
  }
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

async function connect() {
  const token = getStoredToken();
  if (!sessionId || !token) return;

  const wasReconnect = reconnectAttempts > 0;
  state.connectionState = wasReconnect ? "reconnecting" : "connecting";
  if (reconnectAttempts === 0) {
    setFsm("connecting");
  } else {
    notify();
  }

  ws = new WebSocket(buildWsUrl(sessionId, token));

  ws.onopen = async () => {
    state.connectionState = "connected";
    setFsm("active");
    reconnectAttempts = 0;
    startPing();
    await startCaptureFromPrepared();
    if (wasReconnect) {
      await rehydrateSession(sessionId);
    }
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const payload = message.payload || {};

    if (message.type === "pong") {
      return;
    }
    if (message.type === "session.started") {
      setFsm("active");
    }
    if (message.type === "session.ended") {
      setFsm("ended");
    }
    if (message.type === "transcript.partial") {
      if (payload.speaker === "interviewer" && state.visualProfile === "focused") {
        state.livePartial = payload.text || "";
        notify();
      }
    }
    if (message.type === "transcript.final") {
      if (payload.speaker && payload.speaker !== "interviewer") {
        return;
      }
      const line = payload.text || "";
      if (line) {
        if (state.thinking && state.currentQuestion) {
          state.queuedQuestion = true;
        }
        state.currentQuestion = line;
        state.livePartial = "";
        notify();
      }
    }
    if (message.type === "suggestion.partial") {
      state.thinking = true;
      state.fsmState = "processing";
      queueSuggestionUpdate(payload.content || "", payload.outputId || "", false);
    }
    if (message.type === "suggestion.final") {
      queueSuggestionUpdate(payload.content || "", payload.outputId || "", true);
    }
    if (message.type === "error") {
      const recoverable = Boolean(payload.recoverable);
      if (recoverable) {
        state.error = payload.message || "Realtime error";
        notify();
      } else {
        setError(payload.message || "Realtime error");
      }
    }
  };

  ws.onclose = () => {
    stopPing();
    mediaRecorder?.stop();
    mediaRecorder = null;
    recognition?.stop();
    recognition = null;

    if (active && reconnectAttempts < 5 && systemStream?.getAudioTracks().some((t) => t.readyState === "live")) {
      reconnectAttempts += 1;
      const delay = [1000, 2000, 5000][Math.min(reconnectAttempts - 1, 2)] || 5000;
      state.connectionState = "reconnecting";
      notify();
      setTimeout(() => void connect(), delay);
      return;
    }

    if (active && reconnectAttempts >= 5) {
      setError("Connection lost. Restart coaching from Control Center.");
    }
    stopCaptureTracks();
    if (!active) {
      state.connectionState = "idle";
      notify();
    }
  };

  ws.onerror = () => {
    setError("WebSocket connection failed");
  };
}

export function subscribeCoachState(listener: (snapshot: CoachStateSnapshot) => void) {
  listeners.add(listener);
  listener({ ...state, transcriptHistory: [...state.transcriptHistory] });
  return () => {
    listeners.delete(listener);
  };
}

export function getCoachState() {
  return { ...state, transcriptHistory: [...state.transcriptHistory] };
}

export async function prepareCoachCapture(nextAudioInput: AudioInputMode) {
  audioInput = nextAudioInput;
  systemStream?.getTracks().forEach((track) => track.stop());
  systemStream = null;

  if (audioInput === "system" || audioInput === "both") {
    try {
      systemStream = await requestSystemAudioStream();
    } catch (err) {
      throw new Error(formatSystemAudioError(err));
    }
  }

  if (audioInput === "mic" || audioInput === "both") {
    try {
      await requestMicrophone();
    } catch {
      throw new Error(
        "Microphone access denied. Open System Settings → Privacy & Security → Microphone and allow LockedIn Copilot.",
      );
    }
  }
}

export async function startCoachSession(options: {
  sessionId: string;
  sessionTitle: string;
  sessionMode?: string;
  sessionCompany?: string;
  sessionStrategy?: "live_answer" | "critique";
  audioInput: AudioInputMode;
}) {
  if (active) return;
  sessionId = options.sessionId;
  sessionTitle = options.sessionTitle;
  sessionMode = options.sessionMode || "";
  sessionCompany = options.sessionCompany || "";
  audioInput = options.audioInput;
  active = true;
  reconnectAttempts = 0;
  state.sessionId = sessionId;
  state.sessionTitle = sessionTitle;
  state.sessionMode = sessionMode;
  state.sessionCompany = sessionCompany;
  state.sessionStrategy = options.sessionStrategy || "live_answer";
  state.currentQuestion = "";
  state.livePartial = "";
  state.suggestion = "";
  state.suggestionFinal = false;
  state.transcriptHistory = [];
  state.error = null;
  state.queuedQuestion = false;
  state.thinking = false;

  if (!controlUnlisten) {
    await ensureControlListeners();
  }

  await connect();
}

export async function stopCoachSession() {
  active = false;
  reconnectAttempts = 99;
  setFsm("ending");
  stopPing();
  stopCaptureTracks();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "control", action: "stop" }));
    ws.close();
  }
  ws = null;
  state.connectionState = "idle";
  state.listeningMode = "none";
  setFsm("ended");
}

export function resetCoachState() {
  active = false;
  reconnectAttempts = 0;
  sessionId = "";
  sessionTitle = "";
  sessionMode = "";
  sessionCompany = "";
  ws = null;
  state.fsmState = "idle";
  state.sessionId = "";
  state.sessionTitle = "";
  state.sessionMode = "";
  state.sessionCompany = "";
  state.sessionStrategy = "live_answer";
  state.connectionState = "idle";
  state.listeningMode = "none";
  state.currentQuestion = "";
  state.livePartial = "";
  state.suggestion = "";
  state.suggestionFinal = false;
  state.suggestionOutputId = "";
  state.queuedQuestion = false;
  state.thinking = false;
  state.transcriptHistory = [];
  state.error = null;
  notify();
}

export async function dismissOverlay() {
  if (active) {
    await stopCoachSession();
  } else {
    resetCoachState();
  }
}

export function setCoachVisualProfile(profile: VisualProfile) {
  state.visualProfile = profile;
  notify();
}

export function setCoachOpacity(opacity: number) {
  state.opacity = opacity;
  notify();
}

export async function initCoachBus() {
  await ensureControlListeners();
}

export function isSystemAudioSupported() {
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}
