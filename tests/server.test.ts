import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Socket } from "node:net";
import { join } from "node:path";
import { buildApp } from "../src/server/app.js";

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
async function scene() {
  return (
    await admin("POST", "/api/admin/scenes", { name: "Secret preparations" })
  ).json();
}
async function asset(name = "sprite.png") {
  await writeFile(join(dir, "media", name), png);
  const scanned = await admin("POST", "/api/admin/assets/scan");
  expect(scanned.statusCode).toBe(200);
  return (await admin("GET", "/api/admin/assets"))
    .json()
    .find((a: { name: string }) => a.name === name);
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "simple-vtt-test-"));
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
  expect(login.statusCode).toBe(200);
  cookie = login.headers["set-cookie"]!.toString().split(";")[0];
});
afterEach(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("private editor and public presentation", () => {
  it("allows a one-character admin password and still requires the correct password", async () => {
    await app.close();
    app = await buildApp({ dataDir: dir, adminPassword: "x", logger: false });
    for (const [password, expectedStatus] of [
      ["", 400],
      ["y", 401],
      ["x", 200],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin },
        payload: { password },
      });
      expect(response.statusCode).toBe(expectedStatus);
      if (expectedStatus === 200) {
        const shortPasswordCookie = response.headers["set-cookie"]!
          .toString().split(";")[0];
        expect(
          (await app.inject({
            url: "/api/admin/scenes",
            headers: { cookie: shortPasswordCookie },
          })).statusCode,
        ).toBe(200);
      }
    }
  });
  it("still rejects an empty configured admin password", async () => {
    await expect(
      buildApp({ dataDir: dir, adminPassword: "", logger: false }),
    ).rejects.toThrow("ADMIN_PASSWORD must not be empty");
  });
  it("rejects unauthenticated admin access and hostile origins", async () => {
    expect((await app.inject("/api/admin/scenes")).statusCode).toBe(401);
    expect((await app.inject("/api/admin/assets")).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/scenes",
          headers: { cookie, origin: "http://evil.example" },
          payload: { name: "bad" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/scenes",
          headers: { cookie },
          payload: { name: "bad" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin },
          payload: { password: "wrong" },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("persists scenes and live state and never exposes hidden objects or assets", async () => {
    const s = await scene();
    const a = await asset();
    const created = await admin("POST", `/api/admin/scenes/${s.id}/objects`, {
      assetId: a.id,
      name: "Ambush",
    });
    expect(created.statusCode).toBe(201);
    const object = created.json();
    await admin("PUT", "/api/admin/presentation", { sceneId: s.id });
    let state = (await app.inject("/api/presentation")).json();
    expect(state.scene.objects).toEqual([]);
    expect(JSON.stringify(state)).not.toMatch(/Ambush|Secret preparations/);
    expect((await app.inject(`/media/${a.id}`)).statusCode).toBe(404);
    expect((await admin("GET", `/media/${a.id}`)).statusCode).toBe(200);
    await admin("PATCH", `/api/admin/scenes/${s.id}/objects/${object.id}`, {
      visible: true,
      x: 321,
      y: 432,
      scale: 1.5,
    });
    state = (await app.inject("/api/presentation")).json();
    expect(state.scene.objects[0]).toMatchObject({
      x: 321,
      y: 432,
      scale: 1.5,
    });
    expect((await app.inject(`/media/${a.id}`)).statusCode).toBe(200);
    await app.close();
    app = await buildApp({
      dataDir: dir,
      adminPassword: "test-password-123",
      logger: false,
    });
    expect((await app.inject("/api/presentation")).json()).toEqual(state);
    expect((await admin("GET", "/api/admin/scenes")).statusCode).toBe(401);
  });
  it("scans nested images, ignores symlinks and unsupported content, and deduplicates", async () => {
    await mkdir(join(dir, "media", "sprites"));
    await writeFile(join(dir, "media", "sprites", "hero.png"), png);
    await writeFile(join(dir, "media", "fake.png"), "<script>private</script>");
    await symlink(
      join(dir, "media", "sprites", "hero.png"),
      join(dir, "media", "link.png"),
    );
    await admin("POST", "/api/admin/assets/scan");
    await admin("POST", "/api/admin/assets/scan");
    const assets = (await admin("GET", "/api/admin/assets")).json();
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ name: "hero.png", category: "sprite" });
    expect(assets[0]).not.toHaveProperty("relativePath");
  });
  it("validates upload bytes, preserves valid image bytes, and rejects symlink escapes", async () => {
    const upload = async (bytes: Buffer, filename: string) => {
      const boundary = "simple-vtt-test-boundary";
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return app.inject({
        method: "POST",
        url: "/api/admin/assets?category=sprite",
        headers: {
          cookie,
          origin,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
    };
    expect(
      (
        await upload(
          Buffer.from("<svg><script>bad()</script></svg>"),
          "fake.png",
        )
      ).statusCode,
    ).toBe(415);
    const result = await upload(png, "../../hero.png");
    expect(result.statusCode).toBe(201);
    const a = result.json();
    expect(a).not.toHaveProperty("relativePath");
    expect((await admin("GET", `/media/${a.id}`)).rawPayload).toEqual(png);
    const outside = join(dir, "outside.png");
    await writeFile(outside, png);
    const scanned = await asset("swap.png");
    await rm(join(dir, "media", "swap.png"));
    await symlink(outside, join(dir, "media", "swap.png"));
    expect((await admin("GET", `/media/${scanned.id}`)).statusCode).toBe(404);
    expect((await admin("GET", "/media/..%2Foutside.png")).statusCode).toBe(
      404,
    );
  });
  it("restores the current public snapshot on reconnect and closes attempted socket mutations", async () => {
    const s = await scene();
    const a = await asset();
    const o = (
      await admin("POST", `/api/admin/scenes/${s.id}/objects`, {
        assetId: a.id,
        name: "Secret label",
      })
    ).json();
    await admin("PUT", "/api/admin/presentation", { sceneId: s.id });
    const connect = async () => {
      const messages: unknown[] = [];
      const socket = await app.injectWS(
        "/ws/player",
        { socket: new Socket(), headers: { origin, host: "localhost" } },
        {
          onInit: (ws) =>
            ws.on("message", (data) =>
              messages.push(JSON.parse(data.toString())),
            ),
        },
      );
      return { socket, messages };
    };
    const first = await connect();
    expect(first.messages[0]).toMatchObject({
      type: "presentation.snapshot",
      scene: { objects: [] },
    });
    first.socket.terminate();
    await admin("PATCH", `/api/admin/scenes/${s.id}/objects/${o.id}`, {
      visible: true,
      x: 740,
    });
    const fresh = await connect();
    expect(fresh.messages[0]).toMatchObject({
      type: "presentation.snapshot",
      scene: { objects: [{ id: o.id, x: 740 }] },
    });
    expect(JSON.stringify(fresh.messages)).not.toContain("Secret label");
    const closed = new Promise<number>((resolve) =>
      fresh.socket.once("close", resolve),
    );
    fresh.socket.send(
      JSON.stringify({ type: "object.update", id: o.id, x: 999 }),
    );
    expect(await closed).toBe(1008);
    expect(
      (await app.inject("/api/presentation")).json().scene.objects[0].x,
    ).toBe(740);
  });
  it("validates mutations and keeps prepared scene selection separate from presenting", async () => {
    const s = await scene();
    expect((await app.inject("/api/presentation")).json().scene).toBeNull();
    expect(
      (
        await admin("PATCH", `/api/admin/scenes/${s.id}`, {
          backgroundAssetId: "missing",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await admin("PATCH", `/api/admin/scenes/${s.id}`, { name: "" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await admin("POST", `/api/admin/scenes/${s.id}/objects`, {
          assetId: "../../etc/passwd",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await admin("DELETE", "/api/admin/scenes/missing")).statusCode,
    ).toBe(404);
  });
  it("checks websocket origins and sends snapshots followed by public deltas to every observer", async () => {
    const s = await scene();
    const a = await asset();
    const o = (
      await admin("POST", `/api/admin/scenes/${s.id}/objects`, {
        assetId: a.id,
        name: "private",
      })
    ).json();
    await admin("PUT", "/api/admin/presentation", { sceneId: s.id });
    await app.ready();
    const first = await app.injectWS("/ws/player", {
      socket: new Socket(),
      headers: { origin, host: "localhost" },
    });
    const second = await app.injectWS("/ws/player", {
      socket: new Socket(),
      headers: { origin, host: "localhost" },
    });
    const receive = (socket: typeof first) =>
      new Promise<object>((resolve) =>
        socket.once("message", (data) => resolve(JSON.parse(data.toString()))),
      );
    const one = receive(first);
    const two = receive(second);
    await admin("PATCH", `/api/admin/scenes/${s.id}/objects/${o.id}`, {
      visible: true,
    });
    expect(await one).toMatchObject({
      type: "presentation.patch",
      upserts: [{ id: o.id }],
    });
    expect(await two).toMatchObject({
      type: "presentation.patch",
      upserts: [{ id: o.id }],
    });
    const hide = receive(first);
    await admin("PATCH", `/api/admin/scenes/${s.id}/objects/${o.id}`, {
      visible: false,
    });
    expect(await hide).toMatchObject({
      type: "presentation.patch",
      removed: [o.id],
      upserts: [],
    });
    first.close();
    second.close();
    await expect(
      app.injectWS("/ws/player", {
        headers: { origin: "http://evil.example" },
      }),
    ).rejects.toThrow();
  });
});

describe("scene grid", () => {
  it("starts disabled, validates settings, and persists the live grid across restart", async () => {
    const prepared = await scene();
    expect(prepared).toMatchObject({
      gridEnabled: false,
      gridSize: 80,
      gridColor: "#ffffff",
    });
    for (const patch of [
      { gridSize: 0 },
      { gridSize: 401 },
      { gridSize: 20.5 },
      { gridColor: "red" },
      { gridEnabled: "yes" },
    ]) {
      expect(
        (await admin("PATCH", `/api/admin/scenes/${prepared.id}`, patch))
          .statusCode,
      ).toBe(400);
    }
    const grid = { gridEnabled: true, gridSize: 120, gridColor: "#33aaff" };
    expect(
      (await admin("PATCH", `/api/admin/scenes/${prepared.id}`, grid)).json(),
    ).toMatchObject(grid);
    expect(
      (
        await admin("PATCH", `/api/admin/scenes/${prepared.id}`, {
          name: "Renamed",
        })
      ).json(),
    ).toMatchObject(grid);
    await admin("PUT", "/api/admin/presentation", { sceneId: prepared.id });
    expect((await app.inject("/api/presentation")).json().scene).toMatchObject(
      grid,
    );
    await app.close();
    app = await buildApp({
      dataDir: dir,
      adminPassword: "test-password-123",
      logger: false,
    });
    expect((await app.inject("/api/presentation")).json().scene).toMatchObject(
      grid,
    );
  });
  it("keeps a prepared scene's grid separate from the live scene", async () => {
    const live = await scene();
    const prepared = await scene();
    await admin("PUT", "/api/admin/presentation", { sceneId: live.id });
    await admin("PATCH", `/api/admin/scenes/${prepared.id}`, {
      gridEnabled: true,
      gridSize: 40,
      gridColor: "#ff0000",
    });
    expect(
      (await app.inject("/api/presentation")).json().scene.gridEnabled,
    ).toBe(false);
  });
});
