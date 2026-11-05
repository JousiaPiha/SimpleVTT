// Plain JavaScript so the desktop launcher also works before a TypeScript build.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function openBrowser(url) {
  const env = { ...process.env, SIMPLE_VTT_ADMIN_URL: url };
  delete env.ADMIN_PASSWORD;
  // Use the URL as data, never as shell source. No .ps1 file or policy change is needed.
  await new Promise((resolveOpen, reject) => {
    const browser = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:SIMPLE_VTT_ADMIN_URL",
    ], { env, stdio: "ignore", windowsHide: true });
    browser.once("error", reject);
    browser.once("exit", (code) => code === 0 ? resolveOpen() : reject(new Error("Browser launch failed")));
  });
}

async function launch() {
  const host = process.env.HOST || "127.0.0.1";
  const portText = process.env.PORT || "3000";
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }
  const browserHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  const url = `http://${browserHost.includes(":") ? `[${browserHost}]` : browserHost}:${port}/admin`;
  // Refuse an occupied port rather than opening another application's page.
  await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen({ host, port, exclusive: true }, () => probe.close(resolvePort));
  });

  console.log(`Starting SimpleVTT: ${url}\nKeep this window open. Press Ctrl+C to stop the server.`);
  const server = spawn(process.execPath, ["dist/server/index.js"], {
    cwd: root,
    env: { ...process.env, HOST: host, PORT: String(port), DATA_DIR: process.env.DATA_DIR || resolve(root, "data") },
    stdio: "inherit",
  });
  let stopping = false;
  let finished = false;
  const exited = new Promise((resolveExit, reject) => {
    server.once("error", (error) => { finished = true; reject(error); });
    server.once("exit", (code, signal) => {
      finished = true;
      resolveExit({ code, signal });
    });
  });
  let stopTimeout;
  const stop = (signal) => {
    if (stopping || finished) return;
    stopping = true;
    if (process.platform === "win32" && signal === "SIGINT") {
      // Ctrl+C reaches both processes in this console. Windows kill() is forceful;
      // let the server checkpoint SQLite and release portable-session locks first.
      stopTimeout = setTimeout(() => { if (!finished) server.kill(); }, 10_000);
      stopTimeout.unref();
    } else {
      server.kill("SIGTERM");
    }
  };
  const interrupt = () => stop("SIGINT");
  const terminate = () => stop("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const deadline = Date.now() + 30_000;
    while (true) {
      const exit = await Promise.race([exited, delay(250).then(() => null)]);
      if (exit) {
        if (stopping) return;
        throw new Error(`The server stopped before it was ready (exit ${exit.code ?? exit.signal}).`);
      }
      let ready = false;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: "error" });
        ready = response.ok;
        await response.body?.cancel();
      } catch { /* The server may still be starting. */ }
      if (ready && !finished && !stopping) break;
      if (Date.now() >= deadline) throw new Error("The server did not become ready within 30 seconds.");
    }
    try { await openBrowser(url); }
    catch { console.warn(`Could not open your default browser. Open this address manually: ${url}`); }
    const exit = await exited;
    if (!stopping && exit.code !== 0) throw new Error(`The server stopped (exit ${exit.code ?? exit.signal}).`);
  } finally {
    clearTimeout(stopTimeout);
    if (!finished) {
      server.kill();
      await exited;
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

launch().catch((error) => {
  console.error(`Cannot start SimpleVTT: ${error.message}`);
  process.exitCode = 1;
});
