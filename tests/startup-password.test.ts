import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server/app.js";
import {
  adminPasswordPath,
  loadAdminPassword,
  saveAdminPassword,
} from "../src/server/services/startup-password.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "vtt-password-"));
  roots.push(root);
  return root;
}
async function accepts(
  credential: Awaited<ReturnType<typeof loadAdminPassword>>,
  password: string,
) {
  const root = await directory();
  const app = await buildApp({
    dataDir: root,
    adminPassword: credential,
    logger: false,
  });
  try {
    return (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "http://localhost:80" },
        payload: { password },
      })
    ).statusCode;
  } finally {
    await app.close();
  }
}

test("first setup saves a hash outside the session and subsequent starts reuse it without prompting", async () => {
  const root = await directory();
  const file = join(root, "config", "admin-password.json");
  const credential = await saveAdminPassword(file, "x");
  expect(await accepts(credential, "x")).toBe(200);
  expect(await accepts(credential, "y")).toBe(401);
  const saved = await readFile(file, "utf8");
  expect(JSON.parse(saved)).not.toHaveProperty("password");
  expect(JSON.parse(saved).hash).not.toBe("x");
  if (process.platform !== "win32")
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  const restored = await loadAdminPassword(file);
  expect(await accepts(restored, "x")).toBe(200);
  expect(await readFile(file, "utf8")).toBe(saved);
});

test("environment password overrides saved configuration without replacing it", async () => {
  const root = await directory();
  const file = join(root, "admin-password.json");
  await saveAdminPassword(file, "saved-password");
  const before = await readFile(file, "utf8");
  const override = await loadAdminPassword(file, "override-password");
  expect(await accepts(override, "override-password")).toBe(200);
  expect(await accepts(override, "saved-password")).toBe(401);
  expect(await readFile(file, "utf8")).toBe(before);
});

test("missing configuration starts unconfigured without creating a password file", async () => {
  const root = await directory();
  const file = join(root, "admin-password.json");
  expect(await loadAdminPassword(file)).toBeNull();
  await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
});

test("corrupt configuration is not silently replaced", async () => {
  const root = await directory();
  const file = join(root, "admin-password.json");
  await writeFile(file, "broken");
  await expect(loadAdminPassword(file)).rejects.toThrow(/configuration/i);
  expect(await readFile(file, "utf8")).toBe("broken");
});

test("reports when configuration cannot be saved", async () => {
  const root = await directory();
  const parent = join(root, "not-a-folder");
  await writeFile(parent, "preserve");
  await expect(
    saveAdminPassword(join(parent, "admin-password.json"), "x"),
  ).rejects.toThrow(/save.*configuration/i);
  expect(await readFile(parent, "utf8")).toBe("preserve");
});

test("does not overwrite a configuration created by another setup", async () => {
  const root = await directory();
  const file = join(root, "admin-password.json");
  await writeFile(file, "another process");
  await expect(saveAdminPassword(file, "x")).rejects.toMatchObject({
    code: "EEXIST",
  });
  expect(await readFile(file, "utf8")).toBe("another process");
});

test("uses machine configuration locations on Linux, macOS and Windows", () => {
  expect(adminPasswordPath("linux", "/home/gm", {})).toBe(
    "/home/gm/.config/simple-vtt/admin-password.json",
  );
  expect(
    adminPasswordPath("linux", "/home/gm", { XDG_CONFIG_HOME: "/config" }),
  ).toBe("/config/simple-vtt/admin-password.json");
  expect(adminPasswordPath("darwin", "/Users/gm", {})).toBe(
    "/Users/gm/Library/Application Support/simple-vtt/admin-password.json",
  );
  expect(
    adminPasswordPath("win32", "C:\\Users\\GM", { APPDATA: "D:\\Settings" }),
  ).toBe("D:\\Settings\\simple-vtt\\admin-password.json");
});
