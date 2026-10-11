import { useCallback, useEffect, useRef, useState } from "react";
import { LASER_INTERVAL_MS, type LaserPointer } from "../../../shared/laser.js";

export function useLaserPointer(sceneId: string | null) {
  const [pointer, setPointer] = useState<LaserPointer | null>(null);
  const [connected, setConnected] = useState(false);
  const latest = useRef<LaserPointer | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const lastSent = useRef(0);
  const send = useCallback((point: LaserPointer | null) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 4096)
      return;
    const now = performance.now();
    if (point && now - lastSent.current < LASER_INTERVAL_MS) return;
    lastSent.current = point ? now : 0;
    socket.send(JSON.stringify({ type: "laser.update", pointer: point }));
  }, []);
  const update = useCallback(
    (point: LaserPointer | null) => {
      if (point && socketRef.current?.readyState !== WebSocket.OPEN) return;
      latest.current = point;
      setPointer(point);
      send(point);
    },
    [send],
  );
  useEffect(() => {
    setPointer(null);
    latest.current = null;
    setConnected(false);
    if (!sceneId) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/admin/laser`,
      );
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        latest.current = null;
        setPointer(null);
        if (!stopped) retry = setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
    };
    connect();
    // Keep a stationary held pointer alive; the server expires lost controllers.
    const keepAlive = setInterval(() => {
      if (latest.current) send(latest.current);
    }, 200);
    const hide = () => update(null);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(keepAlive);
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", hide);
      send(null);
      socket.onopen = null;
      socket.onclose = null;
      socket.close();
      socketRef.current = null;
      latest.current = null;
    };
  }, [sceneId, send, update]);
  return {
    pointer: pointer?.sceneId === sceneId ? pointer : null,
    connected,
    update,
  };
}
