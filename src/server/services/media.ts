import {
  mkdir,
  realpath,
  readdir,
  stat,
  lstat,
  open,
  unlink,
  rename,
  copyFile,
} from "node:fs/promises";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, isAbsolute, join, relative, sep, win32 } from "node:path";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import type { FastifyBaseLogger } from "fastify";
import type { Asset } from "../../shared/contracts.js";
import { notFound, type Store } from "../database/store.js";

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const audioTypes = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/ogg; codecs=opus",
  "audio/opus",
  "audio/flac",
  "audio/x-m4a",
  "audio/mp4",
]);
const audioCategories = new Set<Asset["category"]>([
  "music",
  "ambience",
  "effect",
]);
export const MAX_IMAGE_SIZE = 32 * 1024 * 1024;
export const MAX_FILE_SIZE = 256 * 1024 * 1024;
function invalid(message: string, statusCode = 415): never {
  throw Object.assign(new Error(message), { statusCode });
}
async function identify(path: string) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return await fileTypeFromBuffer(buffer.subarray(0, bytesRead)).catch(
      () => undefined,
    );
  } finally {
    await handle.close();
  }
}
export async function mediaService(
  directory: string,
  store: Store,
  logger: Pick<FastifyBaseLogger, "error">,
  options: { create?: boolean; portable?: boolean } = {},
) {
  if (options.create !== false) await mkdir(directory, { recursive: true });
  const root = await realpath(directory);
  // Scans must not re-index a file while deletion or upload changes its metadata.
  let pending = Promise.resolve();
  let pendingCount = 0;
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    pendingCount++;
    const result = pending.then(operation).finally(() => {
      pendingCount--;
    });
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  // Exclusive copy/unlink also works on filesystems without hard links. Keep
  // the original until the managed copy is complete, and remove that copy if
  // the source cannot be moved (for example, from a read-only scanned folder).
  async function moveExclusive(source: string, destination: string) {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    try {
      await unlink(source);
    } catch (error) {
      try {
        await unlink(destination);
      } catch (cleanupError) {
        logger.error(
          { err: cleanupError, source, destination },
          "Could not remove an incomplete managed media copy",
        );
      }
      throw error;
    }
  }
  async function deletionPath(relativePath: string): Promise<string | null> {
    const parts = relativePath.split(/[\\/]/);
    if (
      isAbsolute(relativePath) ||
      win32.isAbsolute(relativePath) ||
      (sep !== "\\" && relativePath.includes("\\")) ||
      parts.some((part) => !part || part === ".." || part === ".")
    )
      invalid("Unsafe media path", 400);
    let full = root;
    for (const [index, part] of parts.entries()) {
      full = join(full, part);
      let info;
      try {
        info = await lstat(full);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      if (
        info.isSymbolicLink() ||
        (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())
      )
        invalid("Unsafe media path", 400);
    }
    return full;
  }
  async function safePath(relativePath: string) {
    if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes(".."))
      return notFound("Media not found");
    let full: string;
    try {
      full = await realpath(join(root, relativePath));
    } catch {
      return notFound("Media not found");
    }
    const inside = relative(root, full);
    if (
      !inside ||
      inside === ".." ||
      inside.startsWith(`..${sep}`) ||
      isAbsolute(inside)
    )
      return notFound("Media not found");
    if (!(await stat(full)).isFile()) return notFound("Media not found");
    return full;
  }
  return {
    async close() {
      await pending;
    },
    async idle() {
      await pending;
    },
    busy: () => pendingCount > 0,
    async file(relativePath: string) {
      const path = await safePath(relativePath);
      return {
        size: (await stat(path)).size,
        stream: (range?: { start: number; end: number }) =>
          createReadStream(path, range),
      };
    },
    delete(id: string) {
      return mutate(async () => {
        const asset = store.getAsset(id);
        const path = await deletionPath(asset.relativePath);
        // Hidden files are excluded by scan; only the private staging path survives
        // if final cleanup fails after the database commit.
        const staged = path ? join(root, `.${randomUUID()}.deleted`) : null;
        if (path && staged) await rename(path, staged);
        try {
          store.deleteAsset(id);
        } catch (error) {
          if (path && staged) {
            try {
              await rename(staged, path);
            } catch (restoreError) {
              logger.error(
                { err: restoreError, assetId: id, staged },
                "Could not restore media after failed deletion",
              );
            }
          }
          throw error;
        }
        if (staged) {
          try {
            await unlink(staged);
          } catch (error) {
            logger.error(
              { err: error, assetId: id, staged },
              "Deleted media remains in private staging storage; cleanup failed",
            );
          }
        }
      });
    },
    upload(
      source: Readable & { truncated?: boolean },
      filename: string,
      category: Asset["category"],
    ) {
      return mutate(async () => {
        const id = randomUUID();
        let path = join(root, `.${id}.upload`);
        const max = audioCategories.has(category)
          ? MAX_FILE_SIZE
          : MAX_IMAGE_SIZE;
        let size = 0;
        const limit = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length;
            if (size > max)
              callback(
                Object.assign(
                  new Error(`File exceeds ${max / 1024 / 1024} MiB limit`),
                  { statusCode: 413 },
                ),
              );
            else callback(null, chunk);
          },
        });
        try {
          await pipeline(
            source,
            limit,
            createWriteStream(path, { flags: "wx" }),
          );
          if (source.truncated) invalid("File exceeds 256 MiB limit", 413);
          const type = await identify(path);
          if (
            !type ||
            (!imageTypes.has(type.mime) && !audioTypes.has(type.mime))
          )
            invalid(
              "Choose a PNG, JPEG, WebP, GIF, MP3, WAV, Ogg, FLAC, or M4A file",
            );
          if (audioCategories.has(category) !== audioTypes.has(type.mime))
            invalid(
              "The selected category does not match this file's media type",
            );
          const relativePath = `${id}.${type.ext}`;
          const destination = join(root, relativePath);
          await moveExclusive(path, destination);
          path = destination;
          return store.addAsset({
            name:
              basename(filename.replaceAll("\\", "/")).slice(0, 120) || "Media",
            id,
            category,
            relativePath,
            mimeType: type.mime,
          });
        } catch (error) {
          await unlink(path).catch(() => undefined);
          throw error;
        }
      });
    },
    scan() {
      return mutate(async () => {
        let indexed = 0,
          skipped = 0;
        const existingPaths = new Map(
          store.listAssets().map((asset) => {
            const record = store.getAsset(asset.id);
            return [record.relativePath, record] as const;
          }),
        );
        async function walk(directory: string) {
          for (const entry of await readdir(directory, {
            withFileTypes: true,
          })) {
            const full = join(directory, entry.name);
            if (entry.isSymbolicLink() || entry.name.startsWith(".")) {
              skipped++;
              continue;
            }
            if (entry.isDirectory()) {
              await walk(full);
              continue;
            }
            if (!entry.isFile()) {
              skipped++;
              continue;
            }
            try {
              const relativePath = relative(root, full);
              const safe = await safePath(relativePath);
              const type = await identify(safe);
              if (
                !type ||
                (!imageTypes.has(type.mime) && !audioTypes.has(type.mime))
              ) {
                skipped++;
                continue;
              }
              const audio = audioTypes.has(type.mime);
              if (
                (await stat(safe)).size >
                (audio ? MAX_FILE_SIZE : MAX_IMAGE_SIZE)
              ) {
                skipped++;
                continue;
              }
              const folders = relativePath
                .split(sep)
                .slice(0, -1)
                .map((part) => part.toLowerCase());
              const category = audio
                ? folders.some((part) => ["ambient", "ambience"].includes(part))
                  ? "ambience"
                  : folders.some((part) =>
                        ["effect", "effects", "sfx"].includes(part),
                      )
                    ? "effect"
                    : "music"
                : /backgrounds?/i.test(relativePath)
                  ? "background"
                  : /sprites?|characters?/i.test(relativePath)
                    ? "sprite"
                    : "image";
              if (options.portable) {
                const existing = existingPaths.get(relativePath);
                const id = existing?.id ?? randomUUID();
                const managed = `${id}.${type.ext}`;
                const destination = join(root, managed);
                const moved = relativePath !== managed;
                if (moved) await moveExclusive(safe, destination);
                try {
                  if (existing) {
                    if (moved) store.setAssetPath(id, managed);
                  } else {
                    store.addAsset({
                      id,
                      name: entry.name.slice(0, 120),
                      category,
                      relativePath: managed,
                      mimeType: type.mime,
                    });
                  }
                } catch (error) {
                  if (moved) {
                    try {
                      await moveExclusive(destination, safe);
                    } catch (restoreError) {
                      logger.error(
                        { err: restoreError, source: safe, destination },
                        "Could not restore scanned media after a database failure",
                      );
                    }
                  }
                  throw error;
                }
              } else {
                store.addAsset({
                  name: entry.name.slice(0, 120),
                  category,
                  relativePath,
                  mimeType: type.mime,
                });
              }
              indexed++;
            } catch (error) {
              const code = (error as NodeJS.ErrnoException).code ?? "";
              if (
                options.portable ||
                /^(SQLITE_|ENOSPC|EIO|EROFS|ENODEV|ESTALE|EACCES|EPERM|EDQUOT)/.test(
                  code,
                )
              )
                throw error;
              skipped++;
            }
          }
        }
        await walk(root);
        return { indexed, skipped };
      });
    },
  };
}
