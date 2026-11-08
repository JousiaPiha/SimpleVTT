import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const dir = await mkdtemp(join(tmpdir(), "simple-vtt-e2e-"));
const dataDir = join(dir, "default");
const globalLibraryDir = join(dir, "global-library");
await mkdir(globalLibraryDir);
const child = spawn(process.execPath, ["dist/server/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    MEDIA_DIR: join(dataDir, "media"),
    SESSIONS_ROOT: dir,
    GLOBAL_LIBRARY_DIR: globalLibraryDir,
    ADMIN_PASSWORD: "test-password-123",
    HOST: "127.0.0.1",
    PORT: "3100",
    COOKIE_SECURE: "false",
  },
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", async (code) => {
  await rm(dir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
