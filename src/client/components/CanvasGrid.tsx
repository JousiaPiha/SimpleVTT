import { Group, Line } from "react-konva";
import { CANVAS } from "../../shared/contracts.js";

export function CanvasGrid({
  size,
  color,
  scale,
}: {
  size: number;
  color: string;
  scale: number;
}) {
  return (
    <Group listening={false} opacity={0.45}>
      {Array.from({ length: Math.ceil(CANVAS.width / size) - 1 }, (_, i) => (
        <Line
          key={`x${i}`}
          points={[(i + 1) * size, 0, (i + 1) * size, CANVAS.height]}
          stroke={color}
          strokeWidth={1 / scale}
          perfectDrawEnabled={false}
        />
      ))}
      {Array.from({ length: Math.ceil(CANVAS.height / size) - 1 }, (_, i) => (
        <Line
          key={`y${i}`}
          points={[0, (i + 1) * size, CANVAS.width, (i + 1) * size]}
          stroke={color}
          strokeWidth={1 / scale}
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
}
