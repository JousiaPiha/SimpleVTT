import {
  access,
  lstat,
  mkdir,
  open,
  realpath,
  readFile,
  rmdir,
  unlink,
} from "node:fs/promises";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { fileTypeFromFile } from "file-type";
import Database from "better-sqlite3";
import { z } from "zod";
import type { Store } from "../database/store.js";
export const manifestSchema = z
  .object({
    application: z.literal("SimpleVTT"),
    version: z.literal(1),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();
export type SessionManifest = z.infer<typeof manifestSchema>;
export async function existingDirectory(path: string, writable = true) {
  const canonical = await realpath(resolve(path));
  const info = await lstat(canonical);
  if (!info.isDirectory()) throw new Error("Select an existing session folder");
  await access(canonical, constants.R_OK | (writable ? constants.W_OK : 0));
  return canonical;
}
export function within(root: string, path: string) {
  const inside = relative(root, path);
  return (
    !inside ||
    (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
  );
}
export async function regularFile(root: string, path: string) {
  const parts = path.split(/[\\/]/);
  if (
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    parts.some((part) => !part || part === ".." || part === ".")
  )
    throw new Error(`Unsafe session file: ${path}`);
  let full = root;
  for (const [index, part] of parts.entries()) {
    full = join(full, part);
    const info = await lstat(full);
    if (
      info.isSymbolicLink() ||
      (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())
    )
      throw new Error(
        `Session file must be contained and cannot be a symbolic link: ${path}`,
      );
  }
  await access(full, constants.R_OK);
  return full;
}
export async function validateDatabase(path: string) {
  for (const name of [
    "simple-vtt.sqlite",
    "simple-vtt.sqlite-wal",
    "simple-vtt.sqlite-shm",
  ]) {
    try {
      await regularFile(path, name);
    } catch (error) {
      if (
        name !== "simple-vtt.sqlite" &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        continue;
      throw error;
    }
  }
  const db = new Database(join(path, "simple-vtt.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    if (
      db.pragma("quick_check", { simple: true }) !== "ok" ||
      (db.pragma("foreign_key_check") as unknown[]).length
    )
      throw new Error(
        "Session database is corrupt or contains broken references",
      );
    const tables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as { name: string }[]
      ).map((row) => row.name),
    );
    for (const name of [
      "assets",
      "scenes",
      "scene_objects",
      "presentation",
      "scene_content",
      "playlists",
      "playlist_tracks",
      "audio_preferences",
      "soundboard_entries",
      "scene_drawings",
      "__drizzle_migrations",
    ])
      if (!tables.has(name))
        throw new Error("Not a complete SimpleVTT session database");
    if (
      (
        db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
          n: number;
        }
      ).n !== 6
    )
      throw new Error(
        "Unsupported session database version; use a matching SimpleVTT version",
      );
    if (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('trigger','view')",
        )
        .all().length
    )
      throw new Error("Unexpected executable schema in session database");
  } finally {
    db.close();
  }
}
export async function readManifest(path: string) {
  await regularFile(path, "session.json");
  const value: unknown = JSON.parse(
    await readFile(join(path, "session.json"), "utf8"),
  );
  if (
    typeof value === "object" &&
    value &&
    "version" in value &&
    value.version !== 1
  )
    throw new Error(
      "Unsupported session format version. Update SimpleVTT or open a version 1 session.",
    );
  return manifestSchema.parse(value);
}
export async function validateMedia(
  mediaPath: string,
  store: Store,
  portable = false,
) {
  const root = await existingDirectory(mediaPath, false);
  if ((await lstat(mediaPath)).isSymbolicLink())
    throw new Error("Session media directory cannot be a symbolic link");
  const paths = new Set<string>();
  const result: { id: string; source: string; name: string }[] = [];
  for (const asset of store.listAssets()) {
    const full = store.getAsset(asset.id);
    const source = await regularFile(root, full.relativePath).catch((error) => {
      throw new Error(
        `Missing or unsafe media “${asset.name}”: ${error instanceof Error ? error.message : "unavailable file"}`,
      );
    });
    const type = await fileTypeFromFile(source);
    if (
      !type ||
      type.mime !== asset.mimeType ||
      ![
        "png",
        "jpg",
        "webp",
        "gif",
        "mp3",
        "wav",
        "ogg",
        "opus",
        "flac",
        "m4a",
        "mp4",
      ].includes(type.ext)
    )
      throw new Error(`Unsupported or mismatched media: ${asset.name}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(asset.id))
      throw new Error(`Invalid asset identifier: ${asset.id}`);
    const name = `${asset.id}.${type.ext}`;
    if (paths.has(name.toLowerCase()))
      throw new Error(
        "Media filenames conflict on a case-insensitive filesystem",
      );
    paths.add(name.toLowerCase());
    if (portable && full.relativePath !== name)
      throw new Error(
        `Session has a nonportable media reference: ${asset.name}`,
      );
    result.push({ id: asset.id, source, name });
  }
  return result;
}
// Only unlink the inode created by this operation; never erase a raced-in replacement.
export async function ownedFiles() {
  const files = new Map<string, { dev: number; ino: number }>();
  const directories = new Map<string, { dev: number; ino: number }>();
  return {
    async track(path: string, identity?: { dev: number; ino: number }) {
      const info = identity ?? (await lstat(path));
      files.set(path, { dev: info.dev, ino: info.ino });
    },
    async directory(path: string) {
      await mkdir(path);
      const info = await lstat(path);
      directories.set(path, { dev: info.dev, ino: info.ino });
    },
    async cleanup() {
      for (const [path, identity] of [...files].reverse()) {
        const info = await lstat(path).catch(() => null);
        if (info?.dev === identity.dev && info.ino === identity.ino)
          await unlink(path);
      }
      for (const [directory, identity] of [...directories].reverse()) {
        const info = await lstat(directory).catch(() => null);
        if (info?.dev === identity.dev && info.ino === identity.ino)
          await rmdir(directory);
      }
    },
  };
}
export async function publishFile(source: string, destination: string) {
  const handle = await open(destination, "wx");
  const identity = await handle.stat();
  try {
    await pipeline(
      createReadStream(source),
      createWriteStream(destination, { fd: handle.fd, autoClose: false }),
    );
    await handle.sync();
  } catch (error) {
    await handle.close();
    const info = await lstat(destination).catch(() => null);
    if (info?.dev === identity.dev && info.ino === identity.ino)
      await unlink(destination);
    throw error;
  }
  await handle.close();
  return { dev: identity.dev, ino: identity.ino };
}
