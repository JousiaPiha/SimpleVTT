import { useRef, type PointerEvent } from "react";
import { CANVAS } from "../../../shared/contracts.js";
import type { LaserPointer } from "../../../shared/laser.js";

export function LaserSurface({
  sceneId,
  onPoint,
}: {
  sceneId: string;
  onPoint: (pointer: LaserPointer | null) => void;
}) {
  const held = useRef<number | null>(null);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * CANVAS.width) / rect.width;
    const y = ((event.clientY - rect.top) * CANVAS.height) / rect.height;
    if (x < 0 || x > CANVAS.width || y < 0 || y > CANVAS.height) {
      stop();
      return;
    }
    onPoint({ sceneId, x, y });
  };
  const stop = () => {
    held.current = null;
    onPoint(null);
  };
  return (
    <div
      className="laser-surface"
      aria-label="Laser pointer area"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        held.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        point(event);
      }}
      onPointerMove={(event) => {
        if (held.current !== event.pointerId) return;
        if (event.buttons === 0) {
          stop();
          return;
        }
        point(event);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onPointerLeave={stop}
      onContextMenu={(event) => {
        event.preventDefault();
        stop();
      }}
    />
  );
}
