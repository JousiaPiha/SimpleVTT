import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import type { WebSocket } from "ws";
import { buildApp } from "../src/server/app.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;
let cookie: string;
let sceneId: string;
const origin = "http://localhost:80";
const headers = () => ({ origin, host: "localhost", cookie });
const receive = (socket: WebSocket) =>
  new Promise<unknown>((resolve) =>
    socket.once("message", (data) => resolve(JSON.parse(data.toString()))),
  );
const connect = (path: string) =>
  app.injectWS(path, { socket: new Socket(), headers: headers() });
const present = (id: string | null) =>
  app.inject({
    method: "PUT",
    url: "/api/admin/presentation",
    headers: headers(),
    payload: { sceneId: id },
  });
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "simple-vtt-laser-"));
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
  sceneId = (
    await app.inject({
      method: "POST",
      url: "/api/admin/scenes",
      headers: headers(),
      payload: { name: "Laser scene" },
    })
  ).json().id;
  await present(sceneId);
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

it("broadcasts transient coordinates to all players, clears on release and disconnect, and never saves a pointer", async () => {
  const player = await connect("/ws/player");
  const other = await connect("/ws/player");
  const gm = await connect("/ws/admin/laser");
  const before = (await app.inject("/api/presentation")).json();
  const point = { sceneId, x: 960, y: 540 };
  const first = receive(player),
    second = receive(other);
  gm.send(JSON.stringify({ type: "laser.update", pointer: point }));
  expect(await first).toEqual({ type: "laser.updated", pointer: point });
  expect(await second).toEqual({ type: "laser.updated", pointer: point });
  expect((await app.inject("/api/presentation")).json()).toEqual(before);
  const hide = receive(player);
  gm.send(JSON.stringify({ type: "laser.update", pointer: null }));
  expect(await hide).toEqual({ type: "laser.updated", pointer: null });
  const again = receive(player);
  gm.send(JSON.stringify({ type: "laser.update", pointer: point }));
  await again;
  const gone = receive(player);
  gm.close();
  expect(await gone).toEqual({ type: "laser.updated", pointer: null });
  player.close();
  other.close();
});

it("rejects unauthenticated and cross-origin controllers and invalid coordinates", async () => {
  await expect(
    app.injectWS("/ws/admin/laser", {
      socket: new Socket(),
      headers: { origin, host: "localhost" },
    }),
  ).rejects.toThrow();
  await expect(
    app.injectWS("/ws/admin/laser", {
      socket: new Socket(),
      headers: { ...headers(), origin: "http://evil.example" },
    }),
  ).rejects.toThrow();
  const gm = await connect("/ws/admin/laser");
  const closed = new Promise<number>((resolve) => gm.once("close", resolve));
  gm.send(
    JSON.stringify({
      type: "laser.update",
      pointer: { sceneId, x: 1921, y: 20 },
    }),
  );
  expect(await closed).toBe(1008);
});

it("clears on scene changes and expires a lost controller", async () => {
  const player = await connect("/ws/player");
  const gm = await connect("/ws/admin/laser");
  const show = receive(player);
  gm.send(
    JSON.stringify({
      type: "laser.update",
      pointer: { sceneId, x: 100, y: 200 },
    }),
  );
  await show;
  const expired = receive(player);
  expect(await expired).toEqual({ type: "laser.updated", pointer: null });
  const showAgain = receive(player);
  gm.send(
    JSON.stringify({
      type: "laser.update",
      pointer: { sceneId, x: 100, y: 200 },
    }),
  );
  await showAgain;
  const clear = receive(player);
  await present(null);
  expect(await clear).toEqual({ type: "laser.updated", pointer: null });
  const closed = new Promise<number>((resolve) => gm.once("close", resolve));
  gm.send(
    JSON.stringify({
      type: "laser.update",
      pointer: { sceneId, x: 100, y: 200 },
    }),
  );
  expect(await closed).toBe(1008);
  player.close();
});

it("rechecks authentication after logout and keeps player sockets read-only", async () => {
  const gm = await connect("/ws/admin/laser");
  await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: headers(),
  });
  const closed = new Promise<number>((resolve) => gm.once("close", resolve));
  gm.send(
    JSON.stringify({
      type: "laser.update",
      pointer: { sceneId, x: 10, y: 10 },
    }),
  );
  expect(await closed).toBe(1008);
  const player = await connect("/ws/player");
  const readOnly = new Promise<number>((resolve) =>
    player.once("close", resolve),
  );
  player.send(
    JSON.stringify({
      type: "laser.update",
      pointer: { sceneId, x: 10, y: 10 },
    }),
  );
  expect(await readOnly).toBe(1008);
});
