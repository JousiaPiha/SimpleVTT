import { useCallback, useEffect, useRef, useState } from "react";
import {
  sessionStatusSchema,
  type SessionStatus,
} from "../../../shared/sessions.js";
import { api } from "../../api.js";

export function useSessionStatus(authenticated: boolean | null) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = status?.busy ?? false;
  const serial = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++serial.current;
    try {
      const next = await api("/api/admin/session", {}, sessionStatusSchema);
      if (request === serial.current) {
        setStatus(next);
        setError(null);
      }
      return next;
    } catch (e) {
      if (request === serial.current)
        setError(e instanceof Error ? e.message : "Cannot check the session.");
      return null;
    }
  }, []);
  useEffect(() => {
    if (!authenticated) {
      serial.current++;
      setStatus(null);
      setError(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const next = await refresh();
      if (!stopped) timer = setTimeout(poll, next?.busy ? 1000 : 3000);
    };
    void poll();
    return () => {
      stopped = true;
      serial.current++;
      clearTimeout(timer);
    };
  }, [authenticated, refresh, busy]);
  const accept = useCallback((next: SessionStatus) => {
    serial.current++;
    setStatus(next);
    setError(null);
  }, []);
  return { status, error, refresh, accept };
}
