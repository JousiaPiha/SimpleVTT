import { Button, Group, Text } from "@mantine/core";
import { useEditor } from "../../stores/editor.js";
import { audioEngine, useAudioStore } from "./store.js";
import { VolumeControl } from "./VolumeControl.js";
export function AmbienceMixer() {
  const assets = useEditor((s) => s.assets);
  const { snapshot, preferencesChanged } = useAudioStore();
  const active = new Map(snapshot.ambience.map((a) => [a.asset.id, a]));
  const ambience = assets.filter((a) => a.category === "ambience");
  return (
    <div className="ambience-mixer">
      {ambience.length ? (
        ambience.map((asset) => (
          <div className="ambience-channel" key={asset.id}>
            <Group justify="space-between" gap="xs">
              <Text size="sm" fw={500} truncate>
                {asset.name}
              </Text>
              <Text size="xs" c={active.has(asset.id) ? "teal" : "dimmed"}>
                {active.get(asset.id)?.status ?? "Stopped"}
              </Text>
            </Group>
            <VolumeControl
              label={`Volume for ${asset.name}`}
              value={snapshot.preferences.ambienceVolumes[asset.id] ?? 1}
              onChange={(value) => {
                audioEngine.setAmbienceVolume(asset.id, value);
                preferencesChanged();
              }}
            />
            <Button
              size="xs"
              variant={active.has(asset.id) ? "default" : "light"}
              disabled={!snapshot.enabled}
              aria-label={`${active.has(asset.id) ? "Stop" : "Start"} ambience ${asset.name}`}
              onClick={() => {
                if (active.has(asset.id)) audioEngine.stopAmbience(asset.id);
                else void audioEngine.startAmbience(asset);
              }}
            >
              {active.has(asset.id) ? "Stop loop" : "Start loop"}
            </Button>
          </div>
        ))
      ) : (
        <Text size="sm" c="dimmed" py="lg">
          Import ambience in the Library tab to layer independent loops.
        </Text>
      )}
    </div>
  );
}
