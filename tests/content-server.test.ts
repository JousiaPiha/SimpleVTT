import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import Database from "better-sqlite3";
import { buildApp } from "../src/server/app.js";
import { contentDefaults, sceneContentSchema } from "../src/shared/content.js";
import {
  applyPresentation,
  presentationEventSchema,
} from "../src/shared/contracts.js";

const origin = "http://localhost:80";
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
async function scene() {
  return (
    await admin("POST", "/api/admin/scenes", { name: "Private scene" })
  ).json() as { id: string };
}
async function create(sceneId: string, type: "text" | "loot") {
  const response = await admin("POST", `/api/admin/scenes/${sceneId}/content`, {
    ...contentDefaults(type),
    name: "GM secret label",
    ...(type === "text"
      ? { text: "Hidden prophecy" }
      : {
          title: "Hidden treasure",
          items: [{ name: "Secret ruby", quantity: 3, description: "Cursed" }],
        }),
  });
  expect(response.statusCode).toBe(201);
  return sceneContentSchema.parse(response.json());
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vtt-content-"));
  await start();
});
afterEach(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("scene text and loot backend", () => {
  it("keeps hidden text and loot out of HTTP and socket snapshots and publishes only visible changes", async () => {
    const s = await scene();
    const text = await create(s.id, "text");
    const loot = await create(s.id, "loot");
    await admin("PUT", "/api/admin/presentation", { sceneId: s.id });
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
    const snapshot = (await app.inject("/api/presentation")).json();
    expect(snapshot.scene.content).toEqual([]);
    expect(messages[0]).toEqual(snapshot);
    await admin("PATCH", `/api/admin/scenes/${s.id}/content/${text.id}`, {
      text: "Hidden revision",
    });
    expect(JSON.stringify(messages)).not.toMatch(
      /Hidden|Secret ruby|Cursed|GM secret/,
    );
    expect(messages).toHaveLength(1);
    let current = presentationEventSchema.parse(snapshot);
    let displayed =
      current.type === "presentation.snapshot" ? current.scene : null;
    const mutate = async (
      id: string,
      method: "PATCH" | "DELETE",
      payload?: object,
    ) => {
      const received = new Promise<unknown>((resolve) =>
        socket.once("message", (data) => resolve(JSON.parse(data.toString()))),
      );
      const result = await admin(
        method,
        `/api/admin/scenes/${s.id}/content/${id}`,
        payload,
      );
      expect(result.statusCode).toBe(method === "DELETE" ? 204 : 200);
      current = presentationEventSchema.parse(await received);
      displayed = applyPresentation(displayed, current);
      expect(displayed).toEqual(
        (await app.inject("/api/presentation")).json().scene,
      );
      expect(JSON.stringify(current)).not.toContain("GM secret label");
      return current;
    };
    expect(await mutate(text.id, "PATCH", { visible: true })).toMatchObject({
      type: "presentation.patch",
      upserts: [],
      contentUpserts: [{ id: text.id, text: "Hidden revision" }],
      contentRemoved: [],
    });
    expect(displayed?.content[0]).not.toHaveProperty("sceneId");
    expect(displayed?.content[0]).not.toHaveProperty("visible");
    expect(await mutate(loot.id, "PATCH", { visible: true })).toMatchObject({
      contentUpserts: [
        { id: loot.id, items: [{ name: "Secret ruby", quantity: 3 }] },
      ],
    });
    expect(
      await mutate(text.id, "PATCH", { text: "Revealed revision", x: 700 }),
    ).toMatchObject({
      contentUpserts: [{ text: "Revealed revision", x: 700 }],
    });
    expect(
      await mutate(loot.id, "PATCH", {
        items: [{ name: "Silver", quantity: 8, description: "Coins" }],
        page: 1,
      }),
    ).toMatchObject({
      contentUpserts: [{ page: 1, items: [{ name: "Silver" }] }],
    });
    expect(await mutate(text.id, "PATCH", { visible: false })).toMatchObject({
      contentUpserts: [],
      contentRemoved: [text.id],
    });
    expect(await mutate(loot.id, "DELETE")).toMatchObject({
      contentUpserts: [],
      contentRemoved: [loot.id],
    });
    socket.terminate();
    const reconnected: unknown[] = [];
    const next = await app.injectWS(
      "/ws/player",
      { socket: new Socket(), headers: { origin, host: "localhost" } },
      {
        onInit: (ws) =>
          ws.on("message", (data) =>
            reconnected.push(JSON.parse(data.toString())),
          ),
      },
    );
    expect(reconnected[0]).toEqual({
      type: "presentation.snapshot",
      scene: displayed,
    });
    expect(JSON.stringify(reconnected)).not.toMatch(
      /Hidden|Revealed revision|Silver|GM secret/,
    );
    next.terminate();
  });

  it("validates merged content types, immutable identity, limits and scene ownership without partial writes", async () => {
    const s = await scene();
    const other = await scene();
    const text = await create(s.id, "text");
    const loot = await create(s.id, "loot");
    for (const patch of [
      { items: [] },
      { title: "Wrong type" },
      { page: 1 },
      { type: "loot" },
      { id: "replace" },
      { sceneId: other.id },
      { color: "red" },
      { x: 20000 },
      { text: "a".repeat(4001) },
    ]) {
      expect(
        (
          await admin(
            "PATCH",
            `/api/admin/scenes/${s.id}/content/${text.id}`,
            patch,
          )
        ).statusCode,
      ).toBe(400);
    }
    for (const patch of [
      { text: "Wrong type" },
      { items: [{ name: "Gold", quantity: 0, description: "" }] },
      { page: -1 },
    ]) {
      expect(
        (
          await admin(
            "PATCH",
            `/api/admin/scenes/${s.id}/content/${loot.id}`,
            patch,
          )
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await admin("POST", `/api/admin/scenes/${s.id}/content`, {
          ...contentDefaults("text"),
          visible: "yes",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await admin(
          "POST",
          "/api/admin/scenes/missing/content",
          contentDefaults("text"),
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await admin(
          "PATCH",
          `/api/admin/scenes/${other.id}/content/${text.id}`,
          { visible: true },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await admin(
          "DELETE",
          `/api/admin/scenes/${other.id}/content/${text.id}`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await admin("GET", `/api/admin/scenes/${s.id}`)).json().content,
    ).toEqual([text, loot]);
  });

  it("requires authentication and same-origin authorization on content mutations", async () => {
    const s = await scene();
    const text = await create(s.id, "text");
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      const url = `/api/admin/scenes/${s.id}/content${method === "POST" ? "" : `/${text.id}`}`;
      const payload =
        method === "DELETE"
          ? undefined
          : method === "POST"
            ? contentDefaults("text")
            : { visible: true };
      expect(
        (await app.inject({ method, url, payload, headers: { origin } }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method,
            url,
            payload,
            headers: { cookie, origin: "http://evil.example" },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect((await app.inject(`/api/admin/scenes/${s.id}`)).statusCode).toBe(
      401,
    );
  });

  it("persists prepared content and presentation across restart and cascades scene deletion", async () => {
    const s = await scene();
    const text = await create(s.id, "text");
    const loot = await create(s.id, "loot");
    await admin("PATCH", `/api/admin/scenes/${s.id}/content/${text.id}`, {
      visible: true,
      x: 820,
    });
    await admin("PUT", "/api/admin/presentation", { sceneId: s.id });
    await app.close();
    await start();
    expect(
      (await admin("GET", `/api/admin/scenes/${s.id}`)).json().content,
    ).toEqual([{ ...text, visible: true, x: 820 }, loot]);
    expect(
      (await app.inject("/api/presentation")).json().scene.content,
    ).toMatchObject([{ id: text.id, x: 820 }]);
    expect(
      (await admin("DELETE", `/api/admin/scenes/${s.id}`)).statusCode,
    ).toBe(204);
    expect((await app.inject("/api/presentation")).json().scene).toBeNull();
    const sqlite = new Database(join(dir, "simple-vtt.sqlite"), {
      readonly: true,
    });
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM scene_content").get(),
    ).toEqual({ count: 0 });
    sqlite.close();
  });

  it("adds content storage to a phase-two database while preserving scenes, assets and playlists", async () => {
    await app.close();
    await rm(join(dir, "simple-vtt.sqlite"));
    const sqlite = new Database(join(dir, "simple-vtt.sqlite"));
    for (const file of ["0000_boring_randall", "0001_shocking_dorian_gray"])
      sqlite.exec(
        (await readFile(`drizzle/${file}.sql`, "utf8")).replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      );
    sqlite.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric); INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('old', 1791565086258); INSERT INTO assets VALUES ('image', 'Old image', 'sprite', 'old.png', 'image/png'); INSERT INTO scenes VALUES ('scene', 'Old scene', 'image', 1, 1); INSERT INTO presentation VALUES (1, 'scene'); INSERT INTO playlists VALUES ('playlist', 'Old playlist');",
    );
    sqlite.close();
    await start();
    expect(
      (await admin("GET", "/api/admin/scenes/scene")).json(),
    ).toMatchObject({
      name: "Old scene",
      content: [],
      backgroundAssetId: "image",
    });
    expect((await admin("GET", "/api/admin/playlists")).json()).toEqual([
      { id: "playlist", name: "Old playlist", trackIds: [] },
    ]);
    await create("scene", "text");
    expect((await app.inject("/api/presentation")).json().scene).toMatchObject({
      id: "scene",
      backgroundAssetId: "image",
      content: [],
    });
  });
});
