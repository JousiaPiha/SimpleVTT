import { DrawingOverlay } from "../features/drawing/DrawingOverlay.js";
import type { DrawingTool, DrawingInput } from "../../shared/drawing.js";
import { useEffect, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Rect,
  Transformer,
  Group,
  Text as CanvasText,
} from "react-konva";
import type Konva from "konva";
import {
  CANVAS,
  type ObjectPatch,
  type PublicScene,
  type Scene,
  type PublicObject,
  type SceneObject,
} from "../../shared/contracts.js";
import { mediaUrl } from "../api.js";
import type { ContentPatch } from "../../shared/content.js";
import type { LaserPointer } from "../../shared/laser.js";
import { LaserSurface } from "../features/laser/LaserSurface.js";
import { CanvasGrid } from "./CanvasGrid.js";
import { CanvasContent } from "./CanvasContent.js";

function useImage(id: string | null) {
  const [result, setResult] = useState<{
    id: string;
    image?: HTMLImageElement;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!id) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setResult({ id, image });
    };
    image.onerror = () => {
      if (active) setResult({ id, failed: true });
    };
    image.src = mediaUrl(id);
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [id]);
  return result?.id === id ? result : undefined;
}
interface CanvasProps {
  scene: Scene | PublicScene | null;
  editing?: boolean;
  drawingTool?: DrawingTool | null;
  drawingColor?: string;
  drawingWidth?: number;
  onDraw?: (drawing: DrawingInput) => Promise<boolean>;
  onErase?: (id: string) => Promise<boolean>;
  laserMode?: boolean;
  pointer?: LaserPointer | null;
  onPoint?: (pointer: LaserPointer | null) => void;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onPatch?: (id: string, patch: ObjectPatch) => void;
  selectedContentId?: string | null;
  onSelectContent?: (id: string | null) => void;
  onPatchContent?: (id: string, patch: ContentPatch) => void;
}
function CanvasObject({
  object,
  editing,
  selected,
  onSelect,
  onPatch,
}: {
  object: SceneObject | PublicObject;
  editing: boolean;
  selected: boolean;
  onSelect?: () => void;
  onPatch?: (patch: ObjectPatch) => void;
}) {
  const loaded = useImage(object.assetId);
  const group = useRef<Konva.Group>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const lastMove = useRef(0);
  useEffect(() => {
    if (selected && group.current) {
      transformer.current?.nodes([group.current]);
      transformer.current?.getLayer()?.batchDraw();
    }
  }, [selected, loaded]);
  const sendPosition = (final: boolean) => {
    const node = group.current;
    if (!node) return;
    const now = performance.now();
    if (!final && now - lastMove.current < 50) return;
    lastMove.current = now;
    onPatch?.({ x: node.x(), y: node.y() });
  };
  return (
    <>
      <Group
        ref={group}
        x={object.x}
        y={object.y}
        width={object.width}
        height={object.height}
        scaleX={object.scale}
        scaleY={object.scale}
        rotation={object.rotation}
        opacity={editing && "visible" in object && !object.visible ? 0.5 : 1}
        draggable={editing}
        listening={editing}
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={onSelect}
        onDragMove={() => sendPosition(false)}
        onDragEnd={() => sendPosition(true)}
        onTransformEnd={() => {
          const node = group.current;
          if (!node) return;
          const scale = Math.max(0.01, Math.min(20, node.scaleX()));
          node.scale({ x: scale, y: scale });
          onPatch?.({
            x: node.x(),
            y: node.y(),
            scale,
            rotation: node.rotation(),
          });
        }}
      >
        {loaded?.image ? (
          <KonvaImage
            image={loaded.image}
            width={object.width}
            height={object.height}
          />
        ) : editing ? (
          <>
            <Rect
              width={object.width}
              height={object.height}
              fill="#252b34"
              stroke="#687282"
              dash={[8, 6]}
            />
            <CanvasText
              text={loaded?.failed ? "Image unavailable" : "Loading image…"}
              width={object.width}
              fontSize={20}
              fill="#c2c8d1"
              padding={12}
            />
          </>
        ) : null}
      </Group>
      {editing && selected ? (
        <Transformer
          ref={transformer}
          keepRatio
          flipEnabled={false}
          enabledAnchors={[
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
          ]}
          rotateEnabled
          borderStroke="#65b9c3"
          anchorStroke="#65b9c3"
          anchorFill="#182329"
          anchorSize={9}
          boundBoxFunc={(old, next) =>
            Math.abs(next.width) < 8 || Math.abs(next.height) < 8 ? old : next
          }
        />
      ) : null}
    </>
  );
}
export function SceneCanvas({
  scene,
  editing = false,
  laserMode = false,
  drawingTool = null,
  drawingColor = "#ffcc00",
  drawingWidth = 5,
  onDraw,
  onErase,
  pointer,
  onPoint,
  selectedId,
  onSelect,
  onPatch,
  selectedContentId,
  onSelectContent,
  onPatchContent,
}: CanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const background = useImage(scene?.backgroundAssetId ?? null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = Math.max(
    0.001,
    Math.min(size.width / CANVAS.width, size.height / CANVAS.height),
  );
  const image = background?.image;
  const ratio = image
    ? Math.max(
        CANVAS.width / image.naturalWidth,
        CANVAS.height / image.naturalHeight,
      )
    : 1;
  const entries = [
    ...(scene?.objects ?? []).map((item) => ({ kind: "image" as const, item })),
    ...(scene?.content ?? []).map((item) => ({
      kind: "content" as const,
      item,
    })),
  ]
    .filter(({ item }) => editing || !("visible" in item) || item.visible)
    .sort(
      (a, b) =>
        a.item.zIndex - b.item.zIndex || a.item.id.localeCompare(b.item.id),
    );
  const clearSelection = (event: Konva.KonvaEventObject<Event>) => {
    if (
      event.target === event.target.getStage() ||
      event.target.name() === "background"
    ) {
      onSelect?.(null);
      onSelectContent?.(null);
    }
  };
  return (
    <div
      className={`canvas-host ${editing ? "canvas-editor" : ""}`}
      ref={host}
      aria-label={editing ? "Scene editor canvas" : "Player presentation"}
    >
      <div
        style={{
          position: "relative",
          width: CANVAS.width * scale,
          height: CANVAS.height * scale,
          flexShrink: 0,
        }}
      >
        <Stage
          width={CANVAS.width * scale}
          height={CANVAS.height * scale}
          scaleX={scale}
          scaleY={scale}
          onMouseDown={clearSelection}
          onTouchStart={clearSelection}
        >
          <Layer>
            <Rect
              name="background"
              width={CANVAS.width}
              height={CANVAS.height}
              fill="#0e1116"
            />
            {image ? (
              <KonvaImage
                name="background"
                image={image}
                x={(CANVAS.width - image.naturalWidth * ratio) / 2}
                y={(CANVAS.height - image.naturalHeight * ratio) / 2}
                width={image.naturalWidth * ratio}
                height={image.naturalHeight * ratio}
              />
            ) : null}
            {scene?.gridEnabled && (
              <CanvasGrid
                size={scene.gridSize}
                color={scene.gridColor}
                scale={scale}
              />
            )}
            {entries.map((entry) =>
              entry.kind === "image" ? (
                <CanvasObject
                  key={`${scene?.id}:image:${entry.item.id}`}
                  object={entry.item}
                  editing={editing}
                  selected={
                    !laserMode && !drawingTool && selectedId === entry.item.id
                  }
                  onSelect={() => {
                    onSelectContent?.(null);
                    onSelect?.(entry.item.id);
                  }}
                  onPatch={(patch) => onPatch?.(entry.item.id, patch)}
                />
              ) : (
                <CanvasContent
                  key={`${scene?.id}:content:${entry.item.id}`}
                  content={entry.item}
                  editing={editing}
                  selected={
                    !laserMode &&
                    !drawingTool &&
                    selectedContentId === entry.item.id
                  }
                  onSelect={() => {
                    onSelect?.(null);
                    onSelectContent?.(entry.item.id);
                  }}
                  onPatch={(patch) => onPatchContent?.(entry.item.id, patch)}
                />
              ),
            )}
          </Layer>
        </Stage>
        {scene && (
          <DrawingOverlay
            key={scene.id}
            drawings={scene.drawings ?? []}
            tool={editing ? drawingTool : null}
            color={drawingColor}
            width={drawingWidth}
            onAdd={onDraw}
            onErase={onErase}
          />
        )}
        {laserMode && scene && onPoint && (
          <LaserSurface sceneId={scene.id} onPoint={onPoint} />
        )}
        {pointer && pointer.sceneId === scene?.id && (
          <div
            className="laser-dot"
            data-testid="laser-dot"
            aria-hidden="true"
            style={{
              left: `${(pointer.x / CANVAS.width) * 100}%`,
              top: `${(pointer.y / CANVAS.height) * 100}%`,
            }}
          />
        )}
      </div>
      {editing &&
      scene &&
      !laserMode &&
      !drawingTool &&
      !scene.drawings?.length &&
      !scene.gridEnabled &&
      !scene.backgroundAssetId &&
      !scene.objects.length &&
      !scene.content.length ? (
        <div className="canvas-empty">
          <strong>Your scene starts here</strong>
          <span>
            Import a background or add a sprite from the media library.
          </span>
        </div>
      ) : null}
      {editing && background?.failed ? (
        <div className="canvas-warning">
          Background unavailable. Choose another image from the library.
        </div>
      ) : null}
    </div>
  );
}
