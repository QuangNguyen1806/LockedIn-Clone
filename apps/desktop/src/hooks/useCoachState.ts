import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CoachStateSnapshot, COACH_STATE_EVENT } from "../stores/coachTypes";
import { getCoachState, subscribeCoachState } from "../stores/sessionStore";

export function useCoachState(options?: { tauriEventsOnly?: boolean }) {
  const [state, setState] = useState<CoachStateSnapshot>(getCoachState);

  useEffect(() => {
    if (!options?.tauriEventsOnly) {
      return subscribeCoachState(setState);
    }
    return undefined;
  }, [options?.tauriEventsOnly]);

  useEffect(() => {
    if (!options?.tauriEventsOnly) return undefined;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<CoachStateSnapshot>(COACH_STATE_EVENT, (event) => {
      if (!cancelled) setState(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [options?.tauriEventsOnly]);

  return state;
}
