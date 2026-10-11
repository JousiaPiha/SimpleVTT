import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Socket } from "node:net";
import Database from "better-sqlite3";
import { buildApp } from "../src/server/app.js";
import type { Asset, Scene } from "../src/shared/contracts.js";
import { wav } from "./helpers/wav.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    unlink: vi.fn(actual.unlink),
    stat: vi.fn(actual.stat),
  };
});

const origin = "http://localhost:80";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VZsAAAAASUVORK5CYII=",
  "base64",
);
let dir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
const admin = (
  method: "POST" | "PATCH" | "DELETE" | "GET" | "PUT",
  url: string,
  payload?: object,
) => app.inject({ method, url, payload, headers: { cookie, origin } });
const db = (action: (sqlite: Database.Database) => void) => {
  const sqlite = new Database(join(dir, "simple-vtt.sqlite"));
  try {
    action(sqlite);
  } finally {
    sqlite.close();
  }
};
async function asset(name = "image.png", bytes: Buffer = png): Promise<Asset> {
  await writeFile(join(dir, "media", name), bytes);
  expect((await admin("POST", "/api/admin/assets/scan")).statusCode).toBe(200);
  return (await admin("GET", "/api/admin/assets"))
    .json<Asset[]>()
    .find((a) => a.name === name)!;
}
async function scene(name = "Scene"): Promise<Scene> {
  return (await admin("POST", "/api/admin/scenes", { name })).json();
}
async function useImage(sceneId: string, assetId: string, visible = true) {
  await admin("PATCH", `/api/admin/scenes/${sceneId}`, {
    backgroundAssetId: assetId,
  });
  const object = (
    await admin("POST", `/api/admin/scenes/${sceneId}/objects`, { assetId })
  ).json();
  await admin("PATCH", `/api/admin/scenes/${sceneId}/objects/${object.id}`, {
    visible,
  });
  return object;
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vtt-delete-"));
  app = await buildApp({
    dataDir: dir,
    adminPassword: "test-password-123",
    logger: false,
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { password: "test-password-123" },
  });
  cookie = login.headers["set-cookie"]!.toString().split(";")[0]!;
});
afterEach(async () => {
  vi.mocked(fs.rename).mockReset();
  vi.mocked(fs.unlink).mockReset();
  vi.mocked(fs.stat).mockReset();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("media deletion", () => {
  it("keeps usage private and requires authenticated same-origin deletion", async () => {
    const a = await asset();
    expect(
      (await app.inject(`/api/admin/assets/${a.id}/usage`)).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "DELETE", url: `/api/admin/assets/${a.id}` }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/admin/assets/${a.id}`,
          headers: { cookie, origin: "http://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await admin("GET", `/api/admin/assets/${a.id}/usage`)).json(),
    ).toEqual({
      sceneCount: 0,
      backgroundCount: 0,
      objectCount: 0,
      playlistCount: 0,
      trackCount: 0,
      soundboardIconCount: 0,
    });
    expect(
      (await admin("GET", "/api/admin/assets/missing/usage")).statusCode,
    ).toBe(404);
    expect(
      (await admin("DELETE", "/api/admin/assets/missing")).statusCode,
    ).toBe(404);
    expect(await readFile(join(dir, "media", "image.png"))).toEqual(png);
  });

  it("removes all image references, preserves scenes and other content, and updates player snapshots and sockets", async () => {
    const a = await asset();
    const keep = await asset("keep.png");
    const first = await scene("Live");
    const second = await scene("Private");
    const third = await scene("Only objects");
    const visible = await useImage(first.id, a.id);
    await useImage(second.id, a.id, false);
    await admin("POST", `/api/admin/scenes/${third.id}/objects`, {
      assetId: a.id,
    });
    await admin("POST", `/api/admin/scenes/${first.id}/objects`, {
      assetId: keep.id,
    });
    await admin("PUT", "/api/admin/presentation", { sceneId: first.id });
    expect(
      (await admin("GET", `/api/admin/assets/${a.id}/usage`)).json(),
    ).toEqual({
      sceneCount: 3,
      backgroundCount: 2,
      objectCount: 3,
      playlistCount: 0,
      trackCount: 0,
      soundboardIconCount: 0,
    });
    const socket = await app.injectWS("/ws/player", {
      socket: new Socket(),
      headers: { origin, host: "localhost" },
    });
    const update = new Promise<unknown>((resolve) =>
      socket.once("message", (data) => resolve(JSON.parse(data.toString()))),
    );
    expect(
      (await admin("DELETE", `/api/admin/assets/${a.id}`)).statusCode,
    ).toBe(204);
    expect(await update).toMatchObject({
      type: "presentation.patch",
      backgroundAssetId: null,
      removed: [visible.id],
    });
    socket.terminate();
    expect((await app.inject("/api/presentation")).json().scene).toEqual({
      id: first.id,
      gridEnabled: false,
      drawings: [],
      gridSize: 80,
      gridColor: "#ffffff",
      backgroundAssetId: null,
      objects: [],
      content: [],
    });
    expect((await admin("GET", "/api/admin/scenes")).json()).toHaveLength(3);
    for (const s of [first, second, third]) {
      const saved = (
        await admin("GET", `/api/admin/scenes/${s.id}`)
      ).json<Scene>();
      expect(saved.backgroundAssetId).toBeNull();
      expect(saved.objects.map((o) => o.assetId)).toEqual(
        s.id === first.id ? [keep.id] : [],
      );
    }
    expect((await app.inject(`/media/${a.id}`)).statusCode).toBe(404);
    await expect(
      readFile(join(dir, "media", "image.png")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await admin("POST", "/api/admin/assets/scan")).json()).toEqual({
      indexed: 1,
      skipped: 0,
    });
    expect((await admin("GET", "/api/admin/assets")).json()).toEqual([keep]);
  });

  it("removes duplicate audio entries across playlists without deleting playlists or other tracks", async () => {
    const sound = await asset("sound.wav", wav());
    const keep = await asset("keep.wav", wav());
    const p1 = (
      await admin("POST", "/api/admin/playlists", {
        name: "One",
        trackIds: [sound.id, keep.id, sound.id],
      })
    ).json();
    const p2 = (
      await admin("POST", "/api/admin/playlists", {
        name: "Two",
        trackIds: [sound.id],
      })
    ).json();
    expect(
      (await admin("GET", `/api/admin/assets/${sound.id}/usage`)).json(),
    ).toEqual({
      sceneCount: 0,
      backgroundCount: 0,
      objectCount: 0,
      playlistCount: 2,
      trackCount: 3,
      soundboardIconCount: 0,
    });
    expect(
      (await admin("DELETE", `/api/admin/assets/${sound.id}`)).statusCode,
    ).toBe(204);
    expect((await admin("GET", "/api/admin/playlists")).json()).toEqual([
      { ...p1, trackIds: [keep.id] },
      { ...p2, trackIds: [] },
    ]);
    expect(await readFile(join(dir, "media", "keep.wav"))).toEqual(wav());
    expect((await admin("GET", `/media/${sound.id}`)).statusCode).toBe(404);
  });

  it("removes metadata and references for already missing source files", async () => {
    const a = await asset();
    const s = await scene();
    await useImage(s.id, a.id);
    await rm(join(dir, "media", "image.png"));
    expect(
      (await admin("DELETE", `/api/admin/assets/${a.id}`)).statusCode,
    ).toBe(204);
    expect((await admin("GET", "/api/admin/assets")).json()).toEqual([]);
    expect(
      (await admin("GET", `/api/admin/scenes/${s.id}`)).json(),
    ).toMatchObject({ backgroundAssetId: null, objects: [] });
  });

  it.each([
    "absolute",
    "traversal",
    "backslash traversal",
    ...(sep !== "\\" ? ["backslash alias"] : []),
    "file symlink",
    "parent symlink",
    "internal symlink",
    "directory",
  ])(
    "rejects unsafe %s paths without changing files or references",
    async (kind) => {
      const a = await asset();
      const s = await scene();
      await useImage(s.id, a.id);
      const outside = join(dir, "outside.png");
      await writeFile(outside, png);
      let relativePath = "image.png";
      if (kind === "absolute") relativePath = outside;
      if (kind === "traversal") relativePath = "../outside.png";
      if (kind === "backslash traversal") relativePath = "..\\outside.png";
      if (kind === "backslash alias") {
        await mkdir(join(dir, "media", "nested"));
        await writeFile(join(dir, "media", "nested", "keep.png"), png);
        relativePath = "nested\\keep.png";
        await writeFile(join(dir, "media", relativePath), png);
      }
      if (kind === "file symlink") {
        await symlink(outside, join(dir, "media", "link.png"));
        relativePath = "link.png";
      }
      if (kind === "parent symlink") {
        await symlink(dir, join(dir, "media", "linked"));
        relativePath = "linked/outside.png";
      }
      if (kind === "internal symlink") {
        await symlink(
          join(dir, "media", "image.png"),
          join(dir, "media", "link.png"),
        );
        relativePath = "link.png";
      }
      if (kind === "directory") {
        await mkdir(join(dir, "media", "folder"));
        relativePath = "folder";
      }
      db((sqlite) =>
        sqlite
          .prepare("UPDATE assets SET relative_path = ? WHERE id = ?")
          .run(relativePath, a.id),
      );
      expect(
        (await admin("DELETE", `/api/admin/assets/${a.id}`)).statusCode,
      ).toBe(400);
      expect((await admin("GET", "/api/admin/assets")).json()).toHaveLength(1);
      expect(
        (await admin("GET", `/api/admin/scenes/${s.id}`)).json().objects,
      ).toHaveLength(1);
      expect(await readFile(outside)).toEqual(png);
      expect(await readFile(join(dir, "media", "image.png"))).toEqual(png);
      if (kind === "backslash alias") {
        expect(
          await readFile(join(dir, "media", "nested", "keep.png")),
        ).toEqual(png);
        expect(await readFile(join(dir, "media", relativePath))).toEqual(png);
      }
    },
  );

  it("preserves references if the source cannot be staged", async () => {
    const a = await asset();
    const s = await scene();
    await useImage(s.id, a.id);
    vi.mocked(fs.rename).mockRejectedValueOnce(
      Object.assign(new Error("No permission"), { code: "EACCES" }),
    );
    expect(
      (await admin("DELETE", `/api/admin/assets/${a.id}`)).statusCode,
    ).toBe(500);
    expect(
      (await admin("GET", `/api/admin/scenes/${s.id}`)).json(),
    ).toMatchObject({
      backgroundAssetId: a.id,
      objects: [expect.objectContaining({ assetId: a.id })],
    });
    expect(await readFile(join(dir, "media", "image.png"))).toEqual(png);
  });

  it("keeps committed deletion successful and unscannable if staged-file cleanup fails", async () => {
    const a = await asset();
    vi.mocked(fs.unlink).mockRejectedValueOnce(
      Object.assign(new Error("No permission"), { code: "EACCES" }),
    );
    expect(
      (await admin("DELETE", `/api/admin/assets/${a.id}`)).statusCode,
    ).toBe(204);
    const remaining = await readdir(join(dir, "media"));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatch(/^\..+\.deleted$/);
    expect(await readFile(join(dir, "media", remaining[0]))).toEqual(png);
    expect((await admin("GET", `/media/${a.id}`)).statusCode).toBe(404);
    expect((await app.inject(`/media/${a.id}`)).statusCode).toBe(404);
    expect((await admin("POST", "/api/admin/assets/scan")).json()).toEqual({
      indexed: 0,
      skipped: 1,
    });
    expect((await admin("GET", "/api/admin/assets")).json()).toEqual([]);
  });

  it("waits for an in-flight scan before deleting so the scan cannot reindex the removed asset", async () => {
    const a = await asset();
    const originalStat = (
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      )
    ).stat;
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let scanned!: () => void;
    const atFinalStat = new Promise<void>((resolve) => {
      scanned = resolve;
    });
    let calls = 0;
    vi.mocked(fs.stat).mockImplementation(async (...args) => {
      const result = await originalStat(...args);
      if (
        String(args[0]).endsWith(`${sep}media${sep}image.png`) &&
        ++calls === 2
      ) {
        scanned();
        await gate;
      }
      return result;
    });
    const scanning = admin("POST", "/api/admin/assets/scan").then(
      (response) => response,
    );
    await atFinalStat;
    const deleting = admin("DELETE", `/api/admin/assets/${a.id}`).then(
      (response) => response,
    );
    // If deletion bypasses the scan lock it completes here, letting the paused
    // scan reinsert the now-deleted asset. With the lock it must wait.
    await Promise.race([
      deleting,
      new Promise<void>((resolve) => setTimeout(resolve, 100)),
    ]);
    unblock();
    expect((await scanning).statusCode).toBe(200);
    expect((await deleting).statusCode).toBe(204);
    expect((await admin("GET", "/api/admin/assets")).json()).toEqual([]);
    expect(await readdir(join(dir, "media"))).toEqual([]);
  });

  it("rolls back reference cleanup and restores the staged file after a database failure", async () => {
    const a = await asset();
    const s = await scene();
    await useImage(s.id, a.id);
    await admin("PUT", "/api/admin/presentation", { sceneId: s.id });
    const before = (await app.inject("/api/presentation")).json();
    db((sqlite) =>
      sqlite.exec(
        "CREATE TRIGGER deny_asset_delete BEFORE DELETE ON assets BEGIN SELECT RAISE(ABORT, 'test failure'); END",
      ),
    );
    expect(
      (await admin("DELETE", `/api/admin/assets/${a.id}`)).statusCode,
    ).toBe(500);
    expect(
      (await admin("GET", `/api/admin/scenes/${s.id}`)).json(),
    ).toMatchObject({
      backgroundAssetId: a.id,
      objects: [expect.objectContaining({ assetId: a.id })],
    });
    expect((await app.inject("/api/presentation")).json()).toEqual(before);
    expect(await readFile(join(dir, "media", "image.png"))).toEqual(png);
    expect(await readdir(join(dir, "media"))).toEqual(["image.png"]);
    db((sqlite) => sqlite.exec("DROP TRIGGER deny_asset_delete"));
    expect(
      (await admin("DELETE", `/api/admin/assets/${a.id}`)).statusCode,
    ).toBe(204);
  });
});
