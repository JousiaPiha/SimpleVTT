import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { buildApp } from "../src/server/app.js";
import { DEFAULT_AUDIO_PREFERENCES } from "../src/shared/audio.js";

const origin = "http://localhost:80";
const wav = Buffer.alloc(64);
wav.write("RIFF");
wav.writeUInt32LE(56, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(20, 40);
for (let i = 44; i < 64; i++) wav[i] = i;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VZsAAAAASUVORK5CYII=",
  "base64",
);
let dir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
async function start() {
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
}
const admin = (
  method: "POST" | "PATCH" | "DELETE" | "GET" | "PUT",
  url: string,
  payload?: object,
) => app.inject({ method, url, payload, headers: { cookie, origin } });
async function upload(bytes = wav, category = "music", filename = "track.wav") {
  const boundary = "audio-test";
  return app.inject({
    method: "POST",
    url: `/api/admin/assets?category=${category}`,
    headers: {
      cookie,
      origin,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vtt-audio-"));
  await start();
});
afterEach(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("private audio backend", () => {
  it("uploads original audio bytes and validates media kind against category", async () => {
    const response = await upload();
    expect(response.statusCode).toBe(201);
    const asset = response.json();
    expect(asset).toMatchObject({ category: "music", mimeType: "audio/wav" });
    expect(asset).not.toHaveProperty("relativePath");
    expect((await admin("GET", `/media/${asset.id}`)).rawPayload).toEqual(wav);
    expect((await upload(wav, "sprite")).statusCode).toBe(415);
    expect((await upload(png, "music")).statusCode).toBe(415);
    expect((await upload(Buffer.from("<script>bad</script>"))).statusCode).toBe(
      415,
    );
    expect(await readdir(join(dir, "media"))).toHaveLength(1);
  });
  it("accepts MP3, FLAC, M4A and Ogg audio signatures, including Opus", async () => {
    const mp3 = Buffer.alloc(64);
    mp3.set([0xff, 0xfb, 0x90, 0x00]);
    const flac = Buffer.alloc(64);
    flac.write("fLaC");
    const m4a = Buffer.alloc(64);
    m4a.writeUInt32BE(24);
    m4a.write("ftypM4A ", 4);
    const ogg = Buffer.alloc(64);
    ogg.write("OggS");
    ogg.set([1], 28);
    ogg.write("vorbis", 29);
    const opus = Buffer.alloc(64);
    opus.write("OggS");
    opus.write("OpusHead", 28);
    for (const [bytes, mime] of [
      [mp3, "audio/mpeg"],
      [flac, "audio/flac"],
      [m4a, "audio/x-m4a"],
      [ogg, "audio/ogg"],
      [opus, "audio/ogg; codecs=opus"],
    ] as const) {
      const response = await upload(bytes);
      expect(response.statusCode).toBe(201);
      expect(response.json().mimeType).toBe(mime);
    }
    const video = Buffer.from(ogg);
    video.set([0x80], 28);
    video.write("theora", 29);
    expect((await upload(video)).statusCode).toBe(415);
  });
  it("enforces the image upload limit and removes incomplete files", async () => {
    const oversized = Buffer.alloc(32 * 1024 * 1024 + 1);
    png.copy(oversized);
    expect((await upload(oversized, "image")).statusCode).toBe(413);
    expect(await readdir(join(dir, "media"))).toEqual([]);
  });
  it("filters legacy invalid audio references from public state after restart", async () => {
    const image = (await upload(png, "image")).json();
    const scene = (
      await admin("POST", "/api/admin/scenes", { name: "Scene" })
    ).json();
    const object = (
      await admin("POST", `/api/admin/scenes/${scene.id}/objects`, {
        assetId: image.id,
      })
    ).json();
    await admin("PATCH", `/api/admin/scenes/${scene.id}/objects/${object.id}`, {
      visible: true,
    });
    await admin("PATCH", `/api/admin/scenes/${scene.id}`, {
      backgroundAssetId: image.id,
    });
    await admin("PUT", "/api/admin/presentation", { sceneId: scene.id });
    await app.close();
    const sqlite = new Database(join(dir, "simple-vtt.sqlite"));
    sqlite
      .prepare("UPDATE assets SET mime_type = ?, category = ? WHERE id = ?")
      .run("audio/wav", "music", image.id);
    sqlite.close();
    await start();
    expect((await app.inject("/api/presentation")).json().scene).toEqual({
      id: scene.id,
      gridEnabled: false,
      drawings: [],
      gridSize: 80,
      gridColor: "#ffffff",
      backgroundAssetId: null,
      objects: [],
      content: [],
    });
    expect(
      (
        await app.inject({
          url: `/media/${image.id}`,
          headers: { range: "bytes=0-10" },
        })
      ).statusCode,
    ).toBe(404);
  });
  it("keeps audio private and rejects audio in background and sprite APIs", async () => {
    const a = (await upload()).json();
    const s = (
      await admin("POST", "/api/admin/scenes", { name: "Scene" })
    ).json();
    expect(
      (
        await admin("PATCH", `/api/admin/scenes/${s.id}`, {
          backgroundAssetId: a.id,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await admin("POST", `/api/admin/scenes/${s.id}/objects`, {
          assetId: a.id,
        })
      ).statusCode,
    ).toBe(400);
    for (const range of ["bytes=0-10", "bytes=999999-", "bad"]) {
      const response = await app.inject({
        url: `/media/${a.id}`,
        headers: { range },
      });
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-range"]).toBeUndefined();
    }
  });
  it("serves correct single byte ranges and rejects invalid ranges after authorization", async () => {
    const a = (await upload()).json();
    for (const [range, start, end] of [
      ["bytes=2-7", 2, 7],
      ["bytes=60-", 60, 63],
      ["bytes=-4", 60, 63],
      ["bytes=60-999", 60, 63],
    ] as const) {
      const response = await app.inject({
        url: `/media/${a.id}`,
        headers: { cookie, range },
      });
      expect(response.statusCode).toBe(206);
      expect(response.headers["accept-ranges"]).toBe("bytes");
      expect(response.headers["content-range"]).toBe(
        `bytes ${start}-${end}/64`,
      );
      expect(response.headers["content-length"]).toBe(String(end - start + 1));
      expect(response.rawPayload).toEqual(wav.subarray(start, end + 1));
    }
    for (const range of [
      "bytes=64-",
      "bytes=8-2",
      "bytes=-0",
      "bytes=0-1,3-4",
      "bad",
    ]) {
      const response = await app.inject({
        url: `/media/${a.id}`,
        headers: { cookie, range },
      });
      expect(response.statusCode).toBe(416);
      expect(response.headers["content-range"]).toBe("bytes */64");
    }
    const full = await admin("GET", `/media/${a.id}`);
    expect(full.headers["content-length"]).toBe("64");
    expect(full.rawPayload).toEqual(wav);
  });
  it("infers audio categories while scanning and excludes video signatures", async () => {
    for (const folder of [
      "music",
      "ambient",
      "ambience",
      "effects",
      "sfx",
      "other",
    ]) {
      await mkdir(join(dir, "media", folder));
      await writeFile(join(dir, "media", folder, `${folder}.wav`), wav);
    }
    const mp4 = Buffer.alloc(64);
    mp4.writeUInt32BE(24);
    mp4.write("ftypisom", 4);
    await writeFile(join(dir, "media", "video.m4a"), mp4);
    expect(
      (await admin("POST", "/api/admin/assets/scan")).json(),
    ).toMatchObject({ indexed: 6, skipped: 1 });
    const assets = (await admin("GET", "/api/admin/assets")).json() as Array<{
      name: string;
      category: string;
    }>;
    expect(Object.fromEntries(assets.map((a) => [a.name, a.category]))).toEqual(
      {
        "music.wav": "music",
        "ambient.wav": "ambience",
        "ambience.wav": "ambience",
        "effects.wav": "effect",
        "sfx.wav": "effect",
        "other.wav": "music",
      },
    );
  });
  it("persists ordered playlists with duplicate audio tracks, validates references, and supports removal", async () => {
    const a = (await upload()).json();
    const b = (await upload(wav, "effect", "bell.wav")).json();
    const image = (await upload(png, "sprite", "hero.png")).json();
    const response = await admin("POST", "/api/admin/playlists", {
      name: "Session",
      trackIds: [b.id, a.id, b.id],
    });
    expect(response.statusCode).toBe(201);
    const playlist = response.json();
    expect(playlist).toMatchObject({
      name: "Session",
      trackIds: [b.id, a.id, b.id],
    });
    expect(
      (
        await admin("POST", "/api/admin/playlists", {
          name: "Bad",
          trackIds: [image.id],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await admin("POST", "/api/admin/playlists", {
          name: "Bad",
          trackIds: ["missing"],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await admin("POST", "/api/admin/playlists", { name: "", trackIds: [] }))
        .statusCode,
    ).toBe(400);
    await app.close();
    await start();
    expect((await admin("GET", "/api/admin/playlists")).json()).toEqual([
      playlist,
    ]);
    expect(
      (
        await admin("PUT", `/api/admin/playlists/${playlist.id}`, {
          name: "Changed",
          trackIds: [a.id],
        })
      ).json(),
    ).toEqual({ id: playlist.id, name: "Changed", trackIds: [a.id] });
    expect(
      (
        await admin("PUT", `/api/admin/playlists/${playlist.id}`, {
          name: "Bad",
          trackIds: [image.id],
        })
      ).statusCode,
    ).toBe(400);
    expect((await admin("GET", "/api/admin/playlists")).json()[0].name).toBe(
      "Changed",
    );
    expect(
      (await admin("DELETE", `/api/admin/playlists/${playlist.id}`)).statusCode,
    ).toBe(204);
    expect((await admin("GET", "/api/admin/playlists")).json()).toEqual([]);
    expect(
      (await admin("DELETE", `/api/admin/playlists/${playlist.id}`)).statusCode,
    ).toBe(404);
  });
  it("validates and persists preferences without any playback state", async () => {
    expect((await admin("GET", "/api/admin/audio-preferences")).json()).toEqual(
      DEFAULT_AUDIO_PREFERENCES,
    );
    const preferences = {
      ...DEFAULT_AUDIO_PREFERENCES,
      shuffle: true,
      musicLoop: true,
      ambienceVolumes: { rain: 0.3 },
      volumes: { master: 0, music: 0.2, ambience: 0.3, effects: 1 },
    };
    expect(
      (await admin("PUT", "/api/admin/audio-preferences", preferences)).json(),
    ).toEqual(preferences);
    expect(
      (
        await admin("PUT", "/api/admin/audio-preferences", {
          ...preferences,
          playing: true,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await admin("PUT", "/api/admin/audio-preferences", {
          ...preferences,
          volumes: { ...preferences.volumes, master: 2 },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
    await start();
    expect((await admin("GET", "/api/admin/audio-preferences")).json()).toEqual(
      preferences,
    );
  });
  it("protects playlist and preference APIs and denies hostile origins", async () => {
    for (const url of [
      "/api/admin/playlists",
      "/api/admin/audio-preferences",
    ]) {
      expect((await app.inject(url)).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: url.endsWith("playlists") ? "POST" : "PUT",
            url,
            payload: {},
            headers: { cookie, origin: "http://evil.example" },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/playlists",
          payload: { name: "Private", trackIds: [] },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("migrates an original phase-one database without losing scenes or assets", async () => {
    await app.close();
    await rm(join(dir, "simple-vtt.sqlite"));
    const sqlite = new Database(join(dir, "simple-vtt.sqlite"));
    sqlite.exec(
      (await readFile("drizzle/0000_boring_randall.sql", "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
    sqlite.exec(
      `CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric); INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('old', 1791563327350); INSERT INTO assets VALUES ('old-image', 'Old image', 'sprite', 'old.png', 'image/png'); INSERT INTO scenes VALUES ('old-scene', 'Old scene', 'old-image', 1, 1); INSERT INTO presentation VALUES (1, 'old-scene');`,
    );
    sqlite.close();
    await start();
    expect((await app.inject("/api/presentation")).json().scene).toMatchObject({
      id: "old-scene",
      backgroundAssetId: "old-image",
    });
    expect((await admin("GET", "/api/admin/assets")).json()).toHaveLength(1);
    expect(
      (
        await admin("POST", "/api/admin/playlists", {
          name: "New",
          trackIds: [],
        })
      ).statusCode,
    ).toBe(201);
    await app.close();
    await start();
    expect((await admin("GET", "/api/admin/playlists")).json()).toHaveLength(1);
  });
});
