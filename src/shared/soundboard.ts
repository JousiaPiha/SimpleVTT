import { z } from "zod";

// A focused offline palette; IDs are persisted independently of React components.
export const SOUND_ICONS = [
  "volume-2",
  "swords",
  "shield",
  "bow-arrow",
  "bomb",
  "flame",
  "zap",
  "cloud-lightning",
  "cloud-rain",
  "wind",
  "waves",
  "droplets",
  "trees",
  "bird",
  "paw-print",
  "bug",
  "footprints",
  "door-open",
  "bell",
  "key-round",
  "lock",
  "hammer",
  "pickaxe",
  "coins",
  "gem",
  "skull",
  "ghost",
  "sparkles",
  "heart",
  "laugh",
  "megaphone",
  "music",
] as const;
export type SoundIcon = (typeof SOUND_ICONS)[number];
export const soundboardInputSchema = z
  .object({
    group: z.string().trim().max(60),
    icon: z.enum(SOUND_ICONS),
    customIconAssetId: z.string().min(1).max(128).nullable(),
  })
  .strict();
export const soundboardEntrySchema = soundboardInputSchema.extend({
  assetId: z.string(),
});
export type SoundboardInput = z.infer<typeof soundboardInputSchema>;
export type SoundboardEntry = z.infer<typeof soundboardEntrySchema>;
export const DEFAULT_SOUND: SoundboardInput = {
  group: "",
  icon: "volume-2",
  customIconAssetId: null,
};
