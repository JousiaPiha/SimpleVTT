import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, mkdir, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSessionManager,
  type SessionManager,
} from "../src/server/services/sessions.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

let manager: SessionManager | undefined;
let root: string | undefined;
afterEach(async () => {
  vi.mocked(lstat).mockClear();
  await manager?.shutdown();
  if (root) await rm(root, { recursive: true, force: true });
});

test("a delayed status poll cannot mark newly opened storage as failed", async () => {
  root = await mkdtemp(join(tmpdir(), "vtt-session-poll-"));
  manager = await createSessionManager({
    dataDir: join(root, "default"),
    logger: { error: () => {} },
  });
  const context = manager.require();
  const identity = await lstat(context.path);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(lstat).mockImplementationOnce(async () => {
    await gate;
    return identity;
  });
  const poll = manager.checkStorage();
  const target = join(root, "named");
  await mkdir(target);
  manager.start("save-as", target);
  await expect.poll(() => manager!.status().busy).toBe(false);
  expect(manager.status().operation?.status).toBe("complete");
  release();
  await expect(poll).resolves.toBeUndefined();
  expect(manager.status().error).toBeNull();
  expect(manager.require()).not.toBe(context);
});
