import { z } from "zod";
import type { Asset } from "./contracts.js";

export const audioCategorySchema = z.enum(["music", "ambience", "effect"]);
export type AudioCategory = z.infer<typeof audioCategorySchema>;
export const isAudioAsset = (asset: Asset): boolean =>
  asset.mimeType.startsWith("audio/");
export const playlistInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    trackIds: z.array(z.string().min(1).max(128)).max(500),
  })
  .strict();
export const playlistSchema = playlistInputSchema.extend({ id: z.string() });
export type Playlist = z.infer<typeof playlistSchema>;
export type PlaylistInput = z.infer<typeof playlistInputSchema>;
const volume = z.number().finite().min(0).max(1);
export const audioPreferencesSchema = z
  .object({
    volumes: z
      .object({
        master: volume,
        music: volume,
        ambience: volume,
        effects: volume,
      })
      .strict(),
    musicLoop: z.boolean(),
    shuffle: z.boolean(),
    ambienceVolumes: z
      .record(z.string().min(1).max(128), volume)
      .refine(
        (value) => Object.keys(value).length <= 500,
        "Too many ambience settings",
      ),
  })
  .strict();
export type AudioPreferences = z.infer<typeof audioPreferencesSchema>;
export type VolumeChannel = keyof AudioPreferences["volumes"];
export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  volumes: { master: 0.8, music: 0.7, ambience: 0.6, effects: 0.8 },
  musicLoop: false,
  shuffle: false,
  ambienceVolumes: {},
};
