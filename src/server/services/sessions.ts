import {
  access,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { openStore, type Store } from "../database/store.js";
import { mediaService } from "./media.js";
import { onlineAudioService, type OnlineAudioOptions } from "./online-audio.js";
import { onlineAudioBusy } from "../../shared/online-audio.js";
import type {
  SessionAction,
  SessionInfo,
  SessionStatus,
} from "../../shared/sessions.js";
import { lockSession } from "./session-locks.js";
import {
  existingDirectory,
  ownedFiles,
  publishFile,
  readManifest,
  regularFile,
  validateDatabase,
  validateMedia,
  within,
} from "./session-files.js";

export interface SessionContext {
  store: Store;
  media: Awaited<ReturnType<typeof mediaService>>;
  onlineAudio: Awaited<ReturnType<typeof onlineAudioService>>;
  path: string;
  mediaPath: string;
  info: SessionInfo;
}
interface OwnedContext extends SessionContext {
  release: () => Promise<void>;
  identity: { path: string; dev: number; ino: number }[];
}
function failure(message: string, statusCode = 409): never {
  throw Object.assign(new Error(message), { statusCode });
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export async function createSessionManager(options: {
  dataDir: string;
  mediaDir?: string;
  sessionsRoot?: string;
  onlineAudio?: OnlineAudioOptions;
  logger: Pick<FastifyBaseLogger, "error">;
}) {
  const defaultPath = resolve(options.dataDir),
    defaultMedia = resolve(options.mediaDir ?? join(defaultPath, "media"));
  let active: OwnedContext | null = null,
    generation = randomUUID(),
    error: string | null = null;
  let operation: SessionStatus["operation"] = null,
    work: Promise<void> | undefined,
    closed = false;
  let changed = () => {},
    beforeClose: ((context: SessionContext) => Promise<void>) | undefined;
  const status = (): SessionStatus => ({
    generation,
    active: active ? { ...active.info } : null,
    error,
    busy: operation?.status === "running",
    operation: operation ? { ...operation } : null,
  });
  function notify() {
    try {
      changed();
    } catch (err) {
      options.logger.error({ err }, "Session notification failed");
    }
  }
  async function identities(paths: string[]) {
    return Promise.all(
      paths.map(async (path) => {
        const info = await lstat(path);
        return { path, dev: info.dev, ino: info.ino };
      }),
    );
  }
  async function check(context: OwnedContext) {
    for (const identity of context.identity) {
      const info = await lstat(identity.path);
      if (
        info.isSymbolicLink() ||
        info.dev !== identity.dev ||
        info.ino !== identity.ino
      )
        throw new Error(
          "Session storage moved or was replaced. Restore the original storage and Retry, or explicitly close without saving.",
        );
      await access(identity.path, constants.R_OK | constants.W_OK);
    }
    context.store.checkpoint();
  }
  async function dispose(context: OwnedContext, force = false) {
    let first: unknown;
    try {
      await beforeClose?.(context);
    } catch (err) {
      first = err;
    }
    try {
      await context.onlineAudio.close();
    } catch (err) {
      first ??= err;
    }
    try {
      await context.media.close();
    } catch (err) {
      first ??= err;
    }
    try {
      context.store.close();
    } catch (err) {
      first ??= err;
    }
    try {
      await context.release();
    } catch (err) {
      first ??= err;
    }
    if (first && !force) throw first;
  }
  async function openContext(
    path: string,
    isDefault = false,
    initialize = false,
  ): Promise<OwnedContext> {
    if (initialize) {
      // First installation may create one leaf, never a missing mount/parent tree.
      await mkdir(path).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      });
    }
    const canonical = await existingDirectory(path);
    const manifest = isDefault ? null : await readManifest(canonical);
    let mediaPath = isDefault ? defaultMedia : join(canonical, "media");
    let release: (() => Promise<void>) | undefined,
      store: Store | undefined,
      media: SessionContext["media"] | undefined;
    try {
      release = await lockSession(canonical);
      const dbExists = await lstat(join(canonical, "simple-vtt.sqlite")).then(
        () => true,
        (err) => {
          if (err.code === "ENOENT") return false;
          throw err;
        },
      );
      if (!initialize && !dbExists)
        throw new Error(
          "Session database is missing. Restore the complete session folder.",
        );
      if (dbExists) {
        if (isDefault) {
          for (const name of [
            "simple-vtt.sqlite",
            "simple-vtt.sqlite-wal",
            "simple-vtt.sqlite-shm",
          ])
            try {
              await regularFile(canonical, name);
            } catch (err) {
              if (
                name !== "simple-vtt.sqlite" &&
                (err as NodeJS.ErrnoException).code === "ENOENT"
              )
                continue;
              throw err;
            }
        } else await validateDatabase(canonical);
      }
      // Legacy installations may not have created their owned media leaf yet.
      // Never synthesize an external/missing mount tree.
      if (
        initialize ||
        (isDefault && resolve(mediaPath) === join(defaultPath, "media"))
      )
        await mkdir(mediaPath).catch((err) => {
          if (err.code !== "EEXIST") throw err;
        });
      if ((await lstat(mediaPath)).isSymbolicLink())
        throw new Error("Session media directory cannot be a symbolic link");
      mediaPath = await existingDirectory(mediaPath);
      store = openStore(canonical, { existing: dbExists });
      store.validate();
      if (!isDefault) await validateMedia(mediaPath, store, true);
      media = await mediaService(mediaPath, store, options.logger, {
        create: false,
        portable: !isDefault,
      });
      const imports = join(canonical, ".online-imports");
      const importInfo = await lstat(imports).catch(() => null);
      if (importInfo?.isSymbolicLink())
        throw new Error("Unsafe online import directory");
      const onlineAudio = await onlineAudioService(
        canonical,
        media,
        options.onlineAudio,
      );
      store.present(null);
      return {
        store,
        media,
        onlineAudio,
        path: canonical,
        mediaPath,
        release,
        identity: await identities([
          canonical,
          join(canonical, "simple-vtt.sqlite"),
          mediaPath,
        ]),
        info: {
          id: manifest?.id ?? "default",
          name: manifest?.name ?? "Default Session",
          path: canonical,
          isDefault,
          externalMedia: isDefault && !within(canonical, mediaPath),
        },
      };
    } catch (err) {
      await media?.close().catch(() => undefined);
      try {
        store?.close();
      } catch {}
      await release?.().catch(() => undefined);
      throw err;
    }
  }
  async function swap(next: OwnedContext) {
    const old = active;
    if (old) {
      try {
        await dispose(old);
      } catch (err) {
        active = null;
        generation = randomUUID();
        error = `Previous session could not be released cleanly: ${message(err)}`;
        notify();
        throw err;
      }
    }
    active = next;
    generation = randomUUID();
    error = null;
    notify();
  }
  async function saveAs(path?: string) {
    if (!active) failure("Open a session before saving");
    if (!path) failure("Choose an empty existing destination folder", 400);
    const source = active;
    await check(source);
    const target = await existingDirectory(path);
    if (
      within(source.path, target) ||
      within(source.mediaPath, target) ||
      within(target, source.path) ||
      within(target, source.mediaPath)
    )
      failure(
        "Save As destination must be independent of the active session and media folders",
      );
    if ((await readdir(target)).length)
      failure("Save As requires an empty folder, including hidden files");
    const release = await lockSession(target);
    const stage = join(target, `.session-stage-${randomUUID()}`);
    const owned = await ownedFiles();
    const staging = await ownedFiles();
    let next: OwnedContext | undefined;
    try {
      if ((await readdir(target)).some((name) => name !== ".simple-vtt.lock"))
        failure("Destination changed; choose an empty folder");
      await staging.directory(stage);
      await staging.directory(join(stage, "media"));
      const files = await validateMedia(source.mediaPath, source.store);
      await source.store.snapshot(join(stage, "simple-vtt.sqlite"));
      await staging.track(join(stage, "simple-vtt.sqlite"));
      const snapshot = openStore(stage, { existing: true });
      try {
        for (const [index, file] of files.entries()) {
          await staging.track(
            join(stage, "media", file.name),
            await publishFile(file.source, join(stage, "media", file.name)),
          );
          snapshot.setAssetPath(file.id, file.name);
          if (operation) {
            operation.message = `Copying media ${index + 1} of ${files.length}`;
            operation.progress = Math.round(
              ((index + 1) / Math.max(files.length, 1)) * 85,
            );
            notify();
          }
        }
        snapshot.present(null);
        snapshot.validate();
      } finally {
        snapshot.close();
      }
      await writeFile(
        join(stage, "session.json"),
        JSON.stringify({
          application: "SimpleVTT",
          version: 1,
          id: randomUUID(),
          name: basename(target).slice(0, 120),
        }),
        { flag: "wx" },
      );
      await staging.track(join(stage, "session.json"));
      if (
        (await readdir(target)).some(
          (name) => name !== ".simple-vtt.lock" && name !== basename(stage),
        )
      )
        failure(
          "Destination acquired unrelated files during copy; nothing was overwritten",
        );
      await owned.directory(join(target, "media"));
      for (const file of files) {
        const dest = join(target, "media", file.name);
        await owned.track(
          dest,
          await publishFile(join(stage, "media", file.name), dest),
        );
      }
      await owned.track(
        join(target, "simple-vtt.sqlite"),
        await publishFile(
          join(stage, "simple-vtt.sqlite"),
          join(target, "simple-vtt.sqlite"),
        ),
      );
      const expected = new Set([
        ".simple-vtt.lock",
        basename(stage),
        "media",
        "simple-vtt.sqlite",
      ]);
      if ((await readdir(target)).some((name) => !expected.has(name)))
        failure("Destination changed during publishing; save was cancelled");
      await owned.track(
        join(target, "session.json"),
        await publishFile(
          join(stage, "session.json"),
          join(target, "session.json"),
        ),
      );
      await staging.cleanup();
      await release();
      next = await openContext(target);
      await swap(next);
      next = undefined;
    } catch (err) {
      if (next) await dispose(next, true);
      let incomplete = false;
      if (active === source)
        await owned.cleanup().catch((cleanup) => {
          incomplete = true;
          options.logger.error(
            { err: cleanup, target },
            "Incomplete session destination could not be cleaned",
          );
        });
      await staging.cleanup().catch((cleanup) => {
        incomplete = true;
        options.logger.error(
          { err: cleanup, target },
          "Private session staging could not be cleaned",
        );
      });
      if (incomplete)
        throw new Error(
          `${message(err)} Incomplete destination remains at ${target}; inspect it before retrying.`,
        );
      throw err;
    } finally {
      await staging
        .cleanup()
        .catch((err) =>
          options.logger.error(
            { err, target },
            "Private session staging remains; inspect the destination before retrying",
          ),
        );
      await release().catch(() => undefined);
    }
  }
  async function clearDefault() {
    if (!active?.info.isDefault) failure("Only Default Session can be cleared");
    const context = active;
    await check(context);
    const staged: { from: string; to: string }[] = [];
    let clearError: unknown;
    // Release streams before touching media (required on Windows). Reopen the
    // context even on rollback so requests never reuse a retired stream owner.
    await beforeClose?.(context);
    try {
      if (!context.info.externalMedia)
        for (const asset of context.store.listAssets()) {
          const file = context.store.getAsset(asset.id);
          let from: string;
          try {
            from = await regularFile(context.mediaPath, file.relativePath);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw err;
          }
          const to = join(context.mediaPath, `.${randomUUID()}.cleared`);
          await rename(from, to);
          staged.push({ from, to });
        }
      context.store.clear();
    } catch (err) {
      clearError = err;
      for (const file of staged.reverse())
        await publishFile(file.to, file.from)
          .then(() => rm(file.to))
          .catch((restore) => {
            options.logger.error(
              { err: restore, file },
              "Could not restore staged media",
            );
            clearError = new Error(
              `${message(err)}; media rollback failed at ${file.to}`,
            );
          });
    }
    if (!clearError)
      for (const file of staged)
        await rm(file.to).catch((err) => {
          options.logger.error(
            { err, file },
            "Cleared media remains in private staging",
          );
          clearError = new Error(
            `Session records were cleared, but private staged media could not be removed: ${file.to}`,
          );
        });
    active = null;
    generation = randomUUID();
    notify();
    try {
      await dispose(context);
      active = await openContext(defaultPath, true);
      error = null;
      notify();
    } catch (err) {
      error = `Default Session needs recovery: ${message(err)}`;
      notify();
      throw err;
    }
    if (clearError) throw clearError;
  }
  async function run(action: SessionAction, path?: string, force = false) {
    if (active && action !== "retry" && !(action === "close" && force)) {
      try {
        await check(active);
      } catch (err) {
        error = `Saving stopped: ${message(err)}`;
        notify();
        throw err;
      }
    }
    if (action === "save-as") return saveAs(path);
    if (action === "clear") return clearDefault();
    if (action === "retry") {
      if (active) {
        await check(active);
        active.store.validate();
        if (!active.info.isDefault)
          await validateMedia(active.mediaPath, active.store, true);
        error = null;
        notify();
      } else await swap(await openContext(defaultPath, true));
      return;
    }
    if (action === "close") {
      if (active?.info.isDefault) return;
      const old = active;
      active = null;
      if (old) {
        try {
          await dispose(old, force);
        } finally {
          generation = randomUUID();
          notify();
        }
      }
      try {
        await swap(await openContext(defaultPath, true));
      } catch (err) {
        error = `Default Session is unavailable: ${message(err)}`;
        notify();
        throw err;
      }
      return;
    }
    if (!path) failure("Choose an existing session folder", 400);
    const canonical = await existingDirectory(path);
    if (active?.path === canonical) return;
    const isDefault =
      canonical === (await realpath(defaultPath).catch(() => null));
    const next = await openContext(canonical, isDefault);
    try {
      await swap(next);
    } catch (err) {
      await dispose(next, true);
      throw err;
    }
  }
  try {
    const exists = await lstat(defaultPath).then(
      () => true,
      (err) => {
        if (err.code === "ENOENT") return false;
        throw err;
      },
    );
    const missingDatabase =
      exists &&
      !(await lstat(join(defaultPath, "simple-vtt.sqlite")).catch(() => null));
    if (missingDatabase && (await readdir(defaultPath)).length)
      throw new Error(
        "Default Session database is missing from a nonempty folder. Restore the original database; replacement data was not created.",
      );
    active = await openContext(defaultPath, true, !exists || missingDatabase);
  } catch (err) {
    error = `Default Session is unavailable: ${message(err)}`;
    options.logger.error({ err }, "Default Session could not be opened");
  }
  return {
    peek: (): SessionContext | null => active,
    require(): SessionContext {
      return (
        active ??
        failure(
          "No active session. Open a session or retry Default Session.",
          503,
        )
      );
    },
    status,
    markStorageError(err: unknown) {
      error = `Saving stopped: ${message(err)}`;
      notify();
    },
    setOnChange(callback: () => void) {
      changed = callback;
    },
    setBeforeClose(callback: (context: SessionContext) => Promise<void>) {
      beforeClose = callback;
    },
    start(action: SessionAction, path?: string, force = false): SessionStatus {
      if (closed) failure("Server is shutting down", 503);
      if (status().busy) failure("A session operation is already running");
      if (active?.media.busy())
        failure("Finish the media upload or scan before changing sessions");
      if (onlineAudioBusy(active?.onlineAudio.status() ?? null))
        failure("Finish or cancel the audio import before changing sessions");
      if (
        error &&
        active &&
        action !== "retry" &&
        !(action === "close" && force)
      )
        failure(
          "Session storage is unavailable. Retry recovery, or explicitly close without saving.",
        );
      operation = {
        id: randomUUID(),
        action,
        status: "running",
        message: "Preparing session…",
        progress: null,
        error: null,
      };
      notify();
      work = Promise.resolve()
        .then(() => run(action, path, force))
        .then(
          () => {
            operation = {
              ...operation!,
              status: "complete",
              message: "Session ready",
              progress: 100,
            };
          },
          (err) => {
            operation = {
              ...operation!,
              status: "failed",
              message: "Session operation failed",
              error: message(err),
              progress: null,
            };
            options.logger.error({ err, action }, "Session operation failed");
          },
        )
        .finally(notify);
      return status();
    },
    async checkStorage() {
      const context = active;
      const checkedGeneration = generation;
      if (!context) failure("No active session", 503);
      try {
        await check(context);
      } catch (err) {
        // Status polls can overlap a transition. Only that transition owns
        // recovery while busy; an outgoing context cannot poison the new one.
        if (
          active !== context ||
          generation !== checkedGeneration ||
          status().busy
        )
          return;
        error = `Saving stopped: ${message(err)}`;
        notify();
        throw Object.assign(new Error(error), { statusCode: 503 });
      }
    },
    async shutdown() {
      closed = true;
      await work;
      const context = active;
      active = null;
      if (context) await dispose(context, true);
    },
  };
}
export type SessionManager = Awaited<ReturnType<typeof createSessionManager>>;
