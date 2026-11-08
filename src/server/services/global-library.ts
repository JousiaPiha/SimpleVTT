import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { lstat, mkdir, readdir, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileTypeFromFile } from "file-type";
import type { FastifyBaseLogger } from "fastify";
import { assetSchema, type Asset } from "../../shared/contracts.js";
import { isAudioAsset } from "../../shared/audio.js";
import { type SoundboardEntry } from "../../shared/soundboard.js";
import { openGlobalLibraryStore, type LibraryRecord } from "../database/global-library.js";
import { MAX_FILE_SIZE, MAX_IMAGE_SIZE } from "./media.js";
import { existingDirectory, ownedFiles, publishFile, regularFile, within } from "./session-files.js";
import { lockSession } from "./session-locks.js";
import type { SessionContext } from "./sessions.js";

function fail(message: string, statusCode = 503): never {
  throw Object.assign(new Error(message), { statusCode });
}
async function digestFile(path: string, limit = MAX_FILE_SIZE) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > limit) fail(`Media exceeds ${limit / 1024 / 1024} MiB limit`, 413);
    hash.update(chunk);
  }
  return hash.digest("hex");
}
async function inspect(root: string, record: Asset & { relativePath: string }) {
  const path = await regularFile(root, record.relativePath);
  const type = await fileTypeFromFile(path);
  if (!type || type.mime !== record.mimeType || !["png", "jpg", "webp", "gif", "mp3", "wav", "ogg", "opus", "flac", "m4a", "mp4"].includes(type.ext))
    fail(`Missing or unsupported media: ${record.name}`, 400);
  const digest = await digestFile(path, isAudioAsset(record) ? MAX_FILE_SIZE : MAX_IMAGE_SIZE);
  return { path, digest, extension: type.ext };
}

interface LibraryContext {
  root: string;
  media: string;
  store: ReturnType<typeof openGlobalLibraryStore>;
  release: () => Promise<void>;
  identities: { path: string; dev: number; ino: number }[];
}

