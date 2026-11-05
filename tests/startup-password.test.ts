import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { buildApp } from "../src/server/app.js";
import {
  adminPasswordPath,
  loadAdminPassword,
  promptForAdminPassword,
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
  const credential = await loadAdminPassword(file, undefined, async () => "x");
  expect(await accepts(credential, "x")).toBe(200);
  expect(await accepts(credential, "y")).toBe(401);
  const saved = await readFile(file, "utf8");
  expect(JSON.parse(saved)).not.toHaveProperty("password");
  expect(JSON.parse(saved).hash).not.toBe("x");
  if (process.platform !== "win32")
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  const restored = await loadAdminPassword(file, undefined, async () => {
    throw new Error("Should use saved configuration");
  });
  expect(await accepts(restored, "x")).toBe(200);
  expect(await readFile(file, "utf8")).toBe(saved);
});

test("environment password overrides saved configuration without replacing it", async () => {
  const root = await directory();
  const file = join(root, "admin-password.json");
  await loadAdminPassword(file, undefined, async () => "saved-password");
  const before = await readFile(file, "utf8");
  const override = await loadAdminPassword(
    file,
    "override-password",
    async () => {
      throw new Error("No prompt expected");
    },
  );
  expect(await accepts(override, "override-password")).toBe(200);
  expect(await accepts(override, "saved-password")).toBe(401);
  expect(await readFile(file, "utf8")).toBe(before);
});

test("corrupt configuration and cancellation do not silently replace a password", async () => {
  const root = await directory();
  const file = join(root, "admin-password.json");
  await writeFile(file, "broken");
  await expect(
    loadAdminPassword(file, undefined, async () => "replacement"),
  ).rejects.toThrow(/configuration/i);
  expect(await readFile(file, "utf8")).toBe("broken");
  await rm(file);
  await expect(
    loadAdminPassword(file, undefined, async () => {
      throw new Error("Password setup cancelled");
    }),
  ).rejects.toThrow(/cancelled/i);
  await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
});

test("refuses to start if configuration cannot be saved", async () => {
  const root = await directory();
  const parent = join(root, "not-a-folder");
  await expect(
    loadAdminPassword(
      join(parent, "admin-password.json"),
      undefined,
      async () => {
        await writeFile(parent, "preserve");
        return "x";
      },
    ),
  ).rejects.toThrow(/save.*configuration/i);
  expect(await readFile(parent, "utf8")).toBe("preserve");
});

test("does not overwrite a configuration created while the prompt was open", async () => {
  const root = await directory();
  const file = join(root, "admin-password.json");
  await expect(
    loadAdminPassword(file, undefined, async () => {
      await writeFile(file, "another process");
      return "x";
    }),
  ).rejects.toThrow();
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

function terminal(answers: string[]) {
  let raw = false;
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (value: boolean) => {
      raw = value;
    },
  });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  let transcript = "";
  output.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    transcript += text;
    if (text.endsWith(": ")) {
      const answer = answers.shift();
      if (answer === undefined) throw new Error("Unexpected password prompt");
      queueMicrotask(() => input.write(answer));
    }
  });
  return { input, output, transcript: () => transcript, raw: () => raw };
}

test("interactive setup hides typing, retries empty/mismatched input and accepts a short password", async () => {
  const tty = terminal(["\r", "mismatch\r", "different\r", "x\r", "x\r"]);
  expect(await promptForAdminPassword(tty.input, tty.output)).toBe("x");
  expect(tty.transcript()).not.toContain("mismatch");
  expect(tty.transcript()).not.toContain("different");
  expect(tty.transcript()).toMatch(/non-empty/i);
  expect(tty.transcript()).toMatch(/did not match/i);
  expect(tty.raw()).toBe(false);
});

test.each(["\u0003", "\u0004"])(
  "interactive cancellation restores the terminal (%j)",
  async (key) => {
    const tty = terminal([key]);
    await expect(promptForAdminPassword(tty.input, tty.output)).rejects.toThrow(
      /cancelled/i,
    );
    expect(tty.raw()).toBe(false);
  },
);

test("a missing password without an interactive terminal explains how to configure startup", async () => {
  await expect(
    promptForAdminPassword(new PassThrough(), new PassThrough()),
  ).rejects.toThrow(/ADMIN_PASSWORD/);
});
