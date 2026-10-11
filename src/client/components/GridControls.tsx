import { useEffect, useState } from "react";
import {
  Button,
  ColorPicker,
  TextInput,
  NumberInput,
  Slider,
  Popover,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { Grid2X2 } from "lucide-react";
import { scenePatchSchema, type Scene } from "../../shared/contracts.js";
import { useEditor } from "../stores/editor.js";

export type GridPreview = Pick<
  Scene,
  "gridEnabled" | "gridSize" | "gridColor"
> & { sceneId: string };

export function GridControls({
  scene,
  onPreview,
}: {
  scene: Scene;
  onPreview: (preview: GridPreview | null) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [enabled, setEnabled] = useState(scene.gridEnabled);
  const [size, setSize] = useState<string | number>(scene.gridSize);
  const [color, setColor] = useState(scene.gridColor);
  const pending = useEditor((s) => s.pending);
  const input = scenePatchSchema.safeParse({
    gridEnabled: enabled,
    gridSize: size,
    gridColor: color,
  });
  useEffect(() => {
    const valid = scenePatchSchema.safeParse({
      gridEnabled: enabled,
      gridSize: size,
      gridColor: color,
    });
    onPreview(
      opened && valid.success && typeof size === "number"
        ? {
            sceneId: scene.id,
            gridEnabled: enabled,
            gridSize: size,
            gridColor: color,
          }
        : null,
    );
    return () => onPreview(null);
  }, [opened, enabled, size, color, scene.id, onPreview]);
  const reset = () => {
    setEnabled(scene.gridEnabled);
    setSize(scene.gridSize);
    setColor(scene.gridColor);
  };
  return (
    <Popover
      opened={opened}
      onChange={(value) => {
        if (value) reset();
        setOpened(value);
      }}
      width={270}
      position="top-start"
      withinPortal
      trapFocus
    >
      <Popover.Target>
        <Button
          size="xs"
          variant={scene.gridEnabled ? "light" : "default"}
          leftSection={<Grid2X2 size={15} aria-hidden="true" />}
          aria-label="Scene grid settings"
          aria-expanded={opened}
          onClick={() => {
            if (!opened) reset();
            setOpened(!opened);
          }}
        >
          Grid{scene.gridEnabled ? " on" : ""}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              input.success &&
              (await useEditor.getState().updateScene(input.data))
            )
              setOpened(false);
          }}
        >
          <Stack gap="sm">
            <Switch
              label="Show scene grid"
              checked={enabled}
              disabled={pending > 0}
              onChange={(e) => setEnabled(e.currentTarget.checked)}
            />
            <NumberInput
              label="Grid spacing"
              description="Square size in scene pixels (20–400)."
              value={size}
              min={20}
              max={400}
              allowDecimal={false}
              allowNegative={false}
              disabled={pending > 0}
              onChange={setSize}
            />
            <Slider
              thumbLabel="Grid spacing slider"
              min={20}
              max={400}
              step={1}
              value={
                typeof size === "number"
                  ? Math.max(20, Math.min(400, size))
                  : scene.gridSize
              }
              disabled={pending > 0}
              onChange={setSize}
              label={(value) => `${value} px`}
            />
            <TextInput
              label="Grid color"
              value={color}
              maxLength={7}
              disabled={pending > 0}
              onChange={(e) => setColor(e.currentTarget.value)}
            />
            <ColorPicker
              format="hex"
              value={color}
              onChange={setColor}
              fullWidth
              swatches={[
                "#ffffff",
                "#000000",
                "#9ca3af",
                "#fbbf24",
                "#38bdf8",
                "#ef4444",
              ]}
            />
            <Text size="xs" c="dimmed">
              Preview changes here as you adjust. Apply grid saves them and
              updates the player display. Closing cancels the preview.
            </Text>
            <Button
              size="xs"
              type="submit"
              disabled={!input.success}
              loading={pending > 0}
            >
              Apply grid
            </Button>
          </Stack>
        </form>
      </Popover.Dropdown>
    </Popover>
  );
}
