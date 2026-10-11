import { useMemo, useRef } from "react";
import Konva from "konva";
import { Group, Rect, Text } from "react-konva";
import type {
  ContentPatch,
  PublicContent,
  SceneContent,
} from "../../shared/content.js";
import { layoutContent } from "./contentLayout.js";

export function CanvasContent({
  content,
  editing,
  selected,
  onSelect,
  onPatch,
}: {
  content: SceneContent | PublicContent;
  editing: boolean;
  selected: boolean;
  onSelect?: () => void;
  onPatch?: (patch: ContentPatch) => void;
}) {
  const group = useRef<Konva.Group>(null);
  const lastMove = useRef(0);
  // Position changes do not affect wrapping, so dragging reuses the measured layout.
  const { width, height, fontSize, type } = content;
  const text = type === "text" ? content.text : "";
  const title = type === "loot" ? content.title : "";
  const description = type === "loot" ? content.description : "";
  const items = type === "loot" ? content.items : undefined;
  const page = type === "loot" ? content.page : 0;
  const layout = useMemo(() => {
    const blocks = layoutContent(content);
    const overflow = blocks.some((block) => {
      const measure = new Konva.Text({
        text: block.text,
        width: block.width,
        fontSize: block.fontSize,
        fontFamily: "Arial, sans-serif",
        fontStyle: block.bold ? "bold" : "normal",
        lineHeight: 1.2,
        wrap: "word",
      });
      const clipped = measure.height() > block.height;
      measure.destroy();
      return clipped;
    });
    return { blocks, overflow };
  }, [width, height, fontSize, type, text, title, description, items, page]);
  const sendPosition = (final: boolean) => {
    const node = group.current;
    if (!node) return;
    const now = performance.now();
    if (!final && now - lastMove.current < 50) return;
    lastMove.current = now;
    onPatch?.({ x: node.x(), y: node.y() });
  };
  // Public projection is authoritative; this guard also makes accidental admin input safe.
  if (!editing && "visible" in content && !content.visible) return null;
  return (
    <Group
      ref={group}
      x={content.x}
      y={content.y}
      width={width}
      height={height}
      opacity={editing && "visible" in content && !content.visible ? 0.5 : 1}
      draggable={editing}
      listening={editing}
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={onSelect}
      onDragMove={() => sendPosition(false)}
      onDragEnd={() => sendPosition(true)}
    >
      <Rect
        width={width}
        height={height}
        fill={content.panel ? "#111820" : "rgba(0,0,0,0)"}
        cornerRadius={content.panel ? 12 : 0}
      />
      <Group
        clipX={0}
        clipY={0}
        clipWidth={width}
        clipHeight={height}
        listening={false}
      >
        {layout.blocks.map((block, index) => (
          <Text
            key={index}
            {...block}
            fontStyle={block.bold ? "bold" : "normal"}
            fontFamily="Arial, sans-serif"
            fill={content.color}
            align={content.align}
            lineHeight={1.2}
            wrap="word"
            ellipsis
          />
        ))}
      </Group>
      {editing && selected ? (
        <Rect
          width={width}
          height={height}
          stroke="#65b9c3"
          strokeWidth={3}
          listening={false}
        />
      ) : null}
      {editing && layout.overflow ? (
        <Group y={height - 24} listening={false}>
          <Rect width={width} height={24} fill="#614214" />
          <Text
            text="Text clipped · enlarge box or reduce font"
            width={width}
            height={24}
            padding={4}
            fontSize={14}
            fill="#ffe1a2"
            ellipsis
            wrap="none"
          />
        </Group>
      ) : null}
    </Group>
  );
}
