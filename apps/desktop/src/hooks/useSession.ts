import { useCallback, useEffect, useRef, useState } from "react";
import { buildWsUrl } from "../lib/api";
import { formatSystemAudioError, requestSystemAudioStream } from "../lib/systemAudio";

export type AudioInputMode = "mic" | "system" | "both";
export type ListeningMode = "browser" | "server" | "system" | "both" | "none";

type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "error";

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

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSystemAudioSupported(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

function attachMediaRecorder(stream: MediaStream, sendAudioChunk: (blob: Blob) => Promise<void>) {
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      void sendAudioChunk(event.data);
    }
  };
  recorder.start(2000);
  return recorder;
}

export function useRealtimeSession(
  sessionId: string,
  token: string,
  active: boolean,
  audioInput: AudioInputMode = "system",
) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [transcript, setTranscript] = useState("");
  const [livePartial, setLivePartial] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listeningMode, setListeningMode] = useState<ListeningMode>("none");
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const reconnectAttempts = useRef(0);
  const transcriptLinesRef = useRef<string[]>([]);

  const sendTranscript = useCallback((text: string, isFinal: boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return;
    ws.send(
      JSON.stringify({
        type: "transcript",
        text: text.trim(),
        isFinal,
        speaker: "interviewer",
      }),
    );
  }, []);

  const stopCapture = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    systemStreamRef.current?.getTracks().forEach((track) => track.stop());
    systemStreamRef.current = null;
    setListeningMode("none");
  }, []);

  const sendAudioChunk = useCallback(async (blob: Blob) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    const data = btoa(binary);
    ws.send(
      JSON.stringify({
        type: "audio",
        data,
        encoding: "webm",
        sampleRate: 16000,
      }),
    );
  }, []);

  const requestMicrophone = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!streamRef.current) {
      streamRef.current = stream;
    }
    return stream;
  }, []);

  const startBrowserSpeech = useCallback(async () => {
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) return false;

    try {
      await requestMicrophone();
    } catch {
      setError(
        "Microphone access denied. Open System Settings → Privacy & Security → Microphone and allow LockedIn Copilot, then restart the app.",
      );
      return false;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript || "";
        if (result.isFinal) finalText += text;
        else interim += text;
      }
      if (interim) {
        setLivePartial(interim);
        sendTranscript(interim, false);
      }
      if (finalText.trim()) {
        const line = finalText.trim();
        transcriptLinesRef.current = [...transcriptLinesRef.current.slice(-7), line];
        setTranscript(transcriptLinesRef.current.join("\n"));
        setLivePartial("");
        sendTranscript(line, true);
      }
    };
    recognition.onerror = (event) => {
      if (event.error && event.error !== "no-speech") {
        if (event.error === "not-allowed") {
          setError(
            "Microphone access denied. Open System Settings → Privacy & Security → Microphone and allow LockedIn Copilot, then restart the app.",
          );
          return;
        }
        setError(`Speech recognition error: ${event.error}`);
      }
    };
    recognition.onend = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN && active) {
        try {
          recognition.start();
        } catch {
          // ignore restart race
        }
      }
    };
    recognition.start();
    recognitionRef.current = recognition;
    return true;
  }, [active, requestMicrophone, sendTranscript]);

  const startServerMicAudio = useCallback(async () => {
    const stream = streamRef.current || (await requestMicrophone());
    if (!streamRef.current) streamRef.current = stream;
    mediaRecorderRef.current = attachMediaRecorder(stream, sendAudioChunk);
    setListeningMode("server");
  }, [requestMicrophone, sendAudioChunk]);

  const attachSystemStream = useCallback(
    (stream: MediaStream) => {
      streamRef.current = stream;
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
        mediaRecorderRef.current = attachMediaRecorder(stream, sendAudioChunk);
      }
      setListeningMode("system");
    },
    [sendAudioChunk],
  );

  const prepareCapture = useCallback(async () => {
    setError(null);
    systemStreamRef.current?.getTracks().forEach((track) => track.stop());
    systemStreamRef.current = null;

    if (audioInput === "system" || audioInput === "both") {
      try {
        systemStreamRef.current = await requestSystemAudioStream();
      } catch (err) {
        throw new Error(formatSystemAudioError(err));
      }
    }

    if (audioInput === "mic" || audioInput === "both") {
      try {
        await requestMicrophone();
      } catch {
        throw new Error(
          "Microphone access denied. Open System Settings → Privacy & Security → Microphone and allow LockedIn Copilot, then restart the app.",
        );
      }
    }
  }, [audioInput, requestMicrophone]);

  const startCapture = useCallback(async () => {
    transcriptLinesRef.current = [];
    setTranscript("");
    setLivePartial("");
    setSuggestion("");

    if (audioInput === "system") {
      const stream = systemStreamRef.current;
      if (!stream) {
        setError("System audio was not prepared. Click Start coaching again.");
        return;
      }
      attachSystemStream(stream);
      return;
    }

    if (audioInput === "both") {
      let systemStarted = false;
      const stream = systemStreamRef.current;
      if (stream) {
        attachSystemStream(stream);
        systemStarted = true;
      } else {
        setError("System audio was not prepared. Click Start coaching again.");
      }

      const browserStarted = await startBrowserSpeech();
      if (systemStarted && browserStarted) {
        setListeningMode("both");
      } else if (browserStarted) {
        setListeningMode("browser");
      }
      return;
    }

    const browserStarted = await startBrowserSpeech();
    if (!browserStarted) {
      try {
        await startServerMicAudio();
      } catch {
        setError(
          "Microphone access denied. Open System Settings → Privacy & Security → Microphone and allow LockedIn Copilot, then restart the app.",
        );
      }
    }
  }, [attachSystemStream, audioInput, startBrowserSpeech, startServerMicAudio]);

  const connect = useCallback(async () => {
    if (!sessionId || !token) return;
    setConnectionState(reconnectAttempts.current > 0 ? "reconnecting" : "connecting");

    const ws = new WebSocket(buildWsUrl(sessionId, token));
    wsRef.current = ws;

    ws.onopen = async () => {
      setConnectionState("connected");
      reconnectAttempts.current = 0;
      await startCapture();
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const payload = message.payload || {};
      if (message.type === "transcript.partial") {
        setLivePartial(payload.text || "");
      }
      if (message.type === "transcript.final") {
        const line = payload.text || "";
        if (line) {
          transcriptLinesRef.current = [...transcriptLinesRef.current.slice(-7), line];
          setTranscript(transcriptLinesRef.current.join("\n"));
          setLivePartial("");
        }
      }
      if (message.type === "suggestion.partial" || message.type === "suggestion.final") {
        setSuggestion(payload.content || "");
      }
      if (message.type === "error") {
        setError(payload.message || "Realtime error");
        setConnectionState("error");
      }
    };

    ws.onclose = () => {
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
      recognitionRef.current?.stop();
      recognitionRef.current = null;

      if (active && reconnectAttempts.current < 3) {
        reconnectAttempts.current += 1;
        setTimeout(() => void connect(), 1500 * reconnectAttempts.current);
      } else {
        stopCapture();
        setConnectionState("idle");
      }
    };

    ws.onerror = () => {
      setError("WebSocket connection failed");
      setConnectionState("error");
    };
  }, [active, sessionId, startCapture, stopCapture, token]);

  const disconnect = useCallback(() => {
    reconnectAttempts.current = 99;
    stopCapture();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "control", action: "stop" }));
      ws.close();
    }
    wsRef.current = null;
    setConnectionState("idle");
  }, [stopCapture]);

  useEffect(() => {
    if (active) {
      void connect();
    } else {
      disconnect();
    }
    return () => disconnect();
  }, [active, connect, disconnect]);

  const displayTranscript = livePartial
    ? `${transcript}${transcript ? "\n" : ""}${livePartial}`
    : transcript;

  return {
    connectionState,
    transcript: displayTranscript,
    suggestion,
    error,
    listeningMode,
    prepareCapture,
    disconnect,
  };
}
