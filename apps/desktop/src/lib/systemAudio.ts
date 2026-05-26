type DisplayMediaWithSystemAudio = DisplayMediaStreamOptions & {
  systemAudio?: "include" | "exclude";
  monitorTypeSurfaces?: "include" | "exclude";
  selfBrowserSurface?: "exclude";
  surfaceSwitching?: "include";
};

function waitForAudioTrack(stream: MediaStream, timeoutMs = 4000): Promise<boolean> {
  if (stream.getAudioTracks().length > 0) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      stream.removeEventListener("addtrack", onAddTrack);
      resolve(stream.getAudioTracks().length > 0);
    }, timeoutMs);

    function onAddTrack(event: MediaStreamTrackEvent) {
      if (event.track.kind === "audio") {
        window.clearTimeout(timer);
        stream.removeEventListener("addtrack", onAddTrack);
        resolve(true);
      }
    }

    stream.addEventListener("addtrack", onAddTrack);
  });
}

function muteVideoTracks(stream: MediaStream) {
  stream.getVideoTracks().forEach((track) => {
    track.enabled = false;
  });
}

async function requestDisplayMedia(options: DisplayMediaWithSystemAudio): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia(options);
}

async function tryCaptureSystemAudio(): Promise<MediaStream | null> {
  const attempts: DisplayMediaWithSystemAudio[] = [
    {
      video: {
        width: { ideal: 320 },
        height: { ideal: 240 },
        frameRate: { ideal: 1, max: 5 },
      },
      audio: true,
      systemAudio: "include",
      monitorTypeSurfaces: "include",
      selfBrowserSurface: "exclude",
    },
    {
      video: true,
      audio: true,
    },
    {
      video: {
        width: { ideal: 320 },
        height: { ideal: 240 },
        frameRate: { ideal: 1, max: 5 },
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    },
  ];

  for (const options of attempts) {
    try {
      const stream = await requestDisplayMedia(options);
      const hasAudio = await waitForAudioTrack(stream);
      if (hasAudio) {
        muteVideoTracks(stream);
        return stream;
      }
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      // try next capture shape
    }
  }

  return null;
}

export async function requestSystemAudioStream(): Promise<MediaStream> {
  if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
    throw new Error("System audio capture is not supported in this environment.");
  }

  const stream = await tryCaptureSystemAudio();
  if (stream) {
    return stream;
  }

  throw new Error(
    "macOS did not provide a system-audio track for this screen share. This is a known WebKit limitation in desktop apps. Use “Microphone only” in Live Coach (or point your mic at the call), and confirm LockedIn Copilot is allowed under System Settings → Privacy & Security → Screen & System Audio Recording.",
  );
}

export function formatSystemAudioError(err: unknown): string {
  const message = err instanceof Error ? err.message : "System audio capture failed";
  if (message.toLowerCase().includes("user gesture")) {
    return "Screen share must be started by clicking Start coaching. Try again with that button.";
  }
  if (message.toLowerCase().includes("not allowed") || message.toLowerCase().includes("permission")) {
    return 'Screen recording access denied. Open System Settings → Privacy & Security → Screen & System Audio Recording, allow LockedIn Copilot, then restart the app.';
  }
  return message;
}

export function isMacOsTauri(): boolean {
  return navigator.userAgent.includes("Macintosh") && "__TAURI_INTERNALS__" in window;
}

export function isTauriDesktop(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function isSystemAudioSupported(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export function defaultAudioInputMode(): "mic" | "system" {
  if (isMacOsTauri()) return "mic";
  return isSystemAudioSupported() ? "system" : "mic";
}
