import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server/app.js";
import type { Asset } from "../src/shared/contracts.js";
import type { SessionAction, SessionStatus } from "../src/shared/sessions.js";
import type { SoundboardEntry } from "../src/shared/soundboard.js";
import { wav } from "./helpers/wav.js";

let root: string;
let globalDir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
let generation: string;
const origin = "http://localhost:80";
const audio = wav(1);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VZsAAAAASUVORK5CYII=",
  "base64",
);
type Transfer = { asset: Asset; reused: boolean };
const request = (
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  payload?: object,
  tag = generation,
) => app.inject({
  method,
  url: `/api/admin/${path}`,
  payload,
  headers: { cookie, origin, "x-simplevtt-session": tag },
});
const status = async () => (await request("GET", "session")).json<SessionStatus>();
const assets = async () => (await request("GET", "assets")).json<Asset[]>();
const library = async () => {
  const response = await request("GET", "global-library");
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ assets: Asset[] }>().assets;
};
const transfer = async (path: string) => {
  const response = await request("POST", `global-library/${path}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Transfer>();
};
const perform = async (action: SessionAction, path?: string) => {
  const response = await request("POST", "session/operations", { action, path });
  expect(response.statusCode, response.body).toBe(202);
  await expect.poll(async () => (await status()).busy).toBe(false);
  const result = await status();
  expect(result.operation?.status, result.operation?.error ?? undefined).toBe("complete");
  generation = result.generation;
  return result;
};
async function start(dataDir = join(root, "default"), libraryDir = globalDir) {
  app = await buildApp({ dataDir, globalLibraryDir: libraryDir, adminPassword: "x", logger: false });
  const login = await app.inject({
    method: "POST", url: "/api/auth/login", headers: { origin }, payload: { password: "x" },
  });
  cookie = login.headers["set-cookie"]!.toString().split(";")[0]!;
  generation = (await status()).generation;
}
async function upload(bytes = audio, category = "music", name = "Theme.wav") {
  const boundary = "global-library-test";
  const response = await app.inject({
    method: "POST",
    url: `/api/admin/assets?category=${category}`,
    headers: {
      cookie, origin, "x-simplevtt-session": generation,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Asset>();
}
const media = (id: string, global = false, tag = generation) => app.inject({
  url: `/${global ? "global-media" : "media"}/${id}?session=${tag}`,
  headers: { cookie },
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "simple-vtt-global-api-"));
  globalDir = join(root, "global-library");
  await mkdir(globalDir);
  generation = "";
  await start();
});
afterEach(async () => {
  await app?.close();
  await rm(root, { recursive: true, force: true });
});

it("promotes independent audio bytes, reuses identical transfers, and retains the catalog after restart", async () => {
  const original = await upload();
  expect(await library()).toEqual([]);
  const promoted = await transfer(`from-session/${original.id}`);
  expect(promoted.reused).toBe(false);
  expect(promoted.asset).toMatchObject({ name: "Theme.wav", category: "music", mimeType: "audio/wav" });
  expect(promoted.asset).not.toHaveProperty("relativePath");
  expect(promoted.asset.id).not.toBe(original.id);
  expect(await library()).toEqual([promoted.asset]);
  expect(await transfer(`from-session/${original.id}`)).toEqual({ ...promoted, reused: true });
  expect(await transfer(`${promoted.asset.id}/add-to-session`)).toEqual({ asset: original, reused: true });
  expect(await assets()).toEqual([original]);
  expect((await media(promoted.asset.id, true)).rawPayload).toEqual(audio);
  await app.close();
  await start();
  expect(await library()).toEqual([promoted.asset]);
  expect((await media(promoted.asset.id, true)).rawPayload).toEqual(audio);
});

it("recategorizes global tracks independently and can promote the original category again", async () => {
  const original = await upload(audio, "effect");
  const icon = await upload(png, "image", "icon.png");
  const settings = { group: "Weather", icon: "volume-2", customIconAssetId: icon.id };
  expect((await request("PUT", `soundboard/${original.id}`, settings)).statusCode).toBe(200);
  const { asset } = await transfer(`from-session/${original.id}`);
  const files = await readdir(join(globalDir, "media"));
  const changed = await request("PATCH", `global-library/${asset.id}/category`, { category: "ambience" });
  expect(changed.statusCode, changed.body).toBe(200);
  expect(changed.json()).toEqual({ ...asset, category: "ambience" });
  expect(await assets()).toContainEqual(original);
  expect(await readdir(join(globalDir, "media"))).toEqual(files);
  expect((await media(asset.id, true)).rawPayload).toEqual(audio);
  const copy = await transfer(`${asset.id}/add-to-session`);
  expect(copy.asset.category).toBe("ambience");
  const rePromoted = await transfer(`from-session/${original.id}`);
  expect(rePromoted.asset.id).not.toBe(asset.id);
  expect(rePromoted.asset.category).toBe("effect");
  expect(await transfer(`from-session/${original.id}`)).toEqual({ ...rePromoted, reused: true });
  await request("DELETE", `global-library/${rePromoted.asset.id}`);
  await app.close();
  await start();
  expect(await library()).toEqual([{ ...asset, category: "ambience" }]);
  expect((await request("PATCH", `global-library/${asset.id}/category`, { category: "effect" })).statusCode).toBe(200);
  await perform("clear");
  const restored = await transfer(`${asset.id}/add-to-session`);
  const sound = (await request("GET", "soundboard")).json<SoundboardEntry[]>()[0]!;
  expect(sound).toMatchObject({ assetId: restored.asset.id, group: "Weather", icon: "volume-2" });
  expect((await media(sound.customIconAssetId!)).rawPayload).toEqual(png);
});

it("rejects a conflicting global category change without merging or losing either track", async () => {
  const original = await upload();
  const music = (await transfer(`from-session/${original.id}`)).asset;
  const effect = (await transfer(`from-session/${(await upload(audio, "effect")).id}`)).asset;
  const response = await request("PATCH", `global-library/${music.id}/category`, { category: "effect" });
  expect(response.statusCode).toBe(409);
  expect(response.json().error).toMatch(/already.*category/i);
  expect(await library()).toEqual(expect.arrayContaining([music, effect]));
  expect((await media(music.id, true)).rawPayload).toEqual(audio);
  expect((await media(effect.id, true)).rawPayload).toEqual(audio);
  expect((await request("PATCH", `global-library/${music.id}/category`, { category: "music" })).statusCode).toBe(200);
});

it("validates and protects global category updates", async () => {
  const { asset } = await transfer(`from-session/${(await upload()).id}`);
  const path = `global-library/${asset.id}/category`;
  expect((await app.inject({ method: "PATCH", url: `/api/admin/${path}`, payload: { category: "effect" } })).statusCode).toBe(401);
  expect((await app.inject({ method: "PATCH", url: `/api/admin/${path}`, headers: { cookie, origin: "http://evil.example" }, payload: { category: "effect" } })).statusCode).toBe(403);
  expect((await request("PATCH", path, { category: "image" })).statusCode).toBe(400);
  expect((await request("PATCH", path, { category: "effect", name: "Changed" })).statusCode).toBe(400);
  expect((await request("PATCH", "global-library/missing/category", { category: "effect" })).statusCode).toBe(404);
  expect(await library()).toEqual([asset]);
});

it("previews authenticated byte ranges without importing or changing session assets", async () => {
  const original = await upload();
  const { asset } = await transfer(`from-session/${original.id}`);
  await perform("clear");
  expect(await assets()).toEqual([]);
  const full = await media(asset.id, true);
  expect(full.statusCode).toBe(200);
  expect(full.headers["cache-control"]).toBe("no-store");
  expect(full.rawPayload).toEqual(audio);
  const ranged = await app.inject({
    url: `/global-media/${asset.id}?session=${generation}`,
    headers: { cookie, range: "bytes=4-11" },
  });
  expect(ranged.statusCode).toBe(206);
  expect(ranged.headers["content-range"]).toBe(`bytes 4-11/${audio.length}`);
  expect(ranged.headers["content-length"]).toBe("8");
  expect(ranged.rawPayload).toEqual(audio.subarray(4, 12));
  const invalid = await app.inject({
    url: `/global-media/${asset.id}?session=${generation}`,
    headers: { cookie, range: "bytes=999999-" },
  });
  expect(invalid.statusCode).toBe(416);
  expect(invalid.headers["content-range"]).toBe(`bytes */${audio.length}`);
  expect(await assets()).toEqual([]);
  expect(await readdir(join(root, "default", "media"))).toEqual([]);
});

it("serializes concurrent transfers and reuses one independent asset in a cleared session", async () => {
  const original = await upload();
  const promoted = await Promise.all(Array.from({ length: 4 }, () => transfer(`from-session/${original.id}`)));
  expect(new Set(promoted.map((result) => result.asset.id)).size).toBe(1);
  expect(promoted.filter((result) => !result.reused)).toHaveLength(1);
  expect(await library()).toHaveLength(1);
  await perform("clear");
  const copied = await Promise.all(Array.from({ length: 4 }, () => transfer(`${promoted[0]!.asset.id}/add-to-session`)));
  expect(new Set(copied.map((result) => result.asset.id)).size).toBe(1);
  expect(copied.filter((result) => !result.reused)).toHaveLength(1);
  const local = copied[0]!.asset;
  expect(local.id).not.toBe(promoted[0]!.asset.id);
  expect(await assets()).toEqual([local]);
  expect(await readdir(join(root, "default", "media"))).toHaveLength(1);
  expect((await media(local.id)).rawPayload).toEqual(audio);
});

it("copies soundboard groups and custom icon bytes while preserving existing local settings on repeat", async () => {
  const effect = await upload(audio, "effect", "Door.wav");
  const icon = await upload(png, "image", "Door icon.png");
  expect((await request("PUT", `soundboard/${effect.id}`, {
    group: "Dungeon", icon: "door-open", customIconAssetId: icon.id,
  })).statusCode).toBe(200);
  const { asset: global } = await transfer(`from-session/${effect.id}`);
  // Image support exists only for attached icons, not standalone global entries.
  expect(await library()).toEqual([global]);
  await perform("clear");
  const { asset: local } = await transfer(`${global.id}/add-to-session`);
  const settings = (await request("GET", "soundboard")).json<SoundboardEntry[]>();
  expect(settings).toHaveLength(1);
  expect(settings[0]).toMatchObject({ assetId: local.id, group: "Dungeon", icon: "door-open" });
  const iconId = settings[0]!.customIconAssetId;
  expect(iconId).toBeTruthy();
  expect((await media(iconId!)).rawPayload).toEqual(png);
  expect(await assets()).toHaveLength(2);
  const localSettings = { group: "Session favourites", icon: "bell", customIconAssetId: null };
  expect((await request("PUT", `soundboard/${local.id}`, localSettings)).statusCode).toBe(200);
  expect(await transfer(`${global.id}/add-to-session`)).toEqual({ asset: local, reused: true });
  expect((await request("GET", "soundboard")).json()).toEqual([{ ...localSettings, assetId: local.id }]);
  expect(await assets()).toHaveLength(2);
});

it("keeps session copies and playlists independent of global rename and delete", async () => {
  const original = await upload();
  const { asset: global } = await transfer(`from-session/${original.id}`);
  expect((await request("DELETE", `assets/${original.id}`)).statusCode).toBe(204);
  expect((await media(global.id, true)).rawPayload).toEqual(audio);
  const { asset: local } = await transfer(`${global.id}/add-to-session`);
  const playlist = await request("POST", "playlists", { name: "Local soundtrack", trackIds: [local.id] });
  expect(playlist.statusCode).toBe(201);
  const renamed = await request("PATCH", `global-library/${global.id}`, { name: "Global name" });
  expect(renamed.statusCode).toBe(200);
  expect(renamed.json()).toMatchObject({ id: global.id, name: "Global name" });
  expect(await assets()).toEqual([local]);
  expect((await request("DELETE", `global-library/${global.id}`)).statusCode).toBe(204);
  expect(await library()).toEqual([]);
  expect(await assets()).toEqual([local]);
  expect((await request("GET", "playlists")).json()).toEqual([playlist.json()]);
  expect((await media(local.id)).rawPayload).toEqual(audio);
});

it("gives a deleted and re-added session copy a fresh identity with the original bytes", async () => {
  const original = await upload();
  const { asset: global } = await transfer(`from-session/${original.id}`);
  await perform("clear");
  const first = await transfer(`${global.id}/add-to-session`);
  expect(first.reused).toBe(false);
  expect((await request("DELETE", `assets/${first.asset.id}`)).statusCode).toBe(204);
  expect(await assets()).toEqual([]);
  const second = await transfer(`${global.id}/add-to-session`);
  expect(second.reused).toBe(false);
  expect(second.asset.id).not.toBe(first.asset.id);
  expect((await media(second.asset.id)).rawPayload).toEqual(audio);
  expect(await transfer(`${global.id}/add-to-session`)).toEqual({ ...second, reused: true });
  expect(await assets()).toEqual([second.asset]);
});

it("saves a portable session with copied icons and plays after the global root is removed", async () => {
  const effect = await upload(audio, "effect", "Portable door.wav");
  const icon = await upload(png, "image", "Portable icon.png");
  await request("PUT", `soundboard/${effect.id}`, { group: "Portable", icon: "door-open", customIconAssetId: icon.id });
  const { asset: global } = await transfer(`from-session/${effect.id}`);
  await perform("clear");
  const { asset: local } = await transfer(`${global.id}/add-to-session`);
  const unused = await upload(wav(1, 440), "music", "Global only.wav");
  await transfer(`from-session/${unused.id}`);
  await request("DELETE", `assets/${unused.id}`);
  const destination = join(root, "Portable");
  await mkdir(destination);
  await perform("save-as", destination);
  expect(await readdir(join(destination, "media"))).toHaveLength(2);
  await app.close();
  await rm(globalDir, { recursive: true });
  await start(destination);
  expect((await request("GET", "global-library")).statusCode).toBe(503);
  expect(await assets()).toHaveLength(2);
  expect((await media(local.id)).rawPayload).toEqual(audio);
  const settings = (await request("GET", "soundboard")).json<SoundboardEntry[]>();
  expect(settings).toHaveLength(1);
  expect(settings[0]).toMatchObject({ assetId: local.id, group: "Portable", icon: "door-open" });
  expect((await media(settings[0]!.customIconAssetId!)).rawPayload).toEqual(png);
  expect((await request("POST", "scenes", { name: "Still editable" })).statusCode).toBe(201);
  expect((await status()).error).toBeNull();
});

it("does not recreate an absent explicit root or block session writes, and retries after storage returns", async () => {
  await app.close();
  const missing = join(root, "Disconnected drive");
  await start(join(root, "default"), missing);
  const original = await upload();
  expect((await request("GET", "global-library")).statusCode).toBe(503);
  expect((await request("POST", `global-library/from-session/${original.id}`)).statusCode).toBe(503);
  await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await status()).error).toBeNull();
  expect((await request("POST", "scenes", { name: "Available session" })).statusCode).toBe(201);
  expect((await media(original.id)).rawPayload).toEqual(audio);
  await mkdir(missing);
  expect(await library()).toEqual([]);
  const { asset } = await transfer(`from-session/${original.id}`);
  const moved = join(root, "Moved drive");
  await rename(missing, moved);
  expect((await request("POST", `global-library/${asset.id}/add-to-session`)).statusCode).toBe(503);
  expect((await status()).error).toBeNull();
  expect((await request("POST", "scenes", { name: "Still available" })).statusCode).toBe(201);
  await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  await rename(moved, missing);
  expect(await library()).toEqual([asset]);
  expect((await media(asset.id, true)).rawPayload).toEqual(audio);
});

it("rejects stale session generations for global changes and preview without changing the library", async () => {
  const original = await upload();
  const { asset } = await transfer(`from-session/${original.id}`);
  const previous = generation;
  await perform("clear");
  for (const [method, path, payload] of [
    ["POST", `from-session/${original.id}`, undefined],
    ["POST", `${asset.id}/add-to-session`, undefined],
    ["PATCH", asset.id, { name: "Stale rename" }],
    ["DELETE", asset.id, undefined],
  ] as const) {
    expect((await request(method, `global-library/${path}`, payload, previous)).statusCode).toBe(409);
  }
  expect((await media(asset.id, true, previous)).statusCode).toBe(409);
  expect(await library()).toEqual([asset]);
  expect(await assets()).toEqual([]);
});

it("keeps global listing, preview and copies private and rejects foreign origins", async () => {
  const original = await upload();
  const { asset } = await transfer(`from-session/${original.id}`);
  for (const [method, path] of [
    ["GET", ""], ["POST", `/from-session/${original.id}`], ["POST", `/${asset.id}/add-to-session`],
    ["PATCH", `/${asset.id}`], ["DELETE", `/${asset.id}`],
  ] as const) {
    const response = await app.inject({
      method, url: `/api/admin/global-library${path}`,
      headers: { origin, "x-simplevtt-session": generation },
      ...(method === "PATCH" ? { payload: { name: "Private" } } : {}),
    });
    expect(response.statusCode).toBe(401);
  }
  const preview = await app.inject({
    url: `/global-media/${asset.id}?session=${generation}`, headers: { range: "bytes=0-7" },
  });
  expect([401, 404]).toContain(preview.statusCode);
  expect(preview.headers["content-range"]).toBeUndefined();
  expect(preview.body).not.toContain("Theme.wav");
  expect((await app.inject("/api/presentation")).body).not.toContain(asset.id);
  for (const method of ["POST", "PATCH", "DELETE"] as const) {
    expect((await app.inject({
      method,
      url: `/api/admin/global-library/${asset.id}${method === "POST" ? "/add-to-session" : ""}`,
      headers: { cookie, origin: "http://evil.example", "x-simplevtt-session": generation },
      ...(method === "PATCH" ? { payload: { name: "Foreign" } } : {}),
    })).statusCode).toBe(403);
  }
  expect(await library()).toEqual([asset]);
});

it("rejects standalone images and malformed renames without creating a global entry", async () => {
  const image = await upload(png, "image", "Not audio.png");
  expect((await request("POST", `global-library/from-session/${image.id}`)).statusCode).toBe(400);
  expect(await library()).toEqual([]);
  const original = await upload();
  const { asset } = await transfer(`from-session/${original.id}`);
  for (const payload of [{ name: "" }, { name: "x".repeat(121) }, { name: "Valid", path: "../escape" }]) {
    expect((await request("PATCH", `global-library/${asset.id}`, payload)).statusCode).toBe(400);
  }
  expect(await library()).toEqual([asset]);
});

it("does not publish a partial sound when its custom icon file is missing", async () => {
  const effect = await upload(audio, "effect", "Missing icon.wav");
  const icon = await upload(png, "image", "Missing icon.png");
  await request("PUT", `soundboard/${effect.id}`, {
    group: "Dungeon", icon: "door-open", customIconAssetId: icon.id,
  });
  const sessionMedia = join(root, "default", "media");
  const imageFile = (await readdir(sessionMedia)).find((name) => name.endsWith(".png"));
  expect(imageFile).toBeTruthy();
  await rm(join(sessionMedia, imageFile!));
  const response = await request("POST", `global-library/from-session/${effect.id}`);
  expect([404, 503]).toContain(response.statusCode);
  expect(await library()).toEqual([]);
  expect(await readdir(join(globalDir, "media"))).toEqual([]);
  expect((await media(effect.id)).rawPayload).toEqual(audio);
  expect((await status()).error).toBeNull();
});
