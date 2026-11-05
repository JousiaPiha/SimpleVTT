import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server/app.js";
import { loadAdminPassword } from "../src/server/services/startup-password.js";

const origin = "http://localhost:80";
let root: string;
let file: string;
let app: Awaited<ReturnType<typeof buildApp>>;
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vtt-web-password-"));
  file = join(root, "config", "admin-password.json");
  app = await buildApp({
    dataDir: join(root, "data"),
    adminPassword: null,
    adminPasswordFile: file,
    logger: false,
  });
  apps.push(app);
});
afterEach(async () => {
  for (const instance of apps.splice(0)) await instance.close();
  if (root) await rm(root, { recursive: true, force: true });
});
const setup = (password = "x", confirmation = password) =>
  app.inject({
    method: "POST",
    url: "/api/auth/setup",
    headers: { origin },
    payload: { password, confirmation },
  });

test("starts without a password but keeps administration locked until setup", async () => {
  expect((await app.inject("/api/auth/session")).json()).toEqual({
    authenticated: false,
    setupRequired: true,
  });
  expect((await app.inject("/api/admin/scenes")).statusCode).toBe(401);
  expect((await app.inject("/api/presentation")).json().scene).toBeNull();
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin },
        payload: { password: "x" },
      })
    ).statusCode,
  ).toBe(409);
  await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
});

test("validates confirmation, nonempty passwords and request origin without saving", async () => {
  expect((await setup("", "")).statusCode).toBe(400);
  expect((await setup("x", "y")).statusCode).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/setup",
        headers: { origin: "http://elsewhere.test" },
        payload: { password: "x", confirmation: "x" },
      })
    ).statusCode,
  ).toBe(403);
  expect((await app.inject("/api/auth/session")).json().setupRequired).toBe(
    true,
  );
  await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
});

test("setup saves the hash, signs in, survives restart, and cannot reset the password", async () => {
  const response = await setup();
  expect(response.statusCode).toBe(201);
  const cookie = response.headers["set-cookie"]!.toString().split(";")[0];
  expect(
    (await app.inject({ url: "/api/admin/scenes", headers: { cookie } }))
      .statusCode,
  ).toBe(200);
  const saved = await readFile(file, "utf8");
  expect(JSON.parse(saved)).not.toHaveProperty("password");
  expect(JSON.parse(saved).hash).toMatch(/^[0-9a-f]{128}$/);
  expect((await setup("replacement")).statusCode).toBe(409);
  expect(await readFile(file, "utf8")).toBe(saved);
  await app.close();
  apps.pop();
  app = await buildApp({
    dataDir: join(root, "data"),
    adminPassword: await loadAdminPassword(file),
    adminPasswordFile: file,
    logger: false,
  });
  apps.push(app);
  expect((await app.inject("/api/auth/session")).json()).toEqual({
    authenticated: false,
    setupRequired: false,
  });
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin },
        payload: { password: "x" },
      })
    ).statusCode,
  ).toBe(200);
});

test("concurrent setup requests choose one password and never replace it", async () => {
  const responses = await Promise.all([setup("first"), setup("second")]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  const winner = responses[0].statusCode === 201 ? "first" : "second";
  const loser = winner === "first" ? "second" : "first";
  for (const [password, statusCode] of [
    [winner, 200],
    [loser, 401],
  ] as const)
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin },
          payload: { password },
        })
      ).statusCode,
    ).toBe(statusCode);
});

test("failed persistence leaves setup available and does not authenticate", async () => {
  await writeFile(join(root, "config"), "blocked");
  const failed = await setup();
  expect(failed.statusCode).toBe(500);
  expect(failed.headers["set-cookie"]).toBeUndefined();
  expect(failed.json().error).toMatch(/save.*password/i);
  expect((await app.inject("/api/auth/session")).json().setupRequired).toBe(
    true,
  );
  await rm(join(root, "config"));
  expect((await setup()).statusCode).toBe(201);
});

test("a second server observes setup completed by another process without overwriting it", async () => {
  const second = await buildApp({
    dataDir: join(root, "other-data"),
    adminPassword: null,
    adminPasswordFile: file,
    logger: false,
  });
  apps.push(second);
  expect((await setup("first")).statusCode).toBe(201);
  const response = await second.inject({
    method: "POST",
    url: "/api/auth/setup",
    headers: { origin },
    payload: { password: "second", confirmation: "second" },
  });
  expect(response.statusCode).toBe(409);
  expect((await second.inject("/api/auth/session")).json().setupRequired).toBe(
    false,
  );
  expect(
    (
      await second.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin },
        payload: { password: "first" },
      })
    ).statusCode,
  ).toBe(200);
});
