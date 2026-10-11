import { ActionIcon, Group, NativeSelect, Tooltip } from "@mantine/core";
import { MousePointer2, Pencil, Circle, Square, Eraser } from "lucide-react";
import type { DrawingTool } from "../../../shared/drawing.js";

export function DrawingToolbar({
  tool,
  onTool,
  color,
  onColor,
  width,
  onWidth,
}: {
  tool: DrawingTool | null;
  onTool: (tool: DrawingTool | null) => void;
  color: string;
  onColor: (color: string) => void;
  width: number;
  onWidth: (width: number) => void;
}) {
  const tools = [
    { value: null, label: "Select and move", Icon: MousePointer2 },
    { value: "freehand", label: "Freehand", Icon: Pencil },
    { value: "oval", label: "Oval", Icon: Circle },
    { value: "rectangle", label: "Rectangle", Icon: Square },
    { value: "eraser", label: "Eraser", Icon: Eraser },
  ] as const;
  return (
    <Group gap={4} className="drawing-toolbar" aria-label="Drawing tools">
      {tools.map(({ value, label, Icon }) => (
        <Tooltip key={label} label={label}>
          <ActionIcon
            aria-label={label}
            aria-pressed={tool === value}
            variant={tool === value ? "filled" : "default"}
            onClick={() => onTool(value)}
            size="lg"
          >
            <Icon size={17} />
          </ActionIcon>
        </Tooltip>
      ))}
      <input
        type="color"
        aria-label="Drawing color"
        value={color}
        onChange={(event) => onColor(event.currentTarget.value)}
      />
      <NativeSelect
        aria-label="Drawing line width"
        value={String(width)}
        onChange={(event) => onWidth(Number(event.currentTarget.value))}
        data={[
          { value: "2", label: "Thin" },
          { value: "5", label: "Medium" },
          { value: "10", label: "Thick" },
          { value: "18", label: "Bold" },
        ]}
        size="xs"
        w={88}
      />
    </Group>
  );
}
