import { expect, it } from "vitest";
import {
  audioPreferencesSchema,
  playlistInputSchema,
} from "../src/shared/audio.js";
it("validates finite normalized volume settings without playback state", () => {
  expect(
    audioPreferencesSchema.safeParse({
      volumes: { master: 2, music: 1, ambience: 1, effects: 1 },
      musicLoop: false,
      shuffle: false,
      ambienceVolumes: {},
    }).success,
  ).toBe(false);
  expect(
    audioPreferencesSchema.safeParse({
      volumes: { master: 1, music: 1, ambience: 1, effects: 1 },
      musicLoop: false,
      shuffle: false,
      ambienceVolumes: {},
      playing: true,
    }).success,
  ).toBe(false);
});
it("validates bounded playlist names and ordered asset references", () => {
  expect(
    playlistInputSchema.parse({
      name: "  Session music ",
      trackIds: ["a", "b", "a"],
    }),
  ).toEqual({ name: "Session music", trackIds: ["a", "b", "a"] });
  expect(
    playlistInputSchema.safeParse({ name: "", trackIds: [] }).success,
  ).toBe(false);
});
