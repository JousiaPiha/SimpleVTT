import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  createSessionManager,
  type SessionManager,
} from "../src/server/services/sessions.js";

let manager: SessionManager | undefined;
let root: string | undefined;
afterEach(async () => {
  await manager?.shutdown();
  if (root) await rm(root, { recursive: true, force: true });
});

test.each(["invalid name", "non-audio track"])(
  "Open rejects a playlist with %s without switching sessions",
  async (invalid) => {
    root = await mkdtemp(join(tmpdir(), "vtt-session-validation-"));
    manager = await createSessionManager({
      dataDir: join(root, "default"),
      logger: { error: () => {} },
    });
    const context = manager.require();
    await writeFile(
      join(context.mediaPath, "hero.png"),
      await readFile("tests/fixtures/hero.png"),
    );
    const asset = context.store.addAsset({
      name: "Hero",
      category: "sprite",
      mimeType: "image/png",
      relativePath: "hero.png",
    });
    const playlist = context.store.createPlaylist({
      name: "Valid",
      trackIds: [],
    });
    const target = join(root, "named");
    await mkdir(target);
    manager.start("save-as", target);
    await expect.poll(() => manager!.status().busy).toBe(false);
    expect(manager.status().operation?.status).toBe("complete");
    manager.start("close");
    await expect.poll(() => manager!.status().busy).toBe(false);
    const current = manager.require();
    const generation = manager.status().generation;
    const db = new Database(join(target, "simple-vtt.sqlite"));
    if (invalid === "invalid name")
      db.prepare("UPDATE playlists SET name = '' WHERE id = ?").run(
        playlist.id,
      );
    else
      db.prepare(
        "INSERT INTO playlist_tracks (playlist_id, position, asset_id) VALUES (?, 0, ?)",
      ).run(playlist.id, asset.id);
    db.close();
    manager.start("open", target);
    await expect.poll(() => manager!.status().busy).toBe(false);
    expect(manager.status().operation?.status).toBe("failed");
    expect(manager.require()).toBe(current);
    expect(manager.status().generation).toBe(generation);
  },
);
