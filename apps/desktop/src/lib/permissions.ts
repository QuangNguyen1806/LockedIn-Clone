export type PermissionState = "unknown" | "granted" | "denied" | "unsupported";

export async function requestMicrophonePermission(): Promise<PermissionState> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "unsupported";
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch {
    return "denied";
  }
}
