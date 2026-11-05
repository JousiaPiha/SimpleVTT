import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill("SIGINT");
      await closed;
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(serverSource: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "simple-vtt Windows & launcher ")));
  roots.push(root);
  await Promise.all(["scripts", "dist/server", "bin"].map((path) => mkdir(join(root, path), { recursive: true })));
  await copyFile(resolve("scripts/start-windows.mjs"), join(root, "scripts/start-windows.mjs"));
  await writeFile(join(root, "dist/server/index.js"), serverSource);
  // Replace only the Windows browser handoff. The launcher, server process and HTTP are real.
  await writeFile(join(root, "bin/powershell.exe"), `#!${process.execPath}
const fs = require('node:fs');
(async () => {
  const response = await fetch(process.env.SIMPLE_VTT_ADMIN_URL);
  fs.writeFileSync(process.env.BROWSER_RECORD, JSON.stringify({
    url: process.env.SIMPLE_VTT_ADMIN_URL,
    body: await response.text(),
    passwordInherited: Object.hasOwn(process.env, 'ADMIN_PASSWORD'),
  }));
})();
`, { mode: 0o755 });
  return root;
}

async function unusedPort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));
  return address.port;
}

function launch(root: string, port: number | string, host = "127.0.0.1", simulateWindows = false) {
  const args = simulateWindows ? ["--import", join(root, "windows-platform.mjs")] : [];
  const child = spawn(process.execPath, [...args, join(root, "scripts/start-windows.mjs")], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      HOST: host,
      PORT: String(port),
      DATA_DIR: "",
      ADMIN_PASSWORD: "test-override",
      BROWSER_RECORD: join(root, "browser.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout?.on("data", (chunk) => { output += chunk; });
  child.stderr?.on("data", (chunk) => { output += chunk; });
  return { child, output: () => output, closed: once(child, "close") };
}

// POSIX provides the executable shim for the Windows browser command.
it.skipIf(process.platform === "win32")("opens the ready dashboard from a shortcut's unrelated working directory and stops its server", async () => {
  const root = await fixture(`
    const http = require('node:http');
    const fs = require('node:fs');
    const server = http.createServer((_req, res) => res.end('ready'));
    fs.writeFileSync('server.json', JSON.stringify({ cwd: process.cwd(), data: process.env.DATA_DIR }));
    setTimeout(() => server.listen(Number(process.env.PORT), process.env.HOST), 400);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  const port = await unusedPort();
  const run = launch(root, port, "0.0.0.0");
  await expect.poll(async () => JSON.parse(await readFile(join(root, "browser.json"), "utf8")), { timeout: 4000 }).toEqual({
    url: `http://127.0.0.1:${port}/admin`, body: "ready", passwordInherited: false,
  });
  expect(JSON.parse(await readFile(join(root, "server.json"), "utf8"))).toEqual({ cwd: root, data: join(root, "data") });
  run.child.kill("SIGINT");
  expect((await run.closed)[0]).toBe(0);
  await expect(fetch(`http://127.0.0.1:${port}/admin`)).rejects.toThrow();
});

it.skipIf(process.platform === "win32")("refuses an occupied port without starting a second server or opening its page", async () => {
  const root = await fixture("require('node:fs').writeFileSync('started', 'yes');");
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  try {
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    const run = launch(root, address.port);
    expect((await run.closed)[0]).toBe(1);
    expect(run.output()).toContain("EADDRINUSE");
    await expect(readFile(join(root, "started"))).rejects.toThrow();
    await expect(readFile(join(root, "browser.json"))).rejects.toThrow();
  } finally {
    await new Promise<void>((resolveClose) => occupied.close(() => resolveClose()));
  }
});

it.skipIf(process.platform === "win32")("reports server startup failure without opening a browser", async () => {
  const root = await fixture("console.error('fixture startup failure'); process.exit(7);");
  const run = launch(root, await unusedPort());
  expect((await run.closed)[0]).toBe(1);
  expect(run.output()).toContain("fixture startup failure");
  await expect(readFile(join(root, "browser.json"))).rejects.toThrow();
});

it.skipIf(process.platform === "win32")("rejects an invalid port before starting", async () => {
  const root = await fixture("require('node:fs').writeFileSync('started', 'yes');");
  const run = launch(root, "3000oops");
  expect((await run.closed)[0]).toBe(1);
  expect(run.output()).toContain("PORT must be an integer from 1 to 65535");
  await expect(readFile(join(root, "started"))).rejects.toThrow();
});

it.skipIf(process.platform === "win32")("allows the Windows server to finish session cleanup after a shared console interrupt", async () => {
  const root = await fixture(`
    const http = require('node:http');
    const fs = require('node:fs');
    fs.writeFileSync('pid', String(process.pid));
    const server = http.createServer((_req, res) => res.end('ready'));
    server.listen(Number(process.env.PORT), process.env.HOST);
    process.on('SIGINT', () => setTimeout(() => {
      fs.writeFileSync('clean-shutdown', 'done');
      server.close(() => process.exit(0));
    }, 300));
  `);
  // Exercise the Windows decision while explicitly simulating the console's broadcast.
  // This does not test native Windows signal delivery or CMD/PowerShell.
  await writeFile(join(root, "windows-platform.mjs"), "Object.defineProperty(process, 'platform', { value: 'win32' });");
  const run = launch(root, await unusedPort(), "127.0.0.1", true);
  await expect.poll(async () => readFile(join(root, "browser.json"), "utf8"), { timeout: 4000 }).toContain('"body":"ready"');
  const pid = Number(await readFile(join(root, "pid"), "utf8"));
  run.child.kill("SIGINT");
  process.kill(pid, "SIGINT");
  expect((await run.closed)[0]).toBe(0);
  expect(await readFile(join(root, "clean-shutdown"), "utf8")).toBe("done");
});
