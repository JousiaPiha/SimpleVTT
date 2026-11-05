import { afterEach, beforeEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server/app.js";
import type { SessionStatus } from "../src/shared/sessions.js";

let root: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
let generation: string;
const origin = "http://localhost:80";
const request = (
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  payload?: object,
  tag = generation,
) =>
  app.inject({
    method,
    url: `/api/admin/${path}`,
    payload,
    headers: { cookie, origin, "x-simplevtt-session": tag },
  });
const status = async () =>
  (await request("GET", "session")).json<SessionStatus>();
const perform = async (action: string, path?: string) => {
  expect(
    (await request("POST", "session/operations", { action, path })).statusCode,
  ).toBe(202);
  await expect.poll(async () => (await status()).busy).toBe(false);
  const result = await status();
  generation = result.generation;
  return result;
};
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "simple-vtt-session-api-"));
  app = await buildApp({
    dataDir: join(root, "default"),
    adminPassword: "x",
    logger: false,
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { password: "x" },
  });
  cookie = login.headers["set-cookie"]!.toString().split(";")[0];
  generation = "";
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

it("protects filesystem access and rejects a foreign-origin session command", async () => {
  expect((await app.inject("/api/admin/session")).statusCode).toBe(401);
  expect((await app.inject("/api/admin/session/folders")).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/admin/session/operations",
        headers: { cookie, origin: "http://evil.example" },
        payload: { action: "clear" },
      })
    ).statusCode,
  ).toBe(403);
  const info = await status();
  expect(info.active).toMatchObject({
    name: "Default Session",
    isDefault: true,
  });
});

it("copies a default draft, isolates stale writes, closes and reopens with players blank", async () => {
  generation = (await status()).generation;
  const scene = (await request("POST", "scenes", { name: "Original" })).json();
  await request("PUT", "presentation", { sceneId: scene.id });
  const destination = join(root, "Temple");
  await mkdir(destination);
  const oldGeneration = generation;
  const saved = await perform("save-as", destination);
  expect(saved.operation?.status).toBe("complete");
  expect(saved.active).toMatchObject({ name: "Temple", isDefault: false });
  expect(generation).not.toBe(oldGeneration);
  expect((await app.inject("/api/presentation")).json().scene).toBeNull();
  expect(
    (
      await request(
        "PATCH",
        `scenes/${scene.id}`,
        { name: "stale" },
        oldGeneration,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/admin/scenes",
        headers: { cookie, origin },
        payload: { name: "untagged stale" },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await request("PATCH", `scenes/${scene.id}`, { name: "Named edit" }))
      .statusCode,
  ).toBe(200);
  expect((await perform("close")).active?.isDefault).toBe(true);
  expect((await request("GET", "scenes")).json()[0].name).toBe("Original");
  expect((await perform("open", destination)).operation?.status).toBe(
    "complete",
  );
  expect((await request("GET", "scenes")).json()[0].name).toBe("Named edit");
  expect((await app.inject("/api/presentation")).json().scene).toBeNull();
  expect(
    (await request("PUT", "presentation", { sceneId: scene.id })).statusCode,
  ).toBe(200);
  expect((await app.inject("/api/presentation")).json().scene.id).toBe(
    scene.id,
  );
});

it("keeps presentation and active session after invalid open or nonempty Save As", async () => {
  generation = (await status()).generation;
  const scene = (await request("POST", "scenes", { name: "Stay" })).json();
  await request("PUT", "presentation", { sceneId: scene.id });
  const destination = join(root, "unrelated");
  await mkdir(destination);
  await writeFile(join(destination, ".keep"), "mine");
  for (const action of ["save-as", "open"]) {
    expect((await perform(action, destination)).operation?.status).toBe(
      "failed",
    );
    expect((await app.inject("/api/presentation")).json().scene.id).toBe(
      scene.id,
    );
    expect(await readdir(destination)).toEqual([".keep"]);
  }
});

it("excludes hidden media after copying and rejects old generation media URLs", async () => {
  generation = (await status()).generation;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VZsAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(join(root, "default/media/hero.png"), png);
  await request("POST", "assets/scan");
  const asset = (await request("GET", "assets")).json()[0];
  const oldGeneration = generation;
  const destination = join(root, "With media");
  await mkdir(destination);
  expect((await perform("save-as", destination)).operation?.status).toBe(
    "complete",
  );
  expect(
    (await app.inject(`/media/${asset.id}?session=${generation}`)).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: `/media/${asset.id}?session=${oldGeneration}`,
        headers: { cookie },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        url: `/media/${asset.id}?session=${generation}`,
        headers: { cookie },
      })
    ).rawPayload,
  ).toEqual(png);
  expect(await readFile(join(root, "default/media/hero.png"))).toEqual(png);
});

it("keeps the dashboard available if Default Session is invalid", async () => {
  await app.close();
  const bad = join(root, "invalid-default");
  await mkdir(bad);
  await writeFile(join(bad, "simple-vtt.sqlite"), "not sqlite");
  app = await buildApp({ dataDir: bad, adminPassword: "x", logger: false });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { password: "x" },
  });
  cookie = login.headers["set-cookie"]!.toString().split(";")[0];
  const result = await status();
  expect(result.active).toBeNull();
  expect(result.error).toBeTruthy();
  expect((await app.inject("/api/presentation")).json().scene).toBeNull();
  expect((await request("GET", "session/folders")).statusCode).toBe(200);
  expect(await readFile(join(bad, "simple-vtt.sqlite"), "utf8")).toBe(
    "not sqlite",
  );
});
