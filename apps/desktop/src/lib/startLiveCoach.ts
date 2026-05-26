import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import { getDefaultOverlayProfile } from "./overlayPreferences";
import { defaultAudioInputMode } from "./systemAudio";
import { AudioInputMode, VisualProfile } from "../stores/coachTypes";
import {
  prepareCoachCapture,
  startCoachSession,
  stopCoachSession,
} from "../stores/sessionStore";

export type StartLiveCoachConfig = {
  mode?: string;
  company?: string;
  role?: string;
  tone?: string;
  customInstructions?: string;
};

export type StartLiveCoachOptions = {
  sessionId?: string;
  title?: string;
  config?: StartLiveCoachConfig;
  strategy?: "live_answer" | "critique";
  practiceQuestion?: string;
  audioInput?: AudioInputMode;
  visualProfile?: VisualProfile;
  navigate?: (path: string) => void;
};

export async function startLiveCoach(options: StartLiveCoachOptions): Promise<string> {
  let sessionId = options.sessionId || "";
  let sessionTitle = options.title || "Live coaching";
  let sessionMode = options.config?.mode || "";
  let sessionCompany = options.config?.company || "";

  if (!sessionId) {
    const session = (await api.createSession({
      title: sessionTitle,
      config: {
        mode: options.config?.mode || "behavioral",
        company: options.config?.company || "",
        role: options.config?.role || "",
        tone: options.config?.tone || "conversational",
        customInstructions: options.config?.customInstructions || "",
      },
      strategy: options.strategy || "live_answer",
    })) as { id: string; title?: string; config?: { mode?: string; company?: string } };
    sessionId = session.id;
    sessionTitle = session.title || sessionTitle;
    sessionMode = session.config?.mode || sessionMode;
    sessionCompany = session.config?.company || sessionCompany;
  }

  const audioInput = options.audioInput ?? defaultAudioInputMode();
  const visualProfile =
    options.visualProfile ??
    (options.strategy === "critique" ? "focused" : getDefaultOverlayProfile());

  try {
    await prepareCoachCapture(audioInput);
    await invoke("set_overlay_clickthrough", { enabled: false });
    await invoke("show_overlay");
    await startCoachSession({
      sessionId,
      sessionTitle,
      sessionMode,
      sessionCompany,
      sessionStrategy: options.strategy || "live_answer",
      practiceQuestion: options.practiceQuestion,
      audioInput,
      visualProfile,
    });
  } catch (err) {
    await stopCoachSession().catch(() => undefined);
    try {
      await invoke("hide_overlay");
    } catch {
      // ignore
    }
    throw err;
  }

  if (options.navigate) {
    options.navigate(`/coach?session=${sessionId}`);
  }

  return sessionId;
}
