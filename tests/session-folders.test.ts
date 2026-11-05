import { test, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  readdir,
  writeFile,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFolderBrowser } from "../src/server/services/session-folders.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "vtt-folders-"));
  roots.push(root);
  return root;
}
test("configured root takes priority; missing preference warns and never creates it", async () => {
  const root = await setup();
  const selected = join(root, "preferred");
  await mkdir(selected);
  const browser = createFolderBrowser({
    sessionsRoot: selected,
    currentPath: () => root,
  });
  expect((await browser.list()).path).toBe(await realpath(selected));
  await rm(selected, { recursive: true });
  const fallback = await browser.list();
  expect(fallback.path).toBe(await realpath(root));
  expect(fallback.warning).toBeTruthy();
  expect(await readdir(root)).not.toContain("preferred");
  await expect(browser.list(selected)).rejects.toThrow();
});
test("lists only directories, canonicalizes shortcuts, and counts hidden contents", async () => {
  const root = await setup();
  await mkdir(join(root, "nested"));
  await writeFile(join(root, ".hidden"), "content");
  await symlink(join(root, "nested"), join(root, "shortcut"));
  const browser = createFolderBrowser({ currentPath: () => root });
  const listing = await browser.list(root);
  expect(listing.empty).toBe(false);
  expect(listing.folders.map((f) => f.name)).toEqual(["nested", "shortcut"]);
  expect((await browser.list(join(root, "shortcut"))).path).toBe(
    await realpath(join(root, "nested")),
  );
});
test("New Folder only creates a single portable child without overwriting", async () => {
  const root = await setup();
  const browser = createFolderBrowser({ currentPath: () => root });
  await browser.create(root, "Temple – sesión");
  expect(await readdir(root)).toContain("Temple – sesión");
  for (const name of [
    "../escape",
    "a/b",
    "a\\b",
    "CON",
    "trailing.",
    " ",
    "bad:name",
  ]) {
    await expect(browser.create(root, name)).rejects.toThrow();
  }
  await expect(browser.create(root, "Temple – sesión")).rejects.toThrow();
  await expect(
    browser.create(join(root, "missing"), "child"),
  ).rejects.toThrow();
  expect(await readdir(root)).not.toContain("missing");
});
