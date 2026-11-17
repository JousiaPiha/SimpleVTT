import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { and, asc, eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { join, resolve } from "node:path";
import { assetSchema, type Asset } from "../../shared/contracts.js";
import { isAudioAsset, type AudioCategory } from "../../shared/audio.js";
import {
  soundboardEntrySchema,
  type SoundboardEntry,
} from "../../shared/soundboard.js";
import { soundboardEntries } from "./schema.js";
import { notFound } from "./store.js";

const libraryAssets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").$type<Asset["category"]>().notNull(),
  relativePath: text("relative_path").notNull(),
  mimeType: text("mime_type").notNull(),
  digest: text("digest").notNull(),
});
export type LibraryRecord = typeof libraryAssets.$inferSelect;

/** A separate catalog: global media never enters a session's SQLite database. */
export function openGlobalLibraryStore(directory: string) {
  const sqlite = new Database(join(directory, "library.sqlite"));
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: resolve("drizzle-global") });
    const getAsset = (id: string) =>
      db.select().from(libraryAssets).where(eq(libraryAssets.id, id)).get() ??
      notFound("Global track not found");
    return {
      getAsset,
      listAssets: () =>
        db.select().from(libraryAssets).orderBy(asc(libraryAssets.name)).all()
          .map((row) => assetSchema.parse(row)),
      find: (category: Asset["category"], digest: string) =>
        db.select().from(libraryAssets)
          .where(and(eq(libraryAssets.category, category), eq(libraryAssets.digest, digest)))
          .get(),
      soundboard: (id: string) => {
        const row = db.select().from(soundboardEntries)
          .where(eq(soundboardEntries.assetId, id)).get();
        return row ? soundboardEntrySchema.parse(row) : null;
      },
      importAssets(records: LibraryRecord[], sound?: SoundboardEntry) {
        db.transaction((tx) => {
          for (const record of records) tx.insert(libraryAssets).values(record).run();
          if (sound)
            tx.insert(soundboardEntries).values(soundboardEntrySchema.parse(sound)).run();
        });
      },
      rename(id: string, name: string) {
        getAsset(id);
        db.update(libraryAssets).set({ name }).where(eq(libraryAssets.id, id)).run();
        return assetSchema.parse(getAsset(id));
      },
      changeAudioCategory(id: string, category: AudioCategory) {
        const asset = getAsset(id);
        if (!isAudioAsset(asset))
          throw Object.assign(new Error("Choose a music, ambience or sound effect track"), { statusCode: 400 });
        const duplicate = db.select().from(libraryAssets)
          .where(and(eq(libraryAssets.category, category), eq(libraryAssets.digest, asset.digest))).get();
        if (duplicate && duplicate.id !== id)
          throw Object.assign(new Error("This audio is already in the global library under that category. Use the existing copy or delete it first."), { statusCode: 409 });
        db.update(libraryAssets).set({ category }).where(eq(libraryAssets.id, id)).run();
        return assetSchema.parse(getAsset(id));
      },
      deleteAsset(id: string) {
        getAsset(id);
        db.delete(libraryAssets).where(eq(libraryAssets.id, id)).run();
      },
      iconInUse: (id: string) =>
        !!db.select().from(soundboardEntries)
          .where(eq(soundboardEntries.customIconAssetId, id)).get(),
      close() {
        if (sqlite.open) {
          try {
            sqlite.pragma("wal_checkpoint(TRUNCATE)");
          } finally {
            sqlite.close();
          }
        }
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