export function createGlobalLibrary(options: {
  directory: string;
  create: boolean;
  logger: Pick<FastifyBaseLogger, "error">;
}) {
  const directory = resolve(options.directory);
  let context: LibraryContext | undefined;
  let opened = false;
  let closed = false;
  let pending = Promise.resolve();
  const streams = new Map<string, Set<ReadStream>>();
  async function closeStreams(id?: string) {
    const selected = id ? [...(streams.get(id) ?? [])] : [...streams.values()].flatMap((set) => [...set]);
    await Promise.all(selected.map((stream) => new Promise<void>((done) => {
      if (stream.closed) return done();
      stream.once("close", done);
      stream.destroy();
    })));
  }
  async function dispose() {
    const previous = context;
    context = undefined;
    await closeStreams();
    if (previous) {
      try { previous.store.close(); }
      finally { await previous.release(); }
    }
  }
  async function open(session: SessionContext) {
    if (closed) fail("Global library is closed");
    if (context) {
      try {
        if (await realpath(directory) !== context.root) throw new Error("Global library moved");
        for (const identity of context.identities) {
          const info = await lstat(identity.path);
          if (info.isSymbolicLink() || info.dev !== identity.dev || info.ino !== identity.ino) throw new Error("Global library storage changed");
        }
      } catch (error) {
        await dispose().catch((err) => options.logger.error({ err }, "Could not close unavailable global library"));
        throw error;
      }
    }
    if (!context) {
      if (options.create && !opened) await mkdir(directory).catch((error) => { if (error.code !== "EEXIST") throw error; });
      if ((await lstat(directory)).isSymbolicLink()) throw new Error("Global library cannot be a symbolic link");
    }
    const root = context?.root ?? await existingDirectory(directory);
    for (const path of [session.path, session.mediaPath])
      if (within(root, path) || within(path, root)) fail("Global library must be outside session and media folders", 400);
    if (context) return context;
    const release = await lockSession(root);
    let store: LibraryContext["store"] | undefined;
    try {
      const dbExists = await lstat(join(root, "library.sqlite")).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
      if (!dbExists && (opened || (await readdir(root)).some((name) => name !== ".simple-vtt.lock")))
        throw new Error("Choose an empty global library folder or restore its existing library.sqlite");
      if (dbExists) {
        for (const file of ["library.sqlite", "library.sqlite-wal", "library.sqlite-shm"]) {
          await regularFile(root, file).catch((error) => { if (file === "library.sqlite" || error.code !== "ENOENT") throw error; });
        }
      }
      const media = join(root, "media");
      if (!dbExists) await mkdir(media);
      if ((await lstat(media)).isSymbolicLink()) throw new Error("Global media cannot be a symbolic link");
      await existingDirectory(media);
      store = openGlobalLibraryStore(root);
      const identities = await Promise.all([root, media, join(root, "library.sqlite")].map(async (path) => {
        const info = await lstat(path);
        return { path, dev: info.dev, ino: info.ino };
      }));
      opened = true;
      context = { root, media, store, release, identities };
      return context;
    } catch (error) {
      store?.close();
      await release();
      throw error;
    }
  }
  function run<T>(session: SessionContext, action: (library: LibraryContext) => Promise<T> | T): Promise<T> {
    const result = pending.then(async () => {
      try { return await action(await open(session)); }
      catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        // Global storage errors must not put the independent session into recovery mode.
        fail(`Global library unavailable: ${error instanceof Error ? error.message : "check its folder and retry"}`);
      }
    });
    pending = result.then(() => {}, () => {});
    return result;
  }
  async function findSessionCopy(session: SessionContext, record: LibraryRecord) {
    const candidates = session.store.listAssets().filter((asset) => asset.category === record.category && asset.mimeType === record.mimeType);
    for (const asset of candidates) {
      const local = session.store.getAsset(asset.id);
      // An unrelated missing local file does not prevent copying a usable global track.
      const path = await regularFile(session.mediaPath, local.relativePath).catch(() => null);
      if (path && await digestFile(path) === record.digest) return asset;
    }
    return null;
  }
  const requireAudio = (record: Asset) => { if (!isAudioAsset(record)) fail("Choose a music, ambience or sound effect track", 400); };
  async function deleteRecord(library: LibraryContext, id: string) {
    const record = library.store.getAsset(id);
    await closeStreams(id);
    const path = await regularFile(library.media, record.relativePath).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    const staged = path ? join(library.media, `.${record.id}.deleted`) : null;
    if (path && staged) await rename(path, staged);
    try { library.store.deleteAsset(id); }
    catch (error) { if (path && staged) await rename(staged, path); throw error; }
    if (staged) await unlink(staged).catch((err) => options.logger.error({ err }, "Deleted global media remains in private staging"));
  }
  return {
    closeStreams,
    async close() {
      closed = true;
      await pending;
      await dispose();
    },
    list: (session: SessionContext) => run(session, (library) => ({ assets: library.store.listAssets().filter(isAudioAsset) })),
    promote: (session: SessionContext, id: string) => run(session, (library) => session.media.exclusive(async () => {
      const audio = session.store.getAsset(id);
      requireAudio(audio);
      const files = await ownedFiles();
      const records: LibraryRecord[] = [];
      const prepare = async (source: typeof audio) => {
        const inspected = await inspect(session.mediaPath, source);
        const existing = library.store.find(source.category, inspected.digest);
        if (existing) {
          const checked = await inspect(library.media, existing);
          if (checked.digest !== existing.digest) fail("Global media changed; restore the original file before retrying");
          return { record: existing, reused: true };
        }
        const newId = `${source.category}-${inspected.digest}`;
        const relativePath = `${newId}.${inspected.extension}`;
        const destination = join(library.media, relativePath);
        await files.track(destination, await publishFile(inspected.path, destination));
        if (await digestFile(destination) !== inspected.digest) fail("Source media changed during copy; retry");
        const record = { ...assetSchema.parse(source), id: newId, relativePath, digest: inspected.digest };
        records.push(record);
        return { record, reused: false };
      };
      try {
        const result = await prepare(audio);
        if (result.reused) return { asset: assetSchema.parse(result.record), reused: true };
        const settings = session.store.listSoundboard().find((entry) => entry.assetId === id);
        let sound: SoundboardEntry | undefined;
        if (settings) {
          const customIconAssetId = settings.customIconAssetId
            ? (await prepare(session.store.getAsset(settings.customIconAssetId))).record.id : null;
          sound = { ...settings, assetId: result.record.id, customIconAssetId };
        }
        library.store.importAssets(records, sound);
        return { asset: assetSchema.parse(result.record), reused: false };
      } catch (error) { await files.cleanup(); throw error; }
    })),
    addToSession: (session: SessionContext, id: string) => run(session, (library) => session.media.exclusive(async () => {
      const audio = library.store.getAsset(id);
      requireAudio(audio);
      const files = await ownedFiles();
      const records: (Asset & { relativePath: string })[] = [];
      const prepare = async (record: LibraryRecord) => {
        const inspected = await inspect(library.media, record);
        if (inspected.digest !== record.digest) fail("Global media changed; restore the original file before retrying");
        const existing = await findSessionCopy(session, record);
        if (existing) return { asset: existing, reused: true };
        // Re-imports after deletion need fresh IDs: browser caches and in-flight
        // playback requests may still refer to the deleted local asset.
        const localId = randomUUID();
        const relativePath = `${localId}.${inspected.extension}`;
        const destination = join(session.mediaPath, relativePath);
        await files.track(destination, await publishFile(inspected.path, destination));
        if (await digestFile(destination) !== record.digest) fail("Global media changed during copy; retry");
        const local = { ...assetSchema.parse(record), id: localId, relativePath };
        records.push(local);
        return { asset: assetSchema.parse(local), reused: false };
      };
      try {
        const result = await prepare(audio);
        if (result.reused) return result;
        const settings = library.store.soundboard(id);
        let sound: SoundboardEntry | undefined;
        if (settings) {
          const customIconAssetId = settings.customIconAssetId
            ? (await prepare(library.store.getAsset(settings.customIconAssetId))).asset.id : null;
          sound = { ...settings, assetId: result.asset.id, customIconAssetId };
        }
        session.store.importAssets(records, sound);
        return result;
      } catch (error) { await files.cleanup(); throw error; }
    })),
    rename: (session: SessionContext, id: string, name: string) => run(session, (library) => {
      requireAudio(library.store.getAsset(id));
      return library.store.rename(id, name);
    }),
    delete: (session: SessionContext, id: string) => run(session, async (library) => {
      requireAudio(library.store.getAsset(id));
      const icon = library.store.soundboard(id)?.customIconAssetId;
      await deleteRecord(library, id);
      if (icon && !library.store.iconInUse(icon)) await deleteRecord(library, icon);
    }),
    file: (session: SessionContext, id: string) => run(session, async (library) => {
      const record = library.store.getAsset(id);
      const path = await regularFile(library.media, record.relativePath);
      return {
        mimeType: record.mimeType,
        size: (await lstat(path)).size,
        stream(range?: { start: number; end: number }) {
          const stream = createReadStream(path, range);
          const entries = streams.get(id) ?? new Set<ReadStream>();
          streams.set(id, entries);
          entries.add(stream);
          stream.once("close", () => { entries.delete(stream); if (!entries.size) streams.delete(id); });
          return stream;
        },
      };
    }),
  };
}
