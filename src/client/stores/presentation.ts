import { create } from "zustand";
import { applyPresentation, type PublicScene } from "../../shared/contracts.js";

import {
  playerEventSchema,
  LASER_TIMEOUT_MS,
  type LaserPointer,
} from "../../shared/laser.js";

export const usePresentation = create<{
  scene: PublicScene | null;
  connected: boolean;
  pointer: LaserPointer | null;
}>(() => ({ scene: null, connected: false, pointer: null }));
export function connectPresentation() {
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointerTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false,
    delay = 500;
  const connect = () => {
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/player`,
    );
    socket.onopen = () => {
      delay = 500;
      usePresentation.setState({ connected: true });
    };
    socket.onmessage = (event) => {
      try {
        const message = playerEventSchema.parse(JSON.parse(String(event.data)));
        if (message.type === "laser.updated") {
          clearTimeout(pointerTimer);
          usePresentation.setState((state) => ({
            pointer:
              message.pointer?.sceneId === state.scene?.id
                ? message.pointer
                : null,
          }));
          if (message.pointer)
            pointerTimer = setTimeout(
              () => usePresentation.setState({ pointer: null }),
              LASER_TIMEOUT_MS,
            );
        } else {
          usePresentation.setState((state) => ({
            scene: applyPresentation(state.scene, message),
            ...(message.type === "presentation.snapshot"
              ? { pointer: null }
              : {}),
          }));
        }
      } catch {
        socket?.close();
      }
    };
    socket.onclose = () => {
      clearTimeout(pointerTimer);
      usePresentation.setState({ connected: false, pointer: null });
      if (!stopped) {
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10000);
      }
    };
    socket.onerror = () => socket?.close();
  };
  const retry = () => {
    if (!stopped && socket?.readyState === WebSocket.CLOSED) {
      clearTimeout(timer);
      connect();
    }
  };
  window.addEventListener("online", retry);
  connect();
  return () => {
    stopped = true;
    clearTimeout(pointerTimer);
    usePresentation.setState({ pointer: null });
    clearTimeout(timer);
    window.removeEventListener("online", retry);
    socket?.close();
  };
}
