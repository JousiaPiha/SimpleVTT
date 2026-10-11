import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server/app.js";
import { openStore } from "../src/server/database/store.js";

let dir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
let effect: string;
let image: string;
let music: string;
const origin = "http://localhost:80";
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
  method: "PUT" | "GET" | "DELETE",
  url: string,
  payload?: object,
) => app.inject({ method, url, payload, headers: { cookie, origin } });
const settings = { group: "Combat", icon: "swords", customIconAssetId: null };
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vtt-soundboard-"));
  const store = openStore(dir);
  effect = store.addAsset({
    name: "Sword",
    category: "effect",
    mimeType: "audio/wav",
    relativePath: "sword.wav",
  }).id;
  music = store.addAsset({
    name: "Music",
    category: "music",
    mimeType: "audio/wav",
    relativePath: "music.wav",
  }).id;
  image = store.addAsset({
    name: "Custom",
    category: "image",
    mimeType: "image/png",
    relativePath: "custom.png",
  }).id;
  store.close();
  await start();
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("soundboard settings", () => {
  it("saves a trimmed group, library icon and custom image across restarts", async () => {
    expect((await admin("GET", "/api/admin/soundboard")).json()).toEqual([]);
    const result = await admin("PUT", `/api/admin/soundboard/${effect}`, {
      ...settings,
      group: "  Combat  ",
      customIconAssetId: image,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({
      ...settings,
      assetId: effect,
      customIconAssetId: image,
    });
    await app.close();
    await start();
    expect((await admin("GET", "/api/admin/soundboard")).json()).toEqual([
      result.json(),
    ]);
    expect(
      (
        await admin("PUT", `/api/admin/soundboard/${effect}`, {
          ...settings,
          group: "",
          icon: "volume-2",
        })
      ).json(),
    ).toEqual({ ...settings, assetId: effect, group: "", icon: "volume-2" });
  });
  it("rejects invalid icons, oversized groups, non-effect sounds and non-image icons", async () => {
    for (const patch of [
      { icon: "unknown" },
      { group: "x".repeat(61) },
      { customIconAssetId: music },
      { extra: true },
    ]) {
      expect(
        (
          await admin("PUT", `/api/admin/soundboard/${effect}`, {
            ...settings,
            ...patch,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (await admin("PUT", `/api/admin/soundboard/${music}`, settings))
        .statusCode,
    ).toBe(400);
    expect(
      (await admin("PUT", "/api/admin/soundboard/missing", settings))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await admin("PUT", `/api/admin/soundboard/${effect}`, {
          ...settings,
          customIconAssetId: "missing",
        })
      ).statusCode,
    ).toBe(404);
  });
  it("keeps settings and custom icons private", async () => {
    await admin("PUT", `/api/admin/soundboard/${effect}`, {
      ...settings,
      customIconAssetId: image,
    });
    expect(
      (await app.inject({ method: "GET", url: "/api/admin/soundboard" }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/admin/soundboard/${effect}`,
          headers: { origin },
          payload: settings,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: `/media/${image}` })).statusCode,
    ).toBe(404);
    const publicState = await app.inject({
      method: "GET",
      url: "/api/presentation",
    });
    expect(publicState.body).not.toContain(image);
    expect(publicState.body).not.toContain("Combat");
  });
  it("clears deleted custom icons, preserves the group and removes deleted sound settings", async () => {
    await admin("PUT", `/api/admin/soundboard/${effect}`, {
      ...settings,
      customIconAssetId: image,
    });
    expect(
      (await admin("GET", `/api/admin/assets/${image}/usage`)).json()
        .soundboardIconCount,
    ).toBe(1);
    expect(
      (await admin("DELETE", `/api/admin/assets/${image}`)).statusCode,
    ).toBe(204);
    expect((await admin("GET", "/api/admin/soundboard")).json()).toEqual([
      { ...settings, assetId: effect },
    ]);
    expect(
      (await admin("DELETE", `/api/admin/assets/${effect}`)).statusCode,
    ).toBe(204);
    expect((await admin("GET", "/api/admin/soundboard")).json()).toEqual([]);
  });
});
