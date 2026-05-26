import { VisualProfile } from "../stores/coachTypes";

const STORAGE_KEY = "lockedin_default_overlay_profile";

export function getDefaultOverlayProfile(): VisualProfile {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "focused" ? "focused" : "discrete";
}

export function setDefaultOverlayProfile(profile: VisualProfile) {
  localStorage.setItem(STORAGE_KEY, profile);
}
