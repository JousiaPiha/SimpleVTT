import { create } from "zustand";
import { z } from "zod";
import { api, json } from "../../api.js";
import { AudioEngine, type AudioSnapshot } from "./engine.js";
import {
  audioPreferencesSchema,
  playlistSchema,
  type Playlist,
  type PlaylistInput,
} from "../../../shared/audio.js";

export let audioEngine = new AudioEngine();
interface AudioUiState {
  snapshot: AudioSnapshot;
  playlists: Playlist[];
  deletedAssetIds: string[];
  forgetAsset: (id: string) => void;
  ready: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  settingsError: string | null;
  settingsDirty: boolean;
  settingsSaving: boolean;
  initialize: () => Promise<void>;
  savePlaylist: (input: PlaylistInput, id?: string) => Promise<Playlist | null>;
  deletePlaylist: (id: string) => Promise<boolean>;
  preferencesChanged: () => void;
  savePreferences: () => Promise<boolean>;
  clearError: () => void;
}
let epoch = 0;
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let initialLoad: Promise<void> | null = null;
let preferencesSave: Promise<boolean> | null = null;

export const useAudioStore = create<AudioUiState>((set, get) => ({
  snapshot: audioEngine.getSnapshot(),
  playlists: [],
  deletedAssetIds: [],
  ready: false,
  loading: false,
  busy: false,
  error: null,
  settingsError: null,
  settingsDirty: false,
  settingsSaving: false,
  clearError: () => set({ error: null }),
  forgetAsset: (id) => {
    const hadVolume = Object.hasOwn(
      audioEngine.getSnapshot().preferences.ambienceVolumes,
      id,
    );
    audioEngine.removeAsset(id);
    set((s) => ({
      deletedAssetIds: [...new Set([...s.deletedAssetIds, id])],
      playlists: s.playlists.map((p) => ({
        ...p,
        trackIds: p.trackIds.filter((track) => track !== id),
      })),
    }));
    if (hadVolume) get().preferencesChanged();
  },
  initialize: () => {
    if (initialLoad) return initialLoad;
    const current = epoch;
    set({ loading: true });
    initialLoad = (async () => {
      try {
        const [preferences, playlists] = await Promise.all([
          api("/api/admin/audio-preferences", {}, audioPreferencesSchema),
          api("/api/admin/playlists", {}, z.array(playlistSchema)),
        ]);
        if (current !== epoch) return;
        audioEngine.applyPreferences(preferences);
        set((s) => ({
          playlists: playlists.map((p) => ({
            ...p,
            trackIds: p.trackIds.filter(
              (id) => !s.deletedAssetIds.includes(id),
            ),
          })),
          ready: true,
          error: null,
        }));
      } catch (error) {
        if (current === epoch)
          set({
            error:
              error instanceof Error
                ? error.message
                : "Could not load audio settings",
          });
      } finally {
        if (current === epoch) {
          set({ loading: false });
          initialLoad = null;
        }
      }
    })();
    return initialLoad;
  },
  savePlaylist: async (input, id) => {
    const current = epoch;
    set({ busy: true, error: null });
    try {
      const playlist = await api(
        id ? `/api/admin/playlists/${id}` : "/api/admin/playlists",
        json(id ? "PUT" : "POST", {
          ...input,
          trackIds: input.trackIds.filter(
            (id) => !get().deletedAssetIds.includes(id),
          ),
        }),
        playlistSchema,
      );
      if (current !== epoch) return null;
      const currentPlaylist = {
        ...playlist,
        trackIds: playlist.trackIds.filter(
          (id) => !get().deletedAssetIds.includes(id),
        ),
      };
      set((s) => ({
        playlists: id
          ? s.playlists.map((p) => (p.id === id ? currentPlaylist : p))
          : [...s.playlists, currentPlaylist],
      }));
      return currentPlaylist;
    } catch (error) {
      if (current === epoch)
        set({
          error:
            error instanceof Error ? error.message : "Playlist was not saved",
        });
      return null;
    } finally {
      if (current === epoch) set({ busy: false });
    }
  },
  deletePlaylist: async (id) => {
    const current = epoch;
    set({ busy: true, error: null });
    try {
      await api(`/api/admin/playlists/${id}`, json("DELETE"));
      if (current !== epoch) return false;
      set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
      return true;
    } catch (error) {
      if (current === epoch)
        set({
          error:
            error instanceof Error ? error.message : "Playlist was not deleted",
        });
      return false;
    } finally {
      if (current === epoch) set({ busy: false });
    }
  },
  preferencesChanged: () => {
    if (!get().ready) return;
    revision++;
    set({ settingsDirty: true });
    clearTimeout(timer);
    timer = setTimeout(() => void get().savePreferences(), 300);
  },
  savePreferences: () => {
    clearTimeout(timer);
    if (preferencesSave) return preferencesSave;
    if (!get().settingsDirty) return Promise.resolve(true);
    if (!get().ready) return Promise.resolve(false);
    const current = epoch;
    set({ settingsSaving: true });
    preferencesSave = (async () => {
      try {
        while (get().settingsDirty && current === epoch) {
          const sentRevision = revision;
          const preferences = audioEngine.getSnapshot().preferences;
          await api(
            "/api/admin/audio-preferences",
            json("PUT", preferences),
            audioPreferencesSchema,
          );
          if (current !== epoch) return false;
          set({
            settingsDirty: revision !== sentRevision,
            settingsError: null,
          });
        }
        return current === epoch;
      } catch (error) {
        if (current === epoch)
          set({
            settingsError: `Audio settings are not saved. ${error instanceof Error ? error.message : "Please retry."}`,
          });
        return false;
      } finally {
        if (current === epoch) {
          set({ settingsSaving: false });
          preferencesSave = null;
        }
      }
    })();
    return preferencesSave;
  },
}));
let unsubscribe = audioEngine.subscribe(() =>
  useAudioStore.setState({ snapshot: audioEngine.getSnapshot() }),
);

// Kept outside React, so collapsing panels and changing scenes cannot interrupt playback.
export function shutdownAudio() {
  epoch++;
  clearTimeout(timer);
  initialLoad = null;
  preferencesSave = null;
  unsubscribe();
  void audioEngine.dispose();
  audioEngine = new AudioEngine();
  useAudioStore.setState({
    snapshot: audioEngine.getSnapshot(),
    playlists: [],
    deletedAssetIds: [],
    ready: false,
    loading: false,
    busy: false,
    error: null,
    settingsError: null,
    settingsDirty: false,
    settingsSaving: false,
  });
  unsubscribe = audioEngine.subscribe(() =>
    useAudioStore.setState({ snapshot: audioEngine.getSnapshot() }),
  );
}
