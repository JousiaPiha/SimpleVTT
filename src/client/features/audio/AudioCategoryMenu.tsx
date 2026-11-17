import { Button, Menu } from "@mantine/core";
import { Check, ChevronDown } from "lucide-react";
import type { Asset } from "../../../shared/contracts.js";
import type { AudioCategory } from "../../../shared/audio.js";
import { HelpTooltip } from "../../components/HelpTooltip.js";

const categories: { value: AudioCategory; label: string }[] = [
  { value: "music", label: "Music" },
  { value: "ambience", label: "Ambience" },
  { value: "effect", label: "Sound effects" },
];

export function AudioCategoryMenu({ asset, disabled, onChange }: {
  asset: Asset;
  disabled: boolean;
  onChange: (category: AudioCategory) => void;
}) {
  return (
    <Menu position="top-start" withinPortal>
      <HelpTooltip label="Change this copy’s audio category. The file, playlists and soundboard settings are kept. Current playback continues.">
        <Menu.Target>
          <Button size="compact-xs" variant="subtle" color="gray" px={0}
            aria-label={`Change category for ${asset.name}`} disabled={disabled}
            rightSection={<ChevronDown size={12} aria-hidden="true" />}>
            {categories.find((category) => category.value === asset.category)?.label ?? asset.category}
          </Button>
        </Menu.Target>
      </HelpTooltip>
      <Menu.Dropdown>
        <Menu.Label>Change category</Menu.Label>
        {categories.map((category) => (
          <Menu.Item key={category.value} disabled={disabled || category.value === asset.category}
            rightSection={category.value === asset.category ? <Check size={14} aria-hidden="true" /> : null}
            onClick={() => onChange(category.value)}>
            {category.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
