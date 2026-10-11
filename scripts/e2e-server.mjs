import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const dir = await mkdtemp(join(tmpdir(), "simple-vtt-e2e-"));
const child = spawn(process.execPath, ["dist/server/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATA_DIR: dir,
    ADMIN_PASSWORD: "test-password-123",
    HOST: "127.0.0.1",
    PORT: "3100",
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
