import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/server/app.js";
import type { RunTool } from "../src/server/services/run-tool.js";
import { wav } from "./helpers/wav.js";

let dir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
let download: RunTool;
const calls: { file: string; args: string[] }[] = [];
const origin = "http://localhost:80";
const input = {
  url: "https://example.com/thunder?x=$(touch%20bad)&a=1",
  category: "effect",
};
const request = (
  method: "GET" | "POST" | "DELETE",
  path: string,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/admin/online-audio/${path}`,
    headers: { cookie, origin },
    payload,
  });
const status = async () => (await request("GET", "job")).json();
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "simple-vtt-online-"));
  calls.length = 0;
  download = async (_file, _args, options) => {
    options.onLine?.('__TITLE__"Thunder"');
    options.onLine?.("__PROGRESS__100%");
    await writeFile(join(options.cwd!, "audio.mp3"), wav());
  };
  const run: RunTool = async (file, args, options) => {
    calls.push({ file, args });
    if (args.length === 1) return;
    return download(file, args, options);
  };
  app = await buildApp({
    dataDir: dir,
    adminPassword: "test-password-123",
    logger: false,
    onlineAudio: { run },
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
it("downloads once, imports into the chosen category, preserves titles, and keeps audio private", async () => {
  expect((await request("POST", "job", input)).statusCode).toBe(202);
  await expect.poll(async () => (await status()).status).toBe("complete");
  const job = await status();
  expect(job.asset).toMatchObject({ name: "Thunder.mp3", category: "effect" });
  expect(job.asset).not.toHaveProperty("relativePath");
  const args = calls.find((c) => c.args.includes("--extract-audio"))!.args;
  expect(args.slice(-2)).toEqual(["--", input.url]);
  expect(args).toContain("--ignore-config");
  expect(args).toContain("--no-plugin-dirs");
  expect(args[args.indexOf("--playlist-items") + 1]).toBe("1");
  expect((await app.inject(`/media/${job.asset.id}`)).statusCode).toBe(404);
  const asset = await app.inject({
    url: `/media/${job.asset.id}`,
    headers: { cookie },
  });
  expect(asset.statusCode).toBe(200);
  await expect.poll(() => readdir(join(dir, ".online-imports"))).toEqual([]);
  await app.close();
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
  expect(
    (
      await app.inject({ url: "/api/admin/assets", headers: { cookie } })
    ).json(),
  ).toContainEqual(job.asset);
});
it("rejects player access, bad categories and non-web URLs", async () => {
  expect((await app.inject("/api/admin/online-audio/tools")).statusCode).toBe(
    401,
  );
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/admin/online-audio/job",
        payload: input,
      })
    ).statusCode,
  ).toBe(401);
  for (const invalid of [
    { url: "file:///etc/passwd" },
    { url: "bad" },
    { url: "https://me:password@example.com/audio" },
    { category: "background" },
    { args: ["--exec", "bad"] },
  ])
    expect(
      (await request("POST", "job", { ...input, ...invalid })).statusCode,
    ).toBe(400);
});
it("supports cancellation, rejects duplicate jobs, cleans partial files and allows retry", async () => {
  download = async (_file, _args, options) => {
    await writeFile(join(options.cwd!, "partial.part"), "partial");
    options.signal.throwIfAborted();
    await new Promise<void>((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new Error("stopped")),
        { once: true },
      );
    });
  };
  const started = (await request("POST", "job", input)).json();
  await expect.poll(async () => (await status()).status).toBe("downloading");
  expect((await request("POST", "job", input)).statusCode).toBe(409);
  expect((await request("DELETE", `job/${started.id}`)).statusCode).toBe(204);
  await expect.poll(async () => (await status()).status).toBe("cancelled");
  await expect.poll(() => readdir(join(dir, ".online-imports"))).toEqual([]);
  download = async (_file, _args, options) => {
    await writeFile(join(options.cwd!, "audio.mp3"), wav());
  };
  await request("POST", "job", {
    ...input,
    name: "Storm",
    category: "ambience",
  });
  await expect.poll(async () => (await status()).status).toBe("complete");
  expect((await status()).asset).toMatchObject({
    name: "Storm.mp3",
    category: "ambience",
  });
});
it("reports extraction failures without adding broken assets", async () => {
  download = async () => {
    throw new Error("Source unavailable");
  };
  await request("POST", "job", input);
  await expect.poll(async () => (await status()).status).toBe("failed");
  expect((await status()).error).toContain("Source unavailable");
  expect(
    (
      await app.inject({ url: "/api/admin/assets", headers: { cookie } })
    ).json(),
  ).toEqual([]);
});
it("does not index invalid output files", async () => {
  download = async (_file, _args, options) => {
    await writeFile(join(options.cwd!, "audio.mp3"), "not audio");
  };
  await request("POST", "job", input);
  await expect.poll(async () => (await status()).status).toBe("failed");
  expect(
    (
      await app.inject({ url: "/api/admin/assets", headers: { cookie } })
    ).json(),
  ).toEqual([]);
});

it("reports missing dependencies clearly without starting a download", async () => {
  await app.close();
  app = await buildApp({
    dataDir: dir,
    adminPassword: "test-password-123",
    logger: false,
    onlineAudio: {
      run: async () => {
        throw new Error("not installed");
      },
    },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { password: "test-password-123" },
  });
  cookie = login.headers["set-cookie"]!.toString().split(";")[0];
  const tools = (await request("GET", "tools")).json();
  expect(tools.ready).toBe(false);
  expect(tools.missing).toEqual(
    expect.arrayContaining(["yt-dlp", "FFmpeg", "ffprobe"]),
  );
  await request("POST", "job", input);
  await expect.poll(async () => (await status()).status).toBe("failed");
  expect((await status()).error).toContain("Install");
});
