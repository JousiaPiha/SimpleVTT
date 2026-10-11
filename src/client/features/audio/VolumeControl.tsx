import { Group, Slider, Text } from "@mantine/core";
export function VolumeControl({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="volume-control">
      <Group justify="space-between" gap="xs" mb={6}>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          {Math.round(value * 100)}%
        </Text>
      </Group>
      <Slider
        thumbLabel={label}
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(value) => onChange(value / 100)}
        label={(value) => `${value}%`}
        disabled={disabled}
        size="sm"
      />
    </div>
  );
}
