export async function requestSystemAudioStream(): Promise<MediaStream> {
  if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
    throw new Error("System audio capture is not supported in this environment.");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
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
  });

  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      'No call audio detected. Choose your entire screen in the picker and enable "Share system audio".',
    );
  }

  stream.getVideoTracks().forEach((track) => {
    track.enabled = false;
  });

  return stream;
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
