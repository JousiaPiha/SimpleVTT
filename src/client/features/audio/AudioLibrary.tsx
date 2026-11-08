import { OnlineAudioImport } from "./OnlineAudioImport.js";
import type { Asset } from "../../../shared/contracts.js";
import { CompactAction } from "../../components/CompactAction.js";
import { DeleteAssetDialog } from "../../components/DeleteAssetDialog.js";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  SegmentedControl,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import {
  audioCategorySchema,
  isAudioAsset,
  type AudioCategory,
} from "../../../shared/audio.js";
import { useEditor } from "../../stores/editor.js";
import { audioEngine, useAudioStore } from "./store.js";
import { GlobalAudioLibrary } from "./GlobalAudioLibrary.js";
import { useGlobalLibrary } from "./useGlobalLibrary.js";

export function AudioLibrary() {
  const { assets, importImages, scan, pending } = useEditor();
  const { snapshot } = useAudioStore();
  const library = useGlobalLibrary();
  const [location, setLocation] = useState("session");
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [category, setCategory] = useState<AudioCategory>("music");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const files = useRef<HTMLInputElement>(null);
  const { load } = library;
  useEffect(() => {
    if (location === "global") void load();
  }, [location, load]);
  const matches = (asset: Asset) =>
    (filter === "all" || asset.category === filter) &&
    asset.name.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  const audio = assets.filter(isAudioAsset).filter(matches);
  return (
    <>
      <Group justify="space-between" mb="xs">
        <SegmentedControl
          aria-label="Audio library location"
          size="xs"
          value={location}
          onChange={setLocation}
          disabled={!!library.busy}
          data={[
            { value: "session", label: "Session" },
            { value: "global", label: "Global library" },
          ]}
        />
        {location === "global" ? (
          <Button
            size="compact-xs"
            variant="subtle"
            loading={library.busy === "load"}
            disabled={!!library.busy}
            onClick={() => void library.load()}
          >
            Refresh global library
          </Button>
        ) : null}
      </Group>
      {library.error ? (
        <Alert color="red" py="xs" mb="xs">
          {library.error}{" "}
          {location === "global" ? (
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={!!library.busy}
              onClick={() => void library.load()}
            >
              Retry global library
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {library.notice ? (
        <Text size="xs" c="teal" mb="xs" role="status">{library.notice}</Text>
      ) : null}
      <div className={`audio-library-toolbar ${location === "global" ? "global-audio-toolbar" : ""}`}>
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
        {location === "session" ? (
          <>
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
          </>
        ) : null}
      </div>
      <div hidden={location !== "session"}>
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
                  <Button
                    size="compact-xs"
                    variant="default"
                    aria-label={`Add to global library ${asset.name}`}
                    disabled={pending > 0 || !!library.busy}
                    loading={library.busy === `transfer:${asset.id}`}
                    onClick={() => void library.transfer(asset, "global")}
                  >
                    Add to global library
                  </Button>
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
      </div>
      {location === "global" ? (
        <GlobalAudioLibrary
          library={library}
          assets={library.assets.filter(isAudioAsset).filter(matches)}
        />
      ) : null}
      {deleting ? (
        <DeleteAssetDialog asset={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </>
  );
}
