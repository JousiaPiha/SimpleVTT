import { OnlineAudioImport } from "./OnlineAudioImport.js";
import type { Asset } from "../../../shared/contracts.js";
import { CompactAction } from "../../components/CompactAction.js";
import { DeleteAssetDialog } from "../../components/DeleteAssetDialog.js";
import { useRef, useState } from "react";
import { Button, Group, Select, Text, TextInput } from "@mantine/core";
import {
  audioCategorySchema,
  isAudioAsset,
  type AudioCategory,
} from "../../../shared/audio.js";
import { useEditor } from "../../stores/editor.js";
import { audioEngine, useAudioStore } from "./store.js";

export function AudioLibrary() {
  const { assets, importImages, scan, pending } = useEditor();
  const { snapshot } = useAudioStore();
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [category, setCategory] = useState<AudioCategory>("music");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const files = useRef<HTMLInputElement>(null);
  const audio = assets
    .filter(isAudioAsset)
    .filter(
      (a) =>
        (filter === "all" || a.category === filter) &&
        a.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
  return (
    <>
      <div className="audio-library-toolbar">
        <TextInput
          label="Search library"
          aria-label="Search audio"
          placeholder="Search audio…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <Select
          label="Show in library"
          aria-label="Filter audio category"
          value={filter}
          onChange={(value) => setFilter(value ?? "all")}
          data={[
            { value: "all", label: "All audio" },
            { value: "music", label: "Music" },
            { value: "ambience", label: "Ambience" },
            { value: "effect", label: "Sound effects" },
          ]}
        />
        <Select
          label="Import as"
          aria-label="Audio import category"
          value={category}
          onChange={(value) => {
            const result = audioCategorySchema.safeParse(value);
            if (result.success) setCategory(result.data);
          }}
          data={[
            { value: "music", label: "Music" },
            { value: "ambience", label: "Ambience" },
            { value: "effect", label: "Sound effect" },
          ]}
        />
        <Button
          size="xs"
          variant="light"
          disabled={pending > 0}
          onClick={() => files.current?.click()}
        >
          Import audio
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          disabled={pending > 0}
          onClick={() => void scan()}
        >
          Scan folder
        </Button>
      </div>
      <OnlineAudioImport category={category} />
      <input
        className="file-input"
        ref={files}
        type="file"
        multiple
        accept=".mp3,.wav,.ogg,.oga,.flac,.m4a,audio/*"
        aria-label="Import audio files"
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          if (selected.length) void importImages(selected, category);
          e.target.value = "";
        }}
      />
      <div className="audio-asset-list">
        {audio.length ? (
          audio.map((asset) => (
            <div className="audio-asset-row" key={asset.id}>
              <div className="audio-asset-name">
                <Text size="sm" truncate title={asset.name}>
                  {asset.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {asset.category === "effect"
                    ? "Sound effect"
                    : asset.category}
                </Text>
              </div>
              <Group gap={6} wrap="nowrap">
                {asset.category === "ambience" ? (
                  <Button
                    size="compact-xs"
                    variant="light"
                    disabled={!snapshot.enabled}
                    aria-label={`${snapshot.ambience.some((a) => a.asset.id === asset.id) ? "Stop" : "Start"} ambience ${asset.name}`}
                    onClick={() =>
                      snapshot.ambience.some((a) => a.asset.id === asset.id)
                        ? audioEngine.stopAmbience(asset.id)
                        : void audioEngine.startAmbience(asset)
                    }
                  >
                    {snapshot.ambience.some((a) => a.asset.id === asset.id)
                      ? "Stop ambience"
                      : "Loop ambience"}
                  </Button>
                ) : asset.category === "effect" ? (
                  <Button
                    size="compact-xs"
                    variant="light"
                    disabled={!snapshot.enabled}
                    aria-label={`Trigger ${asset.name}`}
                    onClick={() => void audioEngine.triggerEffect(asset)}
                  >
                    Trigger
                  </Button>
                ) : (
                  <Button
                    size="compact-xs"
                    variant="light"
                    disabled={!snapshot.enabled}
                    aria-label={`Play ${asset.name}`}
                    onClick={() => void audioEngine.playMusic(asset)}
                  >
                    Play music
                  </Button>
                )}
                <CompactAction
                  icon="trash"
                  tooltip="Delete sound"
                  label={`Delete sound ${asset.name}`}
                  danger
                  disabled={pending > 0}
                  onClick={() => setDeleting(asset)}
                />
              </Group>
            </div>
          ))
        ) : (
          <Text size="sm" c="dimmed" py="lg">
            {assets.some(isAudioAsset)
              ? "No matching audio."
              : "Import music, ambience, or short sound effects. Files stay on this computer."}
          </Text>
        )}
      </div>
      {deleting ? (
        <DeleteAssetDialog asset={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </>
  );
}
