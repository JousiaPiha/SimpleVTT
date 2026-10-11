import { useEffect, useRef, useState, type PointerEvent } from "react";
import type {
  Drawing,
  DrawingInput,
  DrawingTool,
} from "../../../shared/drawing.js";

function Mark({
  drawing,
  erasing = false,
}: {
  drawing: DrawingInput & { id?: string };
  erasing?: boolean;
}) {
  const p = drawing.points;
  const shared = {
    stroke: drawing.color,
    strokeWidth: drawing.width,
    fill: "none",
    "data-drawing-id": drawing.id,
    pointerEvents: erasing ? ("stroke" as const) : ("none" as const),
  };
  const x = Math.min(p[0], p[2]),
    y = Math.min(p[1], p[3]);
  const width = Math.abs(p[2] - p[0]),
    height = Math.abs(p[3] - p[1]);
  if (drawing.type === "rectangle")
    return <rect {...shared} x={x} y={y} width={width} height={height} />;
  if (drawing.type === "oval")
    return (
      <ellipse
        {...shared}
        cx={x + width / 2}
        cy={y + height / 2}
        rx={width / 2}
        ry={height / 2}
      />
    );
  return (
    <polyline
      {...shared}
      strokeLinecap="round"
      strokeLinejoin="round"
      points={p
        .reduce<string[]>((pairs, n, i) => {
          if (i % 2 === 0) pairs.push(`${n},${p[i + 1]}`);
          return pairs;
        }, [])
        .join(" ")}
    />
  );
}

export function DrawingOverlay({
  drawings,
  tool,
  color,
  width,
  onAdd,
  onErase,
}: {
  drawings: Drawing[];
  tool: DrawingTool | null;
  color: string;
  width: number;
  onAdd?: (drawing: DrawingInput) => Promise<boolean>;
  onErase?: (id: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<DrawingInput | null>(null);
  const draftRef = useRef<DrawingInput | null>(null);
  const held = useRef<number | null>(null);
  const erasing = useRef(new Set<string>());
  const [saving, setSaving] = useState(false);
  const cancel = () => {
    held.current = null;
    draftRef.current = null;
    setDraft(null);
  };
  useEffect(() => {
    cancel();
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, [tool]);
  const coordinates = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      Math.round(
        Math.max(
          0,
          Math.min(1920, ((event.clientX - rect.left) * 1920) / rect.width),
        ),
      ),
      Math.round(
        Math.max(
          0,
          Math.min(1080, ((event.clientY - rect.top) * 1080) / rect.height),
        ),
      ),
    ];
  };
  const erase = (event: PointerEvent<SVGSVGElement>) => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const id = target
      ?.closest("[data-drawing-id]")
      ?.getAttribute("data-drawing-id");
    if (!id || !drawings.some((d) => d.id === id) || erasing.current.has(id))
      return;
    erasing.current.add(id);
    void onErase?.(id).finally(() => erasing.current.delete(id));
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (held.current !== event.pointerId) return;
    if (tool === "eraser") {
      erase(event);
      return;
    }
    const old = draftRef.current;
    if (!old) return;
    const next = coordinates(event);
    const p = old.points;
    if (
      old.type === "freehand" &&
      Math.hypot(next[0] - p[p.length - 2], next[1] - p[p.length - 1]) < 2
    )
      return;
    const points =
      old.type !== "freehand"
        ? [...p.slice(0, 2), ...next]
        : p.length < 4096
          ? [...p, ...next]
          : [...p.slice(0, -2), ...next];
    draftRef.current = { ...old, points };
    setDraft(draftRef.current);
  };
  return (
    <svg
      className="drawing-overlay"
      viewBox="0 0 1920 1080"
      aria-label={tool ? "Drawing area" : undefined}
      style={{
        pointerEvents: tool ? "auto" : "none",
        cursor: tool === "eraser" ? "cell" : "crosshair",
      }}
      onPointerDown={(event) => {
        if (!tool || saving || event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        held.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (tool === "eraser") {
          erase(event);
          return;
        }
        const p = coordinates(event);
        draftRef.current = { type: tool, color, width, points: [...p, ...p] };
        setDraft(draftRef.current);
      }}
      onPointerMove={move}
      onPointerUp={async (event) => {
        if (held.current !== event.pointerId) return;
        move(event);
        held.current = null;
        const drawing = draftRef.current;
        if (!drawing) return;
        if (
          drawing.type !== "freehand" &&
          (Math.abs(drawing.points[0] - drawing.points[2]) < 2 ||
            Math.abs(drawing.points[1] - drawing.points[3]) < 2)
        ) {
          cancel();
          return;
        }
        setSaving(true);
        try {
          await onAdd?.(drawing);
        } finally {
          setSaving(false);
          cancel();
        }
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (held.current !== null) cancel();
      }}
    >
      {drawings.map((drawing) => (
        <Mark key={drawing.id} drawing={drawing} erasing={tool === "eraser"} />
      ))}
      {draft && <Mark drawing={draft} />}
    </svg>
  );
}
