import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  rename,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createSessionManager } from "../src/server/services/sessions.js";
const roots: string[] = [];
const managers: Awaited<ReturnType<typeof createSessionManager>>[] = [];
async function setup(mediaDir?: string) {
  const root = await mkdtemp(join(tmpdir(), "vtt-sessions-"));
  roots.push(root);
  const manager = await createSessionManager({
    dataDir: join(root, "default"),
    mediaDir,
    logger: { error: () => {} },
  });
  managers.push(manager);
  return { root, manager };
}
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.shutdown();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function finish(
  manager: Awaited<ReturnType<typeof createSessionManager>>,
) {
  await expect.poll(() => manager.status().busy).toBe(false);
  return manager.status();
}
test("Save As snapshots every indexed asset, switches autosaves, and leaves source unchanged", async () => {
  const { root, manager } = await setup();
  const original = manager.require();
  const scene = original.store.createScene("Temple");
  original.store.present(scene.id);
  await mkdir(join(original.mediaPath, "nested"));
  await writeFile(
    join(original.mediaPath, "nested", "hero.png"),
    await readFile("tests/fixtures/hero.png"),
  );
  const asset = original.store.addAsset({
    name: "Hero",
    category: "sprite",
    mimeType: "image/png",
    relativePath: "nested/hero.png",
  });
  original.store.createObject(scene.id, { assetId: asset.id });
  const target = join(root, "My session");
  await mkdir(target);
  const before = manager.status().generation;
  expect(manager.start("save-as", target).busy).toBe(true);
  expect(() => manager.start("close")).toThrow();
  expect((await finish(manager)).operation?.status).toBe("complete");
  expect(manager.status().generation).not.toBe(before);
  expect(manager.require().store.liveScene()).toBeNull();
  expect(manager.require().store.listScenes()).toHaveLength(1);
  expect(manager.require().store.getAsset(asset.id).relativePath).toMatch(
    /^[\w-]+\.png$/,
  );
  manager.require().store.createScene("Copy only");
  manager.start("close");
  await finish(manager);
  expect(manager.require().info.isDefault).toBe(true);
  expect(manager.require().store.listScenes()).toHaveLength(1);
  manager.start("open", target);
  await finish(manager);
  expect(manager.require().store.listScenes()).toHaveLength(2);
  expect(manager.require().store.liveScene()).toBeNull();
});
test("refuses nonempty, missing, nested and incomplete destinations without changing session", async () => {
  const { root, manager } = await setup();
  const initial = manager.require();
  const nonempty = join(root, "nonempty");
  await mkdir(nonempty);
  await writeFile(join(nonempty, ".keep"), "keep");
  for (const target of [
    nonempty,
    join(root, "missing"),
    join(initial.path, "nested"),
  ]) {
    if (target.endsWith("nested")) await mkdir(target);
    manager.start("save-as", target);
    expect((await finish(manager)).operation?.status).toBe("failed");
    expect(manager.require()).toBe(initial);
  }
  manager.start("open", nonempty);
  expect((await finish(manager)).operation?.status).toBe("failed");
  expect(await readFile(join(nonempty, ".keep"), "utf8")).toBe("keep");
});
test("rejects newer manifests, broken structured data and escaping media links", async () => {
  const { root, manager } = await setup();
  const target = join(root, "saved");
  await mkdir(target);
  manager.start("save-as", target);
  await finish(manager);
  manager.start("close");
  await finish(manager);
  const manifest = JSON.parse(
    await readFile(join(target, "session.json"), "utf8"),
  );
  await writeFile(
    join(target, "session.json"),
    JSON.stringify({ ...manifest, version: 999 }),
  );
  manager.start("open", target);
  expect((await finish(manager)).operation?.status).toBe("failed");
  await writeFile(join(target, "session.json"), JSON.stringify(manifest));
  const db = new Database(join(target, "simple-vtt.sqlite"));
  db.pragma("foreign_keys = OFF");
  db.prepare(
    "INSERT INTO scene_content(id,scene_id,properties) VALUES('bad','missing','{}')",
  ).run();
  db.close();
  manager.start("open", target);
  expect((await finish(manager)).operation?.status).toBe("failed");
});
test("exclusive ownership rejects live writers and releases named session before default recovery failure", async () => {
  const { root, manager } = await setup();
  const target = join(root, "named");
  await mkdir(target);
  manager.start("save-as", target);
  await finish(manager);
  const other = await setup();
  other.manager.start("open", target);
  expect((await finish(other.manager)).operation?.status).toBe("failed");
  await rename(join(root, "default"), join(root, "moved"));
  manager.start("close");
  expect((await finish(manager)).operation?.status).toBe("failed");
  expect(manager.peek()).toBeNull();
  expect(await readdir(root)).not.toContain("default");
  other.manager.start("open", target);
  expect((await finish(other.manager)).operation?.status).toBe("complete");
});
test("unavailable active storage blocks writes, retries explicitly, and permits forced close", async () => {
  const { root, manager } = await setup();
  const target = join(root, "named");
  await mkdir(target);
  manager.start("save-as", target);
  await finish(manager);
  await rename(target, join(root, "moved"));
  await expect(manager.checkStorage()).rejects.toThrow();
  expect(manager.status().error).toBeTruthy();
  expect(() => manager.start("close")).toThrow();
  manager.start("close", undefined, true);
  await finish(manager);
  expect(manager.require().info.isDefault).toBe(true);
  expect(await readdir(root)).not.toContain("named");
});
test("clearing default preserves unrelated files and removes records", async () => {
  const { manager } = await setup();
  const context = manager.require();
  context.store.createScene("Discard");
  await writeFile(join(context.path, "backup.zip"), "keep");
  await writeFile(join(context.mediaPath, "unindexed.txt"), "keep");
  manager.start("clear");
  expect((await finish(manager)).operation?.status).toBe("complete");
  expect(manager.require().store.listScenes()).toEqual([]);
  expect(await readFile(join(context.path, "backup.zip"), "utf8")).toBe("keep");
  expect(await readFile(join(context.mediaPath, "unindexed.txt"), "utf8")).toBe(
    "keep",
  );
});
test("startup reports corrupt default without replacing its database", async () => {
  const root = await mkdtemp(join(tmpdir(), "vtt-corrupt-"));
  roots.push(root);
  await writeFile(join(root, "simple-vtt.sqlite"), "corrupt");
  const manager = await createSessionManager({
    dataDir: root,
    logger: { error: () => {} },
  });
  managers.push(manager);
  expect(manager.peek()).toBeNull();
  expect(manager.status().error).toBeTruthy();
  expect(await readFile(join(root, "simple-vtt.sqlite"), "utf8")).toBe(
    "corrupt",
  );
});
test("Save As includes external media without moving its source and Clear preserves it", async () => {
  const external = await mkdtemp(join(tmpdir(), "vtt-external-"));
  roots.push(external);
  await writeFile(
    join(external, "original.png"),
    await readFile("tests/fixtures/hero.png"),
  );
  const { root, manager } = await setup(external);
  const asset = manager.require().store.addAsset({
    name: "External",
    category: "image",
    mimeType: "image/png",
    relativePath: "original.png",
  });
  const target = join(root, "copy");
  await mkdir(target);
  manager.start("save-as", target);
  expect((await finish(manager)).operation?.status).toBe("complete");
  expect(manager.require().mediaPath).toBe(
    join(
      await import("node:fs/promises").then((fs) => fs.realpath(target)),
      "media",
    ),
  );
  expect(manager.require().store.getAsset(asset.id).relativePath).toMatch(
    /\.png$/,
  );
  manager.start("close");
  await finish(manager);
  manager.start("clear");
  await finish(manager);
  expect(await readFile(join(external, "original.png"))).toEqual(
    await readFile("tests/fixtures/hero.png"),
  );
  expect(manager.require().store.listAssets()).toEqual([]);
});
test("portable scans normalize filenames and do not index managed files repeatedly", async () => {
  const { root, manager } = await setup();
  const target = join(root, "named");
  await mkdir(target);
  manager.start("save-as", target);
  await finish(manager);
  const context = manager.require();
  await mkdir(join(context.mediaPath, "Sprites"));
  await writeFile(
    join(context.mediaPath, "Sprites", "a hero.png"),
    await readFile("tests/fixtures/hero.png"),
  );
  await context.media.scan();
  await context.media.scan();
  expect(context.store.listAssets()).toHaveLength(1);
  const asset = context.store.getAsset(context.store.listAssets()[0].id);
  expect(asset.relativePath).toBe(`${asset.id}.png`);
  manager.start("close");
  await finish(manager);
  manager.start("open", target);
  expect((await finish(manager)).operation?.status).toBe("complete");
});
test("missing files and media symlinks are rejected without disrupting the current scene", async () => {
  const { root, manager } = await setup();
  const asset = await manager
    .require()
    .media.upload(
      (await import("node:fs")).createReadStream("tests/fixtures/hero.png"),
      "Hero.png",
      "sprite",
    );
  const target = join(root, "named");
  await mkdir(target);
  manager.start("save-as", target);
  await finish(manager);
  const filename = manager.require().store.getAsset(asset.id).relativePath;
  manager.start("close");
  await finish(manager);
  const current = manager.require();
  const scene = current.store.createScene("Live");
  current.store.present(scene.id);
  await rm(join(target, "media", filename));
  manager.start("open", target);
  expect((await finish(manager)).operation?.status).toBe("failed");
  expect(current.store.liveScene()?.id).toBe(scene.id);
  await symlink(
    join(process.cwd(), "tests/fixtures/hero.png"),
    join(target, "media", filename),
  );
  manager.start("open", target);
  expect((await finish(manager)).operation?.status).toBe("failed");
  expect(manager.require()).toBe(current);
});
test("a destination race preserves unrelated files and never publishes a complete session", async () => {
  const { root, manager } = await setup();
  const target = join(root, "raced");
  await mkdir(target);
  const context = manager.require();
  const snapshot = context.store.snapshot;
  context.store.snapshot = async (path) => {
    await writeFile(join(target, "raced.txt"), "other process");
    return snapshot(path);
  };
  manager.start("save-as", target);
  expect((await finish(manager)).operation?.status).toBe("failed");
  expect(manager.require()).toBe(context);
  expect(await readdir(target)).toEqual(["raced.txt"]);
  expect(await readFile(join(target, "raced.txt"), "utf8")).toBe(
    "other process",
  );
});
test("failed Clear restores staged owned media and persisted records", async () => {
  const { manager } = await setup();
  const context = manager.require();
  const asset = await context.media.upload(
    (await import("node:fs")).createReadStream("tests/fixtures/hero.png"),
    "Hero.png",
    "sprite",
  );
  const file = context.store.getAsset(asset.id).relativePath;
  const clear = context.store.clear;
  context.store.clear = () => {
    throw new Error("disk full");
  };
  manager.start("clear");
  expect((await finish(manager)).operation?.status).toBe("failed");
  context.store.clear = clear;
  expect(manager.require().store.listAssets()).toHaveLength(1);
  expect(await readFile(join(manager.require().mediaPath, file))).toEqual(
    await readFile("tests/fixtures/hero.png"),
  );
});
test("media mutations and online imports prevent session operations", async () => {
  const { manager } = await setup();
  const { PassThrough } = await import("node:stream");
  const source = new PassThrough();
  const upload = manager.require().media.upload(source, "pending.png", "image");
  expect(() => manager.start("clear")).toThrow(/media/);
  source.end(await readFile("tests/fixtures/hero.png"));
  await upload;
  expect(manager.require().media.busy()).toBe(false);
});
test("a nonempty default directory with a missing database enters recovery instead of creating replacement data", async () => {
  const root = await mkdtemp(join(tmpdir(), "vtt-missing-db-"));
  roots.push(root);
  await writeFile(join(root, "backup.zip"), "prior installation");
  const manager = await createSessionManager({
    dataDir: root,
    logger: { error: () => {} },
  });
  managers.push(manager);
  expect(manager.peek()).toBeNull();
  expect(await readdir(root)).toEqual(["backup.zip"]);
});
test("failure releasing the old store enters recovery instead of retaining a closed context", async () => {
  const { root, manager } = await setup();
  const target = join(root, "copy");
  await mkdir(target);
  const old = manager.require();
  const close = old.store.close;
  old.store.close = () => {
    close();
    throw new Error("checkpoint failed");
  };
  manager.start("save-as", target);
  expect((await finish(manager)).operation?.status).toBe("failed");
  expect(manager.peek()).toBeNull();
  expect(manager.status().error).toBeTruthy();
  expect(() => manager.require()).toThrow(/No active/);
});
test("Clear releases media streams and replaces the context for future requests", async () => {
  const { manager } = await setup();
  const old = manager.require();
  old.store.createScene("Old");
  let released: unknown;
  manager.setBeforeClose(async (context) => {
    released = context;
  });
  manager.start("clear");
  expect((await finish(manager)).operation?.status).toBe("complete");
  expect(released).toBe(old);
  expect(manager.require()).not.toBe(old);
  expect(manager.require().store.listScenes()).toEqual([]);
});
test("reported write failure blocks session mutations until explicit recovery", async () => {
  const { manager } = await setup();
  manager.markStorageError(new Error("disk full"));
  expect(manager.status().error).toContain("disk full");
  expect(() => manager.start("clear")).toThrow(/unavailable/);
  manager.start("retry");
  await finish(manager);
  expect(manager.status().error).toBeNull();
});
test("legacy default with missing indexed files stays available without replacing its data", async () => {
  const root = await mkdtemp(join(tmpdir(), "vtt-legacy-"));
  roots.push(root);
  const { openStore } = await import("../src/server/database/store.js");
  const store = openStore(root);
  const scene = store.createScene("Legacy");
  store.addAsset({
    name: "Moved image",
    category: "image",
    relativePath: "missing.png",
    mimeType: "image/png",
  });
  store.close();
  const manager = await createSessionManager({
    dataDir: root,
    logger: { error: () => {} },
  });
  managers.push(manager);
  expect(manager.peek()).not.toBeNull();
  expect(manager.require().store.listScenes()[0].id).toBe(scene.id);
  const destination = join(root, "destination");
  await mkdir(destination);
  manager.start("save-as", destination);
  expect((await finish(manager)).operation?.status).toBe("failed");
  expect(manager.require().store.listAssets()).toHaveLength(1);
});
test("retry only recovers the original storage identity after it returns", async () => {
  const { root, manager } = await setup();
  const context = manager.require();
  const scene = context.store.createScene("Original");
  const moved = join(root, "moved-default");
  await rename(context.path, moved);
  await expect(manager.checkStorage()).rejects.toThrow();
  await mkdir(context.path);
  manager.start("retry");
  expect((await finish(manager)).operation?.status).toBe("failed");
  expect(manager.status().error).toBeTruthy();
  expect(await readdir(context.path)).toEqual([]);
  await rm(context.path, { recursive: true });
  await rename(moved, context.path);
  manager.start("retry");
  expect((await finish(manager)).operation?.status).toBe("complete");
  expect(manager.status().error).toBeNull();
  expect(manager.require().store.listScenes()[0].id).toBe(scene.id);
});
test("dead local ownership is recovered but foreign ownership is never stolen", async () => {
  const { root, manager } = await setup();
  const target = join(root, "named");
  await mkdir(target);
  manager.start("save-as", target);
  await finish(manager);
  manager.start("close");
  await finish(manager);
  const { hostname } = await import("node:os");
  await writeFile(
    join(target, ".simple-vtt.lock"),
    JSON.stringify({ host: hostname(), pid: 2147483647, token: "dead" }),
  );
  manager.start("open", target);
  expect((await finish(manager)).operation?.status).toBe("complete");
  manager.start("close");
  await finish(manager);
  await writeFile(
    join(target, ".simple-vtt.lock"),
    JSON.stringify({
      host: "another-computer",
      pid: 2147483647,
      token: "remote",
    }),
  );
  manager.start("open", target);
  expect((await finish(manager)).operation?.status).toBe("failed");
  expect(
    JSON.parse(await readFile(join(target, ".simple-vtt.lock"), "utf8")).token,
  ).toBe("remote");
});
test("restarting the manager opens Default Session blank and leaves named saved content portable", async () => {
  const { root, manager } = await setup();
  const scene = manager.require().store.createScene("Default saved");
  manager.require().store.present(scene.id);
  const target = join(root, "named");
  await mkdir(target);
  manager.start("save-as", target);
  await finish(manager);
  manager.require().store.createScene("Named only");
  await manager.shutdown();
  const restarted = await createSessionManager({
    dataDir: join(root, "default"),
    logger: { error: () => {} },
  });
  managers.push(restarted);
  expect(restarted.require().info.isDefault).toBe(true);
  expect(restarted.require().store.listScenes()).toHaveLength(1);
  expect(restarted.require().store.liveScene()).toBeNull();
  restarted.start("open", target);
  expect((await finish(restarted)).operation?.status).toBe("complete");
  expect(restarted.require().store.listScenes()).toHaveLength(2);
});
test("running online audio imports block transitions until cancelled", async () => {
  const root = await mkdtemp(join(tmpdir(), "vtt-import-session-"));
  roots.push(root);
  const manager = await createSessionManager({
    dataDir: join(root, "default"),
    logger: { error: () => {} },
    onlineAudio: { run: async () => {} },
  });
  managers.push(manager);
  const job = manager
    .require()
    .onlineAudio.start({ url: "https://example.com/audio", category: "music" });
  expect(() => manager.start("clear")).toThrow(/audio import/);
  manager.require().onlineAudio.cancel(job.id);
  await manager.require().onlineAudio.close();
  expect(manager.require().onlineAudio.status()?.status).toBe("cancelled");
});
test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "a scan that cannot move a source preserves its bytes and leaves the named session reopenable",
  async () => {
    const { root, manager } = await setup();
    const target = join(root, "named");
    await mkdir(target);
    manager.start("save-as", target);
    expect((await finish(manager)).operation?.status).toBe("complete");
    const context = manager.require();
    const directory = join(context.mediaPath, "readonly");
    const source = join(directory, "hero.png");
    const bytes = await readFile("tests/fixtures/hero.png");
    await mkdir(directory);
    await writeFile(source, bytes);
    const { chmod } = await import("node:fs/promises");
    await chmod(directory, 0o555);
    try {
      await expect(context.media.scan()).rejects.toMatchObject({
        code: "EACCES",
      });
      expect(context.store.listAssets()).toEqual([]);
      expect(await readFile(source)).toEqual(bytes);
      expect(await readdir(context.mediaPath)).toEqual(["readonly"]);
      manager.start("close");
      expect((await finish(manager)).operation?.status).toBe("complete");
      manager.start("open", target);
      expect((await finish(manager)).operation?.status).toBe("complete");
      expect(manager.require().store.listAssets()).toEqual([]);
    } finally {
      await chmod(directory, 0o755);
    }
  },
);
test("a scan database failure restores the original filename without inserting an asset", async () => {
  const { root, manager } = await setup();
  const target = join(root, "named");
  await mkdir(target);
  manager.start("save-as", target);
  await finish(manager);
  const context = manager.require();
  const source = join(context.mediaPath, "hero.png");
  const bytes = await readFile("tests/fixtures/hero.png");
  await writeFile(source, bytes);
  const addAsset = context.store.addAsset;
  context.store.addAsset = () => {
    throw Object.assign(new Error("Disk full"), { code: "SQLITE_FULL" });
  };
  try {
    await expect(context.media.scan()).rejects.toMatchObject({
      code: "SQLITE_FULL",
    });
  } finally {
    context.store.addAsset = addAsset;
  }
  expect(context.store.listAssets()).toEqual([]);
  expect(await readFile(source)).toEqual(bytes);
  expect(await readdir(context.mediaPath)).toEqual(["hero.png"]);
  manager.start("close");
  await finish(manager);
  manager.start("open", target);
  expect((await finish(manager)).operation?.status).toBe("complete");
});
test("restoring an unavailable folder after forced close reclaims only its released ownership token", async () => {
  const { root, manager } = await setup();
  const target = join(root, "named");
  const disconnected = join(root, "disconnected");
  await mkdir(target);
  manager.start("save-as", target);
  expect((await finish(manager)).operation?.status).toBe("complete");
  const scene = manager.require().store.createScene("Recovered scene");
  await rename(target, disconnected);
  await expect(manager.checkStorage()).rejects.toThrow();
  manager.start("close", undefined, true);
  expect((await finish(manager)).operation?.status).toBe("complete");
  expect(manager.require().info.isDefault).toBe(true);
  await rename(disconnected, target);
  manager.start("open", target);
  expect((await finish(manager)).operation?.status).toBe("complete");
  expect(manager.require().store.listScenes()[0].id).toBe(scene.id);
  manager.start("close");
  await finish(manager);
  const { hostname } = await import("node:os");
  await writeFile(
    join(target, ".simple-vtt.lock"),
    JSON.stringify({
      host: hostname(),
      pid: process.pid,
      token: "unrecognized-same-process-token",
    }),
  );
  manager.start("open", target);
  expect((await finish(manager)).operation?.status).toBe("failed");
  expect(
    JSON.parse(await readFile(join(target, ".simple-vtt.lock"), "utf8")).token,
  ).toBe("unrecognized-same-process-token");
});
