import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/server/app.js";

it("serves new frontend build files without restarting and keeps missing/private paths inaccessible", async () => {
  const dir = await mkdtemp(join(tmpdir(), "simple-vtt-static-"));
  const staticDir = join(dir, "client");
  await mkdir(join(staticDir, "assets"), { recursive: true });
  await writeFile(
    join(staticDir, "index.html"),
    '<script src="/assets/old.js"></script>',
  );
  await writeFile(join(staticDir, "assets/old.js"), 'console.log("old")');
  await writeFile(join(dir, "private.txt"), "private data");
  const app = await buildApp({
    dataDir: join(dir, "data"),
    staticDir,
    adminPassword: "test-password-123",
    logger: false,
  });
  try {
    await app.ready();
    expect((await app.inject("/assets/old.js")).statusCode).toBe(200);
    await writeFile(join(staticDir, "assets/new.js"), 'console.log("new")');
    await writeFile(
      join(staticDir, "index.html"),
      '<script src="/assets/new.js"></script>',
    );
    const html = await app.inject("/admin");
    expect(html.body).toContain("/assets/new.js");
    const asset = await app.inject("/assets/new.js");
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe('console.log("new")');
    expect(html.headers["cache-control"]).toBe("no-store");
    expect((await app.inject("/assets/missing.js")).statusCode).toBe(404);
    expect((await app.inject("/private.txt")).statusCode).toBe(404);
    expect((await app.inject("/%2e%2e/private.txt")).body).not.toContain(
      "private data",
    );
    expect((await app.inject("/api/admin/scenes")).statusCode).toBe(401);
    expect((await app.inject("/api/presentation")).statusCode).toBe(200);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
