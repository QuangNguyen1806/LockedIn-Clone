import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { buildWsUrl, getStoredToken, api } from "../lib/api";
import { requestSystemAudioStream, formatSystemAudioError, normalizeAudioInput } from "../lib/systemAudio";
import {
  AudioInputMode,
  CoachControlPayload,
  CoachMetrics,
  CoachStateSnapshot,
  COACH_CONTROL_EVENT,
  COACH_STATE_EVENT,
  ListeningMode,
  SessionFsmState,
  TranscriptFeedEntry,
  TurnPhase,
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
let questionReceivedAt: number | null = null;
let firstPartialAt: number | null = null;
let lastAudioSentAt: number | null = null;
let vadContext: AudioContext | null = null;
let vadAnalyser: AnalyserNode | null = null;
let vadTimer: ReturnType<typeof setInterval> | null = null;
let vadSpeechActive = false;
let vadLastSpeechAt = 0;
let utteranceChunks: Blob[] = [];
const SILENCE_MS = 2800;
const SPEECH_THRESHOLD = 10;
const MIN_UTTERANCE_BYTES = 2048;

const STT_REFUSAL_PATTERNS = [
  /\bi(?:'m| am) sorry\b/i,
  /\bcannot access\b/i,
  /\bcan't access\b/i,
  /\bunable to\b/i,
  /\bcannot process\b/i,
  /\bcan't process\b/i,
  /\baudio file/i,
  /\baudio clip/i,
  /\bexternal audio\b/i,
  /\btext-based (?:questions|interactions|format)\b/i,
];

function isSttRefusal(text: string): boolean {
  const cleaned = text.trim();
  if (!cleaned) return true;
  return STT_REFUSAL_PATTERNS.some((pattern) => pattern.test(cleaned));
}

const defaultMetrics = (): CoachMetrics => ({
  reconnectCount: 0,
  errorCount: 0,
  lastSttLatencyMs: null,
  firstTokenLatencyMs: null,
  audioMode: "system",
});

const state: CoachStateSnapshot = {
  fsmState: "idle",
  sessionId: "",
  sessionTitle: "",
  sessionMode: "",
  sessionCompany: "",
  sessionStrategy: "live_answer",
  practiceQuestion: "",
  connectionState: "idle",
  listeningMode: "none",
  turnPhase: "listening",
  currentQuestion: "",
  livePartial: "",
  transcriptFeed: [],
  suggestion: "",
  suggestionFinal: false,
  suggestionOutputId: "",
  queuedQuestion: false,
  thinking: false,
  transcriptHistory: [],
  error: null,
  errorRecoverable: false,
  visualProfile: "discrete",
  opacity: 0.42,
  metrics: defaultMetrics(),
};

function pushTranscriptFeed(entry: Omit<TranscriptFeedEntry, "id"> & { id?: string }) {
  const next: TranscriptFeedEntry = {
    id: entry.id || `${entry.timestampMs}-${state.transcriptFeed.length}`,
    speaker: entry.speaker,
    text: entry.text,
    timestampMs: entry.timestampMs,
    isFinal: entry.isFinal,
  };
  state.transcriptFeed = [...state.transcriptFeed.slice(-11), next];
}

function notify() {
  const snapshot = {
    ...state,
    transcriptHistory: [...state.transcriptHistory],
    transcriptFeed: [...state.transcriptFeed],
    metrics: { ...state.metrics },
  };
  listeners.forEach((listener) => listener(snapshot));
  void emit(COACH_STATE_EVENT, snapshot).catch(() => undefined);
}

function setFsm(next: SessionFsmState) {
  state.fsmState = next;
  notify();
}

function sanitizeClientError(message: string): string {
  if (/generativelanguage|key=|Bad Request for url/i.test(message)) {
    return "Could not transcribe that phrase. Pause when the interviewer finishes, then try again.";
  }
  return message;
}

function setRecoverableError(message: string) {
  state.error = sanitizeClientError(message);
  state.errorRecoverable = true;
  state.metrics.errorCount += 1;
  notify();
}

function setFatalError(message: string) {
  state.error = message;
  state.errorRecoverable = false;
  state.fsmState = "error";
  state.connectionState = "error";
  state.metrics.errorCount += 1;
  notify();
}

function clearError() {
  state.error = null;
  state.errorRecoverable = false;
  notify();
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function captureErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const record = err as { message?: unknown; name?: unknown };
    if (typeof record.message === "string" && record.message) return record.message;
    if (typeof record.name === "string" && record.name) return record.name;
  }
  return fallback;
}

let recorderEncoding: "webm" | "mp4" = "webm";

function attachMediaRecorder(target: MediaStream) {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    return;
  }

  const isTauri = "__TAURI_INTERNALS__" in window;
  const candidates: Array<{ mimeType?: string; encoding: "webm" | "mp4" }> = isTauri
    ? [
        { encoding: "webm", mimeType: "audio/webm" },
        { encoding: "webm" },
        { encoding: "mp4", mimeType: "audio/mp4" },
      ]
    : [
        { encoding: "webm", mimeType: "audio/webm;codecs=opus" },
        { encoding: "webm", mimeType: "audio/webm" },
        { encoding: "mp4", mimeType: "audio/mp4" },
        { encoding: "webm" },
      ];

  let lastErr: unknown;
  for (const candidate of candidates) {
    if (candidate.mimeType && !MediaRecorder.isTypeSupported(candidate.mimeType)) {
      continue;
    }
    try {
      mediaRecorder = candidate.mimeType
        ? new MediaRecorder(target, { mimeType: candidate.mimeType })
        : new MediaRecorder(target);
      recorderEncoding = candidate.encoding;
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!mediaRecorder) {
    throw new Error(
      captureErrorMessage(
        lastErr,
        "Could not start microphone recording. Allow mic access in System Settings → Privacy & Security → Microphone, then restart the app.",
      ),
    );
  }

  mediaRecorder.onerror = () => {
    setRecoverableError("Microphone recording failed. Try stopping and starting again.");
  };
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 64) {
      utteranceChunks.push(event.data);
    }
  };
  utteranceChunks = [];
  mediaRecorder.start(500);
  startSpeechVad(target);
}

