import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server/app.js";
import {
  applyPresentation,
  presentationEventSchema,
} from "../src/shared/contracts.js";
import { diffPresentation } from "../src/server/services/presentation.js";
let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;
let cookie: string;
const origin = "http://localhost:80";
const headers = () => ({ cookie, origin });
const input = {
  type: "freehand",
  color: "#ffcc00",
  width: 5,
  points: [100, 200, 300, 400],
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "simple-vtt-drawing-"));
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
  cookie = login.headers["set-cookie"]!.toString().split(";")[0];
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});
const scene = async () =>
  (
    await app.inject({
      method: "POST",
      url: "/api/admin/scenes",
      headers: headers(),
      payload: { name: "Drawing scene" },
    })
  ).json();
const publicState = async () =>
  (await app.inject("/api/presentation")).json().scene;

it("persists all drawing types, isolates preparation, syncs additions/removals", async () => {
  const s = await scene();
  expect(s.drawings).toEqual([]);
  for (const type of ["freehand", "oval", "rectangle"]) {
    const created = await app.inject({
      method: "POST",
      url: `/api/admin/scenes/${s.id}/drawings`,
      headers: headers(),
      payload: { ...input, type },
    });
    expect(created.statusCode).toBe(201);
  }
  expect(await publicState()).toBeNull();
  await app.inject({
    method: "PUT",
    url: "/api/admin/presentation",
    headers: headers(),
    payload: { sceneId: s.id },
  });
  const before = await publicState();
  expect(before.drawings.map((d: { type: string }) => d.type)).toEqual([
    "freehand",
    "oval",
    "rectangle",
  ]);
  const privateScene = await scene();
  await app.inject({
    method: "POST",
    url: `/api/admin/scenes/${privateScene.id}/drawings`,
    headers: headers(),
    payload: input,
  });
  expect(await publicState()).toEqual(before);
  await app.inject({
    method: "DELETE",
    url: `/api/admin/scenes/${privateScene.id}/drawings/${before.drawings[0].id}`,
    headers: headers(),
  });
  expect(await publicState()).toEqual(before);
  await app.inject({
    method: "DELETE",
    url: `/api/admin/scenes/${s.id}/drawings/${before.drawings[0].id}`,
    headers: headers(),
  });
  const after = await publicState();
  const delta = presentationEventSchema.parse(diffPresentation(before, after));
  expect(delta).toMatchObject({
    drawingRemoved: [before.drawings[0].id],
    drawingUpserts: [],
  });
  expect(applyPresentation(before, delta)).toEqual(after);
  const addDelta = presentationEventSchema.parse(
    diffPresentation(after, before),
  );
  expect(applyPresentation(after, addDelta)?.drawings).toHaveLength(3);
  await app.close();
  app = await buildApp({
    dataDir: dir,
    adminPassword: "test-password-123",
    logger: false,
  });
  expect(await publicState()).toEqual(after);
});
it("rejects unauthorized writes and malformed geometry", async () => {
  const s = await scene();
  const url = `/api/admin/scenes/${s.id}/drawings`;
  expect(
    (await app.inject({ method: "POST", url, payload: input })).statusCode,
  ).toBe(401);
  expect(
    (await app.inject({ method: "DELETE", url: url + "/anything" })).statusCode,
  ).toBe(401);
  for (const invalid of [
    { points: [1, 2, 3] },
    { points: [0, 1081, 20, 30] },
    { type: "oval", points: [1, 2, 3, 4, 5, 6] },
    { width: 100 },
    { color: "red" },
    { points: Array(4098).fill(1) },
    { sceneId: "other" },
  ])
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: headers(),
          payload: { ...input, ...invalid },
        })
      ).statusCode,
    ).toBe(400);
});
