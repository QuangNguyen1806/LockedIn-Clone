import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

export function useWindowControls() {
  const [opacity, setOpacityState] = useState(0.88);
  const [clickThrough, setClickThroughState] = useState(false);

  const setClickThrough = useCallback(async (enabled: boolean) => {
    try {
      await invoke("set_click_through", { enabled });
    } catch {
      // Browser-only dev mode has no Tauri backend.
    }
    setClickThroughState(enabled);
  }, []);

  const toggleClickThrough = useCallback(async () => {
    await setClickThrough(!clickThrough);
  }, [clickThrough, setClickThrough]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      listen<boolean>("click-through-changed", (event) => {
        if (!cancelled) {
          setClickThroughState(Boolean(event.payload));
        }
      }),
    );

    Promise.all(unlisteners).then((fns) => {
      return () => {
        cancelled = true;
        fns.forEach((unlisten) => unlisten());
      };
    });

    return () => {
      cancelled = true;
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
    setOpacity: setOpacityState,
    clickThrough,
    setClickThrough,
    toggleClickThrough,
  };
}