function stopSpeechVad() {
  if (vadTimer) {
    clearInterval(vadTimer);
    vadTimer = null;
  }
  vadAnalyser = null;
  vadSpeechActive = false;
  vadLastSpeechAt = 0;
  if (vadContext) {
    void vadContext.close().catch(() => undefined);
    vadContext = null;
  }
}

function startSpeechVad(target: MediaStream) {
  stopSpeechVad();
  try {
    vadContext = new AudioContext();
    const source = vadContext.createMediaStreamSource(target);
    const analyser = vadContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.65;
    source.connect(analyser);
    vadAnalyser = analyser;
    vadTimer = setInterval(() => {
      if (!vadAnalyser || !ws || ws.readyState !== WebSocket.OPEN || !active) return;
      const bins = new Uint8Array(vadAnalyser.frequencyBinCount);
      vadAnalyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i += 1) sum += bins[i];
      const level = sum / bins.length;
      const now = Date.now();
      if (level > SPEECH_THRESHOLD) {
        if (!vadSpeechActive) {
          utteranceChunks = [];
          clearError();
        }
        vadSpeechActive = true;
        vadLastSpeechAt = now;
      } else if (vadSpeechActive && now - vadLastSpeechAt >= SILENCE_MS) {
        vadSpeechActive = false;
        void signalUtteranceEnd();
      }
    }, 150);
  } catch {
    // VAD optional — utterance_end still available via ⌘⇧M
  }
}

async function signalUtteranceEnd() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (state.turnPhase === "your_turn" || state.turnPhase === "coaching") return;
  if (utteranceChunks.length && mediaRecorder) {
    const mimeType = mediaRecorder.mimeType || "audio/webm";
    const blob = new Blob(utteranceChunks, { type: mimeType });
    utteranceChunks = [];
    if (blob.size >= MIN_UTTERANCE_BYTES) {
      await sendAudioChunk(blob);
    }
  } else {
    utteranceChunks = [];
  }
  ws.send(JSON.stringify({ type: "control", action: "utterance_end" }));
}

async function sendAudioChunk(blob: Blob) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  lastAudioSentAt = Date.now();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  ws.send(
    JSON.stringify({
      type: "audio",
      data: btoa(binary),
      encoding: recorderEncoding,
      sampleRate: 16000,
    }),
  );
}

