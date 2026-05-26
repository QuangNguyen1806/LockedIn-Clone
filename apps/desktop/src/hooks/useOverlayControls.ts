import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { setCoachOpacity, setCoachVisualProfile } from "../stores/sessionStore";
import { VisualProfile } from "../stores/coachTypes";

export function useOverlayControls() {
  const [opacity, setOpacityState] = useState(0.45);
  const [clickThrough, setClickThroughState] = useState(false);
  const [visualProfile, setVisualProfileState] = useState<VisualProfile>("discrete");

  const setOpacity = useCallback(async (value: number) => {
    setOpacityState(value);
    setCoachOpacity(value);
    try {
      await invoke("set_overlay_opacity", { opacity: value });
    } catch {
      // browser dev fallback
    }
  }, []);

  const setClickThrough = useCallback(async (enabled: boolean) => {
    try {
      await invoke("set_overlay_clickthrough", { enabled });
    } catch {
      // browser dev fallback
    }
    setClickThroughState(enabled);
  }, []);

  const toggleClickThrough = useCallback(async () => {
    await setClickThrough(!clickThrough);
  }, [clickThrough, setClickThrough]);

  const setVisualProfile = useCallback(async (profile: VisualProfile) => {
    setVisualProfileState(profile);
    setCoachVisualProfile(profile);
    try {
      await invoke("set_overlay_visual_profile", { profile });
    } catch {
      // browser dev fallback
    }
  }, []);

  const toggleVisualProfile = useCallback(async () => {
    await setVisualProfile(visualProfile === "discrete" ? "focused" : "discrete");
  }, [setVisualProfile, visualProfile]);

  useEffect(() => {
    let cancelled = false;
    void invoke<{ opacity: number; visual_profile: string; click_through?: boolean }>("get_overlay_settings")
      .then((settings) => {
        if (cancelled) return;
        setOpacityState(settings.opacity);
        setVisualProfileState(settings.visual_profile === "focused" ? "focused" : "discrete");
        if (typeof settings.click_through === "boolean") {
          setClickThroughState(settings.click_through);
        }
      })
      .catch(() => undefined);

    const unlisteners = [
      listen<number>("overlay-opacity-changed", (event) => {
        if (!cancelled) {
          setOpacityState(event.payload);
          setCoachOpacity(event.payload);
        }
      }),
      listen<string>("overlay-profile-changed", (event) => {
        if (!cancelled) {
          const profile = event.payload === "focused" ? "focused" : "discrete";
          setVisualProfileState(profile);
          setCoachVisualProfile(profile);
        }
      }),
      listen<boolean>("click-through-changed", (event) => {
        if (!cancelled) setClickThroughState(Boolean(event.payload));
      }),
    ];

    return () => {
      cancelled = true;
      void Promise.all(unlisteners).then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || !event.shiftKey) return;
      if (event.code === "KeyL") {
        event.preventDefault();
        void toggleClickThrough();
      }
      if (event.code === "KeyI") {
        event.preventDefault();
        void setClickThrough(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setClickThrough, toggleClickThrough]);

  return {
    opacity,
    setOpacity,
    clickThrough,
    setClickThrough,
    toggleClickThrough,
    visualProfile,
    setVisualProfile,
    toggleVisualProfile,
  };
}
