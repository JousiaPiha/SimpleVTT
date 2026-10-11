import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { isAudioAsset } from "../../../shared/audio.js";
import { useEditor } from "../../stores/editor.js";
import { audioEngine, useAudioStore } from "./store.js";

export function PlaylistEditor() {
  const { assets } = useEditor();
  const {
    playlists,
    deletedAssetIds,
    busy,
    ready,
    savePlaylist,
    deletePlaylist,
    snapshot,
  } = useAudioStore();
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [trackIds, setTrackIds] = useState<string[]>([]);
  const [track, setTrack] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!deletedAssetIds.length) return;
    setTrackIds((current) =>
      current.filter((id) => !deletedAssetIds.includes(id)),
    );
    setTrack((current) =>
      current && deletedAssetIds.includes(current) ? null : current,
    );
  }, [deletedAssetIds]);
  const audio = assets.filter(isAudioAsset);
  const byId = new Map(audio.map((a) => [a.id, a]));
  function choose(value: string | null) {
    setId(value);
    setSaved(false);
    const playlist = playlists.find((p) => p.id === value);
    setName(playlist?.name ?? "");
    setTrackIds(playlist?.trackIds ?? []);
  }
  function move(index: number, direction: number) {
    setSaved(false);
    setTrackIds((current) => {
      const next = [...current];
      [next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ];
      return next;
    });
  }
  return (
    <div className="playlist-editor">
      <div className="playlist-controls">
        <Select
          aria-label="Select playlist"
          placeholder="New playlist"
          value={id}
          onChange={choose}
          disabled={!ready || busy}
          clearable
          data={playlists.map((p) => ({ value: p.id, label: p.name }))}
        />
        <TextInput
          label="Playlist name"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
            setSaved(false);
          }}
          maxLength={120}
          disabled={!ready || busy}
        />
        <Group gap="xs">
          <Button
            size="xs"
            disabled={!ready || busy || !name.trim()}
            loading={busy}
            onClick={async () => {
              const result = await savePlaylist(
                { name, trackIds },
                id ?? undefined,
              );
              if (result) {
                setId(result.id);
                setName(result.name);
                setSaved(true);
              }
            }}
          >
            Save playlist
          </Button>
          <Button
            size="xs"
            variant="default"
            disabled={!snapshot.enabled || !trackIds.length}
            onClick={() =>
              void audioEngine.setQueue(
                trackIds.flatMap((trackId) => {
                  const asset = byId.get(trackId);
                  return asset ? [asset] : [];
                }),
              )
            }
          >
            Play playlist
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            disabled={!ready || busy}
            onClick={() => choose(null)}
          >
            New
          </Button>
          {id ? (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              disabled={!ready || busy}
              onClick={() => setDeleting(true)}
            >
              Delete playlist
            </Button>
          ) : null}
        </Group>
        {saved ? (
          <Text size="xs" c="teal">
            Playlist saved
          </Text>
        ) : (
          <Text size="xs" c="dimmed">
            Save to keep the name and track order.
          </Text>
        )}
      </div>
      <div className="playlist-tracks">
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label="Add playlist track"
            placeholder="Choose an audio track"
            searchable
            value={track}
            onChange={setTrack}
            data={audio.map((a) => ({ value: a.id, label: a.name }))}
            style={{ flex: 1 }}
          />
          <Button
            size="xs"
            variant="light"
            disabled={!track || busy || trackIds.length >= 500}
            onClick={() => {
              if (track) {
                setTrackIds((current) => [...current, track]);
                setSaved(false);
              }
            }}
          >
            Add track
          </Button>
        </Group>
        <div className="playlist-track-list">
          {trackIds.length ? (
            trackIds.map((trackId, index) => (
              <div className="playlist-track" key={`${index}:${trackId}`}>
                <Text size="sm" truncate>
                  {index + 1}. {byId.get(trackId)?.name ?? "Missing track"}
                </Text>
                <Group gap={4} wrap="nowrap">
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    aria-label={`Move track ${index + 1} up`}
                    disabled={index === 0 || busy}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    aria-label={`Move track ${index + 1} down`}
                    disabled={index === trackIds.length - 1 || busy}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    aria-label={`Remove track ${index + 1}`}
                    disabled={!ready || busy}
                    onClick={() => {
                      setTrackIds((current) =>
                        current.filter((_, i) => i !== index),
                      );
                      setSaved(false);
                    }}
                  >
                    Remove
                  </Button>
                </Group>
              </div>
            ))
          ) : (
            <Text size="sm" c="dimmed" py="lg">
              Add tracks in the order you want them to play. Repeating a track
              is allowed.
            </Text>
          )}
        </div>
      </div>
      <Modal
        opened={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this playlist?"
        centered
      >
        <Stack>
          <Text size="sm">
            The audio files stay in your library. Current playback continues.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={busy}
              onClick={async () => {
                if (id && (await deletePlaylist(id))) {
                  choose(null);
                  setDeleting(false);
                }
              }}
            >
              Delete permanently
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