function sendTranscript(text: string, isFinal: boolean, speaker: "interviewer" | "user" = "interviewer") {
  if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return;
  ws.send(
    JSON.stringify({
      type: "transcript",
      text: text.trim(),
      isFinal,
      speaker,
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
  } else if (pendingSuggestion) {
    state.fsmState = "answer_streaming";
  }
  notify();
}

function queueSuggestionUpdate(content: string, outputId: string, isFinal: boolean) {
  if (outputId && state.suggestionOutputId && outputId !== state.suggestionOutputId && !isFinal) {
    return;
  }
  if (!firstPartialAt && content) {
    firstPartialAt = Date.now();
    if (questionReceivedAt) {
      state.metrics.firstTokenLatencyMs = firstPartialAt - questionReceivedAt;
    }
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
  stopSpeechVad();
  utteranceChunks = [];
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
  try {
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!stream) stream = micStream;
    return micStream;
  } catch (err) {
    const name =
      err instanceof DOMException
        ? err.name
        : err && typeof err === "object" && "name" in err
          ? String((err as { name: unknown }).name)
          : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new Error(
        "Microphone access denied. Open System Settings → Privacy & Security → Microphone, enable LockedIn Copilot, then restart the app.",
      );
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      throw new Error("No microphone found. Connect a mic or choose a different audio source.");
    }
    throw new Error(
      captureErrorMessage(err, "Could not capture audio from microphone."),
    );
  }
}

async function startBrowserSpeech(captureSpeaker: "interviewer" | "user") {
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
    if (interim) {
      state.livePartial = interim;
      sendTranscript(interim, false, captureSpeaker);
      notify();
    }
    if (finalText.trim()) {
      if (captureSpeaker === "interviewer") {
        state.currentQuestion = finalText.trim();
        state.livePartial = "";
        questionReceivedAt = Date.now();
        setFsm("processing");
        state.thinking = true;
      }
      sendTranscript(finalText.trim(), true, captureSpeaker);
      notify();
    }
  };
  rec.onerror = (event) => {
    if (event.error && event.error !== "no-speech") {
      setRecoverableError(`Speech recognition error: ${event.error}`);
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
  try {
    if (audioInput === "system") {
      if (!systemStream) {
        setFatalError("System audio was not prepared. Click Start coaching again.");
        return;
      }
      attachSystemStream(systemStream);
      notify();
      return;
    }

    if (audioInput === "both") {
      if (systemStream) {
        attachSystemStream(systemStream);
      }
      const browserStarted =
        !("__TAURI_INTERNALS__" in window) && (await startBrowserSpeech("user"));
      state.listeningMode = systemStream && browserStarted ? "both" : browserStarted ? "browser" : "system";
      notify();
      return;
    }

    // Desktop WebKit: browser speech recognition is unreliable — prefer server STT.
    if (mediaRecorder && mediaRecorder.state === "recording") {
      if (stream) startSpeechVad(stream);
      state.listeningMode = "server";
      notify();
      return;
    }

    const browserStarted =
      !("__TAURI_INTERNALS__" in window) && (await startBrowserSpeech("user"));
    if (!browserStarted) {
      const micStream = stream || (await requestMicrophone());
      if (!stream) stream = micStream;
      attachMediaRecorder(micStream);
      state.listeningMode = "server";
    } else {
      state.listeningMode = "browser";
    }
    notify();
  } catch (err) {
    const message = captureErrorMessage(err, "Could not start audio capture.");
    setFatalError(message);
    stopCaptureTracks();
    throw new Error(message);
  }
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
  if (!sessionId || !token) {
    setFatalError("Sign in required before starting coaching.");
    return;
  }

  const wasReconnect = reconnectAttempts > 0;
  state.connectionState = wasReconnect ? "reconnecting" : "connecting";
  clearError();
  if (reconnectAttempts === 0) {
    setFsm("connecting");
  } else {
    notify();
  }

  ws = new WebSocket(buildWsUrl(sessionId, token));

  ws.onopen = async () => {
    state.connectionState = "connected";
    setFsm("active");
    if (wasReconnect) {
      state.metrics.reconnectCount += 1;
    }
    reconnectAttempts = 0;
    startPing();
    try {
      await startCaptureFromPrepared();
    } catch (err) {
      const message = captureErrorMessage(err, "Could not start audio capture.");
      setFatalError(message);
      return;
    }
    if (wasReconnect) {
      await rehydrateSession(sessionId);
    }
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const payload = message.payload || {};

    if (message.type === "pong") return;
    if (message.type === "session.started") {
      setFsm("active");
      state.turnPhase = "listening";
      notify();
    }
    if (message.type === "session.ended") setFsm("ended");

    if (message.type === "turn.your_turn") {
      state.turnPhase = "your_turn";
      if (payload.question) {
        state.currentQuestion = payload.question;
        state.livePartial = "";
      }
      notify();
    }

    if (message.type === "turn.coaching") {
      state.turnPhase = "coaching";
      notify();
    }

    if (message.type === "turn.listening") {
      state.turnPhase = "listening";
      notify();
    }

    if (message.type === "transcript.partial") {
      const partialText = (payload.text || "").trim();
      if (partialText && payload.speaker !== "user" && !isSttRefusal(partialText)) {
        state.livePartial = partialText;
        notify();
      }
    }

    if (message.type === "transcript.final") {
      if (payload.speaker === "user") return;
      if (lastAudioSentAt) {
        state.metrics.lastSttLatencyMs = Date.now() - lastAudioSentAt;
      }
      const line = (payload.text || "").trim();
      if (line && !isSttRefusal(line)) {
        pushTranscriptFeed({
          id: payload.segmentId,
          speaker: payload.speaker || "interviewer",
          text: line,
          timestampMs: payload.timestampMs || Date.now(),
          isFinal: true,
        });
        state.livePartial = "";
        if (payload.shouldCoach) {
          if (state.thinking && state.currentQuestion) {
            state.queuedQuestion = true;
          }
          state.currentQuestion = line;
          questionReceivedAt = Date.now();
          state.thinking = true;
          setFsm("processing");
        }
        notify();
      }
    }

    if (message.type === "suggestion.partial") {
      state.thinking = true;
      queueSuggestionUpdate(payload.content || "", payload.outputId || "", false);
    }

    if (message.type === "suggestion.final") {
      queueSuggestionUpdate(payload.content || "", payload.outputId || "", true);
      state.turnPhase = "listening";
      notify();
    }

    if (message.type === "error") {
      const recoverable = Boolean(payload.recoverable);
      const msg = sanitizeClientError(payload.message || "Realtime error");
      if (recoverable) {
        setRecoverableError(msg);
      } else {
        setFatalError(msg);
      }
    }
  };

  ws.onclose = () => {
    stopPing();
    mediaRecorder?.stop();
    mediaRecorder = null;
    recognition?.stop();
    recognition = null;

    if (active && reconnectAttempts < 5) {
      reconnectAttempts += 1;
      const delay = [1000, 2000, 5000][Math.min(reconnectAttempts - 1, 2)] || 5000;
      state.connectionState = "reconnecting";
      notify();
      setTimeout(() => void connect(), delay);
      return;
    }

    if (active && reconnectAttempts >= 5) {
      setFatalError("Connection lost. Restart coaching from Control Center.");
    }
    stopCaptureTracks();
    if (!active) {
      state.connectionState = "idle";
      notify();
    }
  };

  ws.onerror = () => {
    if (active && reconnectAttempts < 5) return;
    setFatalError("WebSocket connection failed");
  };
}

async function ensureControlListeners() {
  if (!controlUnlisten) {
    controlUnlisten = await listen<CoachControlPayload>(COACH_CONTROL_EVENT, (event) => {
      if (event.payload.action === "stop") {
        void stopCoachSession();
      }
      if (event.payload.action === "retry") {
        reconnectAttempts = 0;
        clearError();
        void connect();
      }
      if (event.payload.action === "hide") {
        void hideOverlayOnly();
      }
    });
  }
  if (!markQuestionUnlisten) {
    markQuestionUnlisten = await listen("coach/mark-question", () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "control", action: "mark_question" }));
      }
    });
  }
}

