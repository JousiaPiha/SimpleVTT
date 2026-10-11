import {
  sqliteTable,
  text,
  real,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category", {
    enum: ["background", "sprite", "image", "music", "ambience", "effect"],
  }).notNull(),
  relativePath: text("relative_path").notNull().unique(),
  mimeType: text("mime_type").notNull(),
});
export const scenes = sqliteTable("scenes", {
  gridEnabled: integer("grid_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  gridSize: integer("grid_size").notNull().default(80),
  gridColor: text("grid_color").notNull().default("#ffffff"),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  backgroundAssetId: text("background_asset_id").references(() => assets.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const objects = sqliteTable("scene_objects", {
  id: text("id").primaryKey(),
  sceneId: text("scene_id")
    .notNull()
    .references(() => scenes.id, { onDelete: "cascade" }),
  assetId: text("asset_id")
    .notNull()
    .references(() => assets.id),
  name: text("name").notNull(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  scale: real("scale").notNull(),
  rotation: real("rotation").notNull(),
  zIndex: integer("z_index").notNull(),
  visible: integer("visible", { mode: "boolean" }).notNull(),
  width: real("width").notNull(),
  height: real("height").notNull(),
});
export const presentation = sqliteTable("presentation", {
  id: integer("id").primaryKey(),
  sceneId: text("scene_id").references(() => scenes.id, {
    onDelete: "set null",
  }),
});

export const sceneContent = sqliteTable("scene_content", {
  id: text("id").primaryKey(),
  sceneId: text("scene_id")
    .notNull()
    .references(() => scenes.id, { onDelete: "cascade" }),
  properties: text("properties").notNull(),
});

export const playlists = sqliteTable("playlists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});
export const playlistTracks = sqliteTable(
  "playlist_tracks",
  {
    playlistId: text("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
  },
  (table) => [primaryKey({ columns: [table.playlistId, table.position] })],
);
export const audioPreferences = sqliteTable("audio_preferences", {
  id: integer("id").primaryKey(),
  settings: text("settings").notNull(),
});

export const soundboardEntries = sqliteTable("soundboard_entries", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  group: text("group_name").notNull(),
  icon: text("icon").notNull(),
  customIconAssetId: text("custom_icon_asset_id").references(() => assets.id, {
    onDelete: "set null",
  }),
});

export const sceneDrawings = sqliteTable("scene_drawings", {
  position: integer("position").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  sceneId: text("scene_id")
    .notNull()
    .references(() => scenes.id, { onDelete: "cascade" }),
  properties: text("properties").notNull(),
});
