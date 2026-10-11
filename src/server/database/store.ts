import {
  drawingInputSchema,
  drawingSchema,
  type DrawingInput,
} from "../../shared/drawing.js";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq, and, asc } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  assets,
  objects,
  scenes,
  presentation,
  playlists,
  playlistTracks,
  audioPreferences,
  sceneContent,
  soundboardEntries,
  sceneDrawings,
} from "./schema.js";
import type {
  Asset,
  ObjectPatch,
  Scene,
  ScenePatch,
} from "../../shared/contracts.js";
import {
  contentInputSchema,
  contentPatchSchema,
  sceneContentSchema,
  type ContentInput,
  type ContentPatch,
  type SceneContent,
} from "../../shared/content.js";

import {
  audioPreferencesSchema,
  DEFAULT_AUDIO_PREFERENCES,
  type AudioPreferences,
  type Playlist,
  type PlaylistInput,
} from "../../shared/audio.js";

import {
  soundboardInputSchema,
  soundboardEntrySchema,
  type SoundboardInput,
} from "../../shared/soundboard.js";

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
export function notFound(message = "Not found"): never {
  throw Object.assign(new Error(message), { statusCode: 404 });
}
export function openStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(join(dataDir, "simple-vtt.sqlite"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: resolve("drizzle") });
  db.insert(presentation)
    .values({ id: 1, sceneId: null })
    .onConflictDoNothing()
    .run();
  const readContent = (row: typeof sceneContent.$inferSelect): SceneContent =>
    sceneContentSchema.parse({
      ...JSON.parse(row.properties),
      id: row.id,
      sceneId: row.sceneId,
    });
  const getScene = (id: string): Scene => {
    const row = db.select().from(scenes).where(eq(scenes.id, id)).get();
    if (!row) return notFound("Scene not found");
    return {
      id: row.id,
      name: row.name,
      backgroundAssetId: row.backgroundAssetId,
      gridEnabled: row.gridEnabled,
      gridSize: row.gridSize,
      gridColor: row.gridColor,
      objects: db
        .select()
        .from(objects)
        .where(eq(objects.sceneId, id))
        .orderBy(asc(objects.zIndex))
        .all(),
      drawings: db
        .select()
        .from(sceneDrawings)
        .where(eq(sceneDrawings.sceneId, id))
        .orderBy(asc(sceneDrawings.position))
        .all()
        .map((row) =>
          drawingSchema.parse({ ...JSON.parse(row.properties), id: row.id }),
        ),
      content: db
        .select()
        .from(sceneContent)
        .where(eq(sceneContent.sceneId, id))
        .all()
        .map(readContent),
    };
  };
  const getAsset = (id: string) =>
    db.select().from(assets).where(eq(assets.id, id)).get() ??
    notFound("Asset not found");
  const requireImage = (id: string) => {
    const asset = getAsset(id);
    if (!asset.mimeType.startsWith("image/"))
      badRequest("Scene assets must be images");
    return asset;
  };
  const getPlaylist = (id: string): Playlist => {
    const row =
      db.select().from(playlists).where(eq(playlists.id, id)).get() ??
      notFound("Playlist not found");
    const trackIds = db
      .select()
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, id))
      .orderBy(asc(playlistTracks.position))
      .all()
      .map((track) => track.assetId);
    return { ...row, trackIds };
  };
  const savePlaylist = (id: string, input: PlaylistInput) => {
    for (const trackId of input.trackIds) {
      if (!getAsset(trackId).mimeType.startsWith("audio/"))
        badRequest("Playlists can contain only audio assets");
    }
    db.transaction((tx) => {
      tx.insert(playlists)
        .values({ id, name: input.name })
        .onConflictDoUpdate({ target: playlists.id, set: { name: input.name } })
        .run();
      tx.delete(playlistTracks).where(eq(playlistTracks.playlistId, id)).run();
      for (const [position, assetId] of input.trackIds.entries()) {
        tx.insert(playlistTracks)
          .values({ playlistId: id, position, assetId })
          .run();
      }
    });
    return getPlaylist(id);
  };
  const activeId = () => db.select().from(presentation).get()?.sceneId ?? null;
  return {
    close: () => sqlite.close(),
    listSoundboard: () =>
      db
        .select()
        .from(soundboardEntries)
        .all()
        .map((row) => soundboardEntrySchema.parse(row)),
    saveSoundboard(assetId: string, input: SoundboardInput) {
      const asset = getAsset(assetId);
      if (asset.category !== "effect" || !asset.mimeType.startsWith("audio/"))
        badRequest("Soundboard settings require a sound effect");
      const settings = soundboardInputSchema.parse(input);
      if (
        settings.customIconAssetId &&
        !getAsset(settings.customIconAssetId).mimeType.startsWith("image/")
      )
        badRequest("Custom icons must be images");
      db.insert(soundboardEntries)
        .values({ assetId, ...settings })
        .onConflictDoUpdate({
          target: soundboardEntries.assetId,
          set: settings,
        })
        .run();
      return { assetId, ...settings };
    },
    listPlaylists: () =>
      db
        .select()
        .from(playlists)
        .orderBy(asc(playlists.name), asc(playlists.id))
        .all()
        .map((row) => getPlaylist(row.id)),
    createPlaylist: (input: PlaylistInput) => savePlaylist(randomUUID(), input),
    updatePlaylist(id: string, input: PlaylistInput) {
      getPlaylist(id);
      return savePlaylist(id, input);
    },
    deletePlaylist(id: string) {
      getPlaylist(id);
      db.delete(playlists).where(eq(playlists.id, id)).run();
    },
    getAudioPreferences(): AudioPreferences {
      const row = db
        .select()
        .from(audioPreferences)
        .where(eq(audioPreferences.id, 1))
        .get();
      return audioPreferencesSchema.parse(
        row ? JSON.parse(row.settings) : DEFAULT_AUDIO_PREFERENCES,
      );
    },
    saveAudioPreferences(input: AudioPreferences) {
      const preferences = audioPreferencesSchema.parse(input);
      const settings = JSON.stringify(preferences);
      db.insert(audioPreferences)
        .values({ id: 1, settings })
        .onConflictDoUpdate({ target: audioPreferences.id, set: { settings } })
        .run();
      return preferences;
    },
    getScene,
    getAsset,
    assetUsage(id: string) {
      getAsset(id);
      const backgrounds = db
        .select({ sceneId: scenes.id })
        .from(scenes)
        .where(eq(scenes.backgroundAssetId, id))
        .all();
      const imageObjects = db
        .select({ sceneId: objects.sceneId })
        .from(objects)
        .where(eq(objects.assetId, id))
        .all();
      const tracks = db
        .select({ playlistId: playlistTracks.playlistId })
        .from(playlistTracks)
        .where(eq(playlistTracks.assetId, id))
        .all();
      return {
        sceneCount: new Set(
          [...backgrounds, ...imageObjects].map((row) => row.sceneId),
        ).size,
        backgroundCount: backgrounds.length,
        objectCount: imageObjects.length,
        playlistCount: new Set(tracks.map((row) => row.playlistId)).size,
        trackCount: tracks.length,
        soundboardIconCount: db
          .select()
          .from(soundboardEntries)
          .where(eq(soundboardEntries.customIconAssetId, id))
          .all().length,
      };
    },
    deleteAsset(id: string) {
      getAsset(id);
      db.transaction((tx) => {
        tx.delete(objects).where(eq(objects.assetId, id)).run();
        tx.delete(playlistTracks).where(eq(playlistTracks.assetId, id)).run();
        // The background foreign key clears references without deleting scenes.
        tx.delete(assets).where(eq(assets.id, id)).run();
      });
    },
    activeId,
    liveScene: () => {
      const id = activeId();
      return id ? getScene(id) : null;
    },
    listScenes: () =>
      db
        .select({
          id: scenes.id,
          name: scenes.name,
          backgroundAssetId: scenes.backgroundAssetId,
        })
        .from(scenes)
        .orderBy(asc(scenes.createdAt))
        .all(),
    createScene(name: string) {
      const id = randomUUID();
      db.insert(scenes)
        .values({ id, name, createdAt: Date.now(), updatedAt: Date.now() })
        .run();
      return getScene(id);
    },
    createDrawing(sceneId: string, input: DrawingInput) {
      if (getScene(sceneId).drawings.length >= 500)
        badRequest(
          "This scene has 500 drawings. Erase some before adding more.",
        );
      const properties = drawingInputSchema.parse(input);
      const id = randomUUID();
      db.insert(sceneDrawings)
        .values({ id, sceneId, properties: JSON.stringify(properties) })
        .run();
      return { id, ...properties };
    },
    deleteDrawing(sceneId: string, id: string) {
      getScene(sceneId);
      db.delete(sceneDrawings)
        .where(
          and(eq(sceneDrawings.sceneId, sceneId), eq(sceneDrawings.id, id)),
        )
        .run();
    },
    patchScene(id: string, patch: ScenePatch) {
      getScene(id);
      if (patch.backgroundAssetId) requireImage(patch.backgroundAssetId);
      db.update(scenes)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(scenes.id, id))
        .run();
      return getScene(id);
    },
    deleteScene(id: string) {
      getScene(id);
      db.delete(scenes).where(eq(scenes.id, id)).run();
    },
    present(sceneId: string | null) {
      if (sceneId) getScene(sceneId);
      db.update(presentation)
        .set({ sceneId })
        .where(eq(presentation.id, 1))
        .run();
    },
    createObject(
      sceneId: string,
      input: {
        assetId: string;
        name?: string;
        width?: number;
        height?: number;
      },
    ) {
      const scene = getScene(sceneId);
      const asset = requireImage(input.assetId);
      const object = {
        id: randomUUID(),
        sceneId,
        assetId: asset.id,
        name: input.name ?? asset.name,
        width: input.width ?? 320,
        height: input.height ?? 320,
        x: 800,
        y: 380,
        scale: 1,
        rotation: 0,
        zIndex: Math.min(
          10000,
          Math.max(-1, ...scene.objects.map((o) => o.zIndex)) + 1,
        ),
        visible: false,
      };
      db.insert(objects).values(object).run();
      return object;
    },
    createContent(sceneId: string, input: ContentInput) {
      getScene(sceneId);
      const properties = contentInputSchema.parse(input);
      const row = {
        id: randomUUID(),
        sceneId,
        properties: JSON.stringify(properties),
      };
      db.insert(sceneContent).values(row).run();
      return readContent(row);
    },
    patchContent(sceneId: string, id: string, patch: ContentPatch) {
      const query = and(
        eq(sceneContent.sceneId, sceneId),
        eq(sceneContent.id, id),
      );
      const existing = db.select().from(sceneContent).where(query).get();
      if (!existing) return notFound("Content not found");
      // Validate the merged discriminated type: loot fields cannot enter text or vice versa.
      const content = sceneContentSchema.parse({
        ...readContent(existing),
        ...contentPatchSchema.parse(patch),
      });
      const { id: _id, sceneId: _sceneId, ...properties } = content;
      db.update(sceneContent)
        .set({ properties: JSON.stringify(properties) })
        .where(query)
        .run();
      return content;
    },
    deleteContent(sceneId: string, id: string) {
      if (
        !db
          .delete(sceneContent)
          .where(
            and(eq(sceneContent.id, id), eq(sceneContent.sceneId, sceneId)),
          )
          .run().changes
      )
        notFound("Content not found");
    },
    patchObject(sceneId: string, id: string, patch: ObjectPatch) {
      const query = and(eq(objects.sceneId, sceneId), eq(objects.id, id));
      const existing = db.select().from(objects).where(query).get();
      if (!existing) return notFound("Object not found");
      if (Object.keys(patch).length)
        db.update(objects).set(patch).where(query).run();
      return { ...existing, ...patch };
    },
    deleteObject(sceneId: string, id: string) {
      if (
        !db
          .delete(objects)
          .where(and(eq(objects.id, id), eq(objects.sceneId, sceneId)))
          .run().changes
      )
        notFound("Object not found");
    },
    listAssets: (): Asset[] =>
      db
        .select({
          id: assets.id,
          name: assets.name,
          category: assets.category,
          mimeType: assets.mimeType,
        })
        .from(assets)
        .orderBy(asc(assets.name))
        .all(),
    addAsset(input: {
      name: string;
      category: Asset["category"];
      relativePath: string;
      mimeType: string;
    }) {
      const existing = db
        .select()
        .from(assets)
        .where(eq(assets.relativePath, input.relativePath))
        .get();
      if (existing) return existing;
      const asset = { ...input, id: randomUUID() };
      db.insert(assets).values(asset).run();
      return asset;
    },
  };
}
export type Store = ReturnType<typeof openStore>;