export function subscribeCoachState(listener: (snapshot: CoachStateSnapshot) => void) {
  listeners.add(listener);
  listener({
    ...state,
    transcriptHistory: [...state.transcriptHistory],
    transcriptFeed: [...state.transcriptFeed],
    metrics: { ...state.metrics },
  });
  return () => {
    listeners.delete(listener);
  };
}

export function getCoachState() {
  return {
    ...state,
    transcriptHistory: [...state.transcriptHistory],
    transcriptFeed: [...state.transcriptFeed],
    metrics: { ...state.metrics },
  };
}

export async function prepareCoachCapture(nextAudioInput: AudioInputMode) {
  audioInput = normalizeAudioInput(nextAudioInput);
  stopCaptureTracks();
  systemStream?.getTracks().forEach((track) => track.stop());
  systemStream = null;
  stream = null;

  if (audioInput === "system" || audioInput === "both") {
    try {
      systemStream = await requestSystemAudioStream();
      if (!systemStream.getAudioTracks().length) {
        systemStream.getTracks().forEach((track) => track.stop());
        systemStream = null;
        throw new Error(
          "Screen share did not include an audio track. Use Microphone mode instead.",
        );
      }
    } catch (err) {
      throw new Error(formatSystemAudioError(err));
    }
  }

  if (audioInput === "mic" || audioInput === "both") {
    const micStream = await requestMicrophone();
    if (audioInput === "mic") {
      attachMediaRecorder(micStream);
    }
  }
}

