import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Slider,
  Switch,
  Tabs,
  Text,
} from "@mantine/core";
import { audioEngine, useAudioStore } from "./store.js";
import { AudioLibrary } from "./AudioLibrary.js";
import { PlaylistEditor } from "./PlaylistEditor.js";
import { AmbienceMixer } from "./AmbienceMixer.js";
import { Soundboard } from "./Soundboard.js";
import { VolumeControl } from "./VolumeControl.js";
import type { VolumeChannel } from "../../../shared/audio.js";

const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export function AudioPanel() {
  const [expanded, setExpanded] = useState(false);
  const state = useAudioStore();
  const { snapshot } = state;
  useEffect(() => {
    void useAudioStore.getState().initialize();
  }, []);
  const { music, preferences } = snapshot;
  const changeVolume = (channel: VolumeChannel, value: number) => {
    audioEngine.setVolume(channel, value);
    state.preferencesChanged();
  };
  return (
    <section
      className={`audio-panel ${expanded ? "expanded" : ""}`}
      aria-label="GM audio controls"
    >
      <div className="audio-bar">
        <div className="audio-heading">
          <Text size="sm" fw={600}>
            Audio
          </Text>
          <Text size="xs" c="dimmed">
            GM speakers only
          </Text>
        </div>
        <div className="now-playing">
          <Text size="sm" truncate title={music.asset?.name}>
            {music.asset?.name ?? "No music selected"}
          </Text>
          <Text
            size="xs"
            c={music.status === "playing" ? "teal" : "dimmed"}
            data-testid="music-status"
          >
            {music.status === "playing"
              ? "Playing"
              : music.status === "paused"
                ? "Paused"
                : music.status === "loading"
                  ? "Loading…"
                  : "Stopped"}
          </Text>
        </div>
        <Group gap={5} wrap="nowrap" className="music-transport">
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            aria-label="Previous track"
            disabled={!snapshot.enabled || !snapshot.queue.length}
            onClick={() => void audioEngine.previous()}
          >
            Previous
          </Button>
          <Button
            size="xs"
            variant="light"
            aria-label={
              music.status === "playing" ? "Pause music" : "Resume music"
            }
            disabled={
              !snapshot.enabled || !music.asset || music.status === "loading"
            }
            onClick={() => {
              if (music.status === "playing") audioEngine.pauseMusic();
              else void audioEngine.resumeMusic();
            }}
          >
            {music.status === "playing" ? "Pause" : "Play"}
          </Button>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            aria-label="Next track"
            disabled={!snapshot.enabled || !snapshot.queue.length}
            onClick={() => void audioEngine.next()}
          >
            Next
          </Button>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            aria-label="Stop music"
            disabled={!music.asset}
            onClick={() => audioEngine.stopMusic()}
          >
            Stop
          </Button>
        </Group>
        <div className="audio-master">
          <VolumeControl
            label="Master volume"
            value={preferences.volumes.master}
            disabled={!state.ready}
            onChange={(value) => changeVolume("master", value)}
          />
        </div>
        {!snapshot.enabled ? (
          <Button
            size="xs"
            disabled={!state.ready}
            onClick={() => void audioEngine.enable()}
          >
            Enable Audio
          </Button>
        ) : (
          <Button
            size="xs"
            variant="default"
            onClick={() => audioEngine.stopAll()}
          >
            Stop all audio
          </Button>
        )}
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          aria-label={`${expanded ? "Collapse" : "Expand"} audio panel`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Collapse" : "Mixer & library"}
        </Button>
      </div>
      {snapshot.error ? (
        <Alert
          color="red"
          withCloseButton
          onClose={() => audioEngine.clearError()}
          py="xs"
        >
          {snapshot.error}
        </Alert>
      ) : null}
      {state.error ? (
        <Alert color="red" withCloseButton onClose={state.clearError} py="xs">
          {state.error}{" "}
          {!state.ready ? (
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => void state.initialize()}
            >
              Retry audio setup
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {state.settingsError ? (
        <Alert color="orange" py="xs">
          {state.settingsError}{" "}
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => void state.savePreferences()}
          >
            Retry saving settings
          </Button>
        </Alert>
      ) : null}
      <div className="audio-expanded" hidden={!expanded}>
        <div className="audio-mix-controls">
          <div className="music-timeline">
            <Group justify="space-between" mb={7}>
              <Text size="xs" c="dimmed">
                {time(music.currentTime)} / {time(music.duration)}
              </Text>
              <Text size="xs" c="dimmed">
                {snapshot.queue.length
                  ? `Track ${snapshot.queueIndex + 1} of ${snapshot.queue.length}`
                  : "Music player"}
              </Text>
            </Group>
            <Slider
              thumbLabel="Music position"
              min={0}
              max={Math.max(1, music.duration)}
              step={0.1}
              value={music.currentTime}
              disabled={!music.duration}
              onChange={(value) => audioEngine.seek(value)}
              label={time}
              size="sm"
            />
          </div>
          <Group gap="lg">
            <Switch
              size="xs"
              label="Loop music"
              checked={preferences.musicLoop}
              disabled={!state.ready}
              onChange={(e) => {
                audioEngine.setMusicLoop(e.currentTarget.checked);
                state.preferencesChanged();
              }}
            />
            <Switch
              size="xs"
              label="Shuffle"
              checked={preferences.shuffle}
              disabled={!state.ready}
              onChange={(e) => {
                audioEngine.setShuffle(e.currentTarget.checked);
                state.preferencesChanged();
              }}
            />
          </Group>
          <div className="category-volumes">
            {(["music", "ambience", "effects"] as const).map((channel) => (
              <VolumeControl
                key={channel}
                label={`${channel[0].toUpperCase()}${channel.slice(1)} volume`}
                value={preferences.volumes[channel]}
                disabled={!state.ready}
                onChange={(value) => changeVolume(channel, value)}
              />
            ))}
          </div>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {snapshot.ambience.length} ambient loops
            </Text>
            <Text size="xs" c="dimmed" data-testid="active-effects">
              {snapshot.effectCount} active effects
            </Text>
          </Group>
          <Text size="xs" c={state.settingsError ? "orange" : "dimmed"}>
            {state.loading
              ? "Loading saved audio settings…"
              : state.settingsDirty
                ? "Audio settings not yet saved"
                : "Audio settings saved"}
          </Text>
        </div>
        <Tabs defaultValue="library" keepMounted={true} className="audio-tabs">
          <Tabs.List>
            <Tabs.Tab value="library">Library</Tabs.Tab>
            <Tabs.Tab value="playlists">Playlists</Tabs.Tab>
            <Tabs.Tab value="ambience">Ambience</Tabs.Tab>
            <Tabs.Tab value="effects">Soundboard</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="library">
            <AudioLibrary />
          </Tabs.Panel>
          <Tabs.Panel value="playlists">
            <PlaylistEditor />
          </Tabs.Panel>
          <Tabs.Panel value="ambience">
            <AmbienceMixer />
          </Tabs.Panel>
          <Tabs.Panel value="effects">
            <Soundboard />
          </Tabs.Panel>
        </Tabs>
      </div>
    </section>
  );
}