/** Alias matching useRealtimeSession naming in specs. */
export const prepareCapture = prepareCoachCapture;

export async function applyOverlayDefaults(profile: VisualProfile, opacity = 0.42) {
  state.visualProfile = profile;
  state.opacity = opacity;
  notify();
  try {
    await invoke("set_overlay_visual_profile", { profile });
    await invoke("set_overlay_opacity", { opacity });
    await invoke("set_overlay_clickthrough", { enabled: false });
  } catch {
    // browser dev fallback
  }
}

export async function startCoachSession(options: {
  sessionId: string;
  sessionTitle: string;
  sessionMode?: string;
  sessionCompany?: string;
  sessionStrategy?: "live_answer" | "critique";
  practiceQuestion?: string;
  audioInput: AudioInputMode;
  visualProfile?: VisualProfile;
}) {
  if (active) {
    await stopCoachSession();
  }
  clearError();
  sessionId = options.sessionId;
  sessionTitle = options.sessionTitle;
  sessionMode = options.sessionMode || "";
  sessionCompany = options.sessionCompany || "";
  audioInput = options.audioInput;
  active = true;
  reconnectAttempts = 0;
  questionReceivedAt = null;
  firstPartialAt = null;
  state.sessionId = sessionId;
  state.sessionTitle = sessionTitle;
  state.sessionMode = sessionMode;
  state.sessionCompany = sessionCompany;
  state.sessionStrategy = options.sessionStrategy || "live_answer";
  state.practiceQuestion = options.practiceQuestion || "";
  state.currentQuestion = options.practiceQuestion || "";
  state.livePartial = "";
  state.transcriptFeed = [];
  state.turnPhase = "listening";
  state.suggestion = "";
  state.suggestionFinal = false;
  state.transcriptHistory = [];
  state.error = null;
  state.errorRecoverable = false;
  state.queuedQuestion = false;
  state.thinking = false;
  state.metrics = { ...defaultMetrics(), audioMode: audioInput };

  const profile = options.visualProfile || (options.sessionStrategy === "critique" ? "focused" : "discrete");
  await applyOverlayDefaults(profile, 0.42);

  await ensureControlListeners();
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
  try {
    await invoke("hide_overlay");
    await invoke("show_window");
  } catch {
    // ignore
  }
}

export async function hideOverlayOnly() {
  try {
    await invoke("hide_overlay");
  } catch {
    // ignore
  }
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
  state.practiceQuestion = "";
  state.connectionState = "idle";
  state.listeningMode = "none";
  state.turnPhase = "listening";
  state.currentQuestion = "";
  state.livePartial = "";
  state.transcriptFeed = [];
  state.suggestion = "";
  state.suggestionFinal = false;
  state.suggestionOutputId = "";
  state.queuedQuestion = false;
  state.thinking = false;
  state.transcriptHistory = [];
  state.error = null;
  state.errorRecoverable = false;
  state.metrics = defaultMetrics();
  notify();
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
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export async function retryCoachConnection() {
  reconnectAttempts = 0;
  clearError();
  await connect();
}
