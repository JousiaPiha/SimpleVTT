import { test as base, expect, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../src/server/app.js";
import type { Asset } from "../../src/shared/contracts.js";
import { wav } from "../helpers/wav.js";

// Session resets and logins are isolated from the other browser workflows.
const test = base.extend({
  baseURL: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), "simple-vtt-global-e2e-"));
    const globalLibraryDir = join(root, "global-library");
    await mkdir(globalLibraryDir);
    const app = await buildApp({
      dataDir: join(root, "default"),
      globalLibraryDir,
      adminPassword: "test-password-123",
      logger: false,
    });
    try {
      await use(await app.listen({ host: "127.0.0.1", port: 0 }));
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
});
const trackName = "global-library-track.wav";
const effectName = "global-library-door.wav";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VZsAAAAASUVORK5CYII=",
  "base64",
);
async function sessionHeaders(page: Page) {
  const { generation } = await (await page.request.get("/api/admin/session")).json();
  return { origin: new URL(page.url()).origin, "x-simplevtt-session": generation as string };
}
async function localAssets(page: Page): Promise<Asset[]> {
  const response = await page.request.get("/api/admin/assets", { headers: await sessionHeaders(page) });
  expect(response.status()).toBe(200);
  return response.json();
}
async function globalAssets(page: Page): Promise<Asset[]> {
  const response = await page.request.get("/api/admin/global-library", { headers: await sessionHeaders(page) });
  expect(response.status()).toBe(200);
  return (await response.json()).assets;
}
async function expandAudio(page: Page) {
  await expect(page.getByRole("region", { name: "GM audio controls", exact: true })).toBeVisible();
  const expand = page.getByRole("button", { name: "Expand audio panel", exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole("tab", { name: "Library", exact: true }).click();
}

test("global previews stay separate, copies survive a session clear, and soundboard settings travel with them", async ({ page, browser }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Observe actual browser media, including the engine's detached Audio elements.
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    const elements: HTMLAudioElement[] = [];
    Object.defineProperty(window, "__globalLibraryAudio", { value: elements });
    window.Audio = class extends NativeAudio {
      constructor(src?: string) {
        super(src);
        elements.push(this);
      }
    };
  });
  const playing = () => page.evaluate(() => (
    window as unknown as { __globalLibraryAudio: HTMLAudioElement[] }
  ).__globalLibraryAudio.filter((audio) => !audio.paused && !audio.ended).map((audio) => audio.src));
  await page.goto("/admin");
  await page.getByLabel("Administrator password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();

  // The Playwright server owns its entire temporary session and global folders.
  const clear = await page.request.post("/api/admin/session/operations", {
    headers: await sessionHeaders(page), data: { action: "clear" },
  });
  expect(clear.status()).toBe(202);
  await expect.poll(async () => (await (await page.request.get("/api/admin/session")).json()).busy).toBe(false);
  await page.reload();
  await expandAudio(page);
  await page.getByLabel("Import audio files").setInputFiles({
    name: trackName, mimeType: "audio/wav", buffer: wav(90),
  });
  await expect(page.getByRole("button", { name: `Play ${trackName}`, exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Audio import category", exact: true }).click();
  await page.getByRole("option", { name: "Sound effect", exact: true }).click();
  await page.getByLabel("Import audio files").setInputFiles({
    name: effectName, mimeType: "audio/wav", buffer: wav(3, 440),
  });
  await page.getByRole("tab", { name: "Soundboard", exact: true }).click();
  await page.getByRole("button", { name: `Configure ${effectName}`, exact: true }).click();
  await page.getByRole("combobox", { name: "Sound group", exact: true }).fill("Global dungeon");
  await page.getByRole("button", { name: "Use Door open icon", exact: true }).click();
  await page.getByLabel("Custom icon file").setInputFiles({
    name: "global-library-icon.png", mimeType: "image/png", buffer: png,
  });
  await expect(page.getByRole("combobox", { name: "Custom icon from library", exact: true })).toHaveValue("global-library-icon.png");
  await page.getByRole("button", { name: "Save sound settings", exact: true }).click();
  await page.getByRole("tab", { name: "Library", exact: true }).click();
  for (const name of [trackName, effectName]) {
    await page.getByRole("button", { name: `Add to global library ${name}`, exact: true }).click();
    await expect.poll(async () => (await globalAssets(page)).some((asset) => asset.name === name)).toBe(true);
  }
  const beforePreview = await localAssets(page);
  expect(beforePreview).toHaveLength(3);
  await page.getByRole("button", { name: "Enable Audio", exact: true }).click();
  await page.getByRole("button", { name: `Play ${trackName}`, exact: true }).click();
  await expect.poll(async () => (await playing()).length).toBe(1);
  await page.getByText("Global library", { exact: true }).click();
  await page.getByRole("button", { name: `Preview ${trackName}`, exact: true }).click();
  await expect.poll(async () => (await playing()).length).toBe(2);
  expect((await playing()).filter((url) => url.includes("/global-media/"))).toHaveLength(1);
  expect(await localAssets(page)).toEqual(beforePreview);
  await page.getByRole("button", { name: `Stop preview ${trackName}`, exact: true }).click();
  await expect.poll(async () => (await playing()).length).toBe(1);
  await page.getByRole("button", { name: `Preview ${trackName}`, exact: true }).click();
  await expect.poll(async () => (await playing()).length).toBe(2);

  const globals = await globalAssets(page);
  const globalTrack = globals.find((asset) => asset.name === trackName)!;
  const playerContext = await browser.newContext();
  try {
    const player = await playerContext.newPage();
    const playerMedia: string[] = [];
    player.on("request", (request) => {
      if (/\/(?:global-)?media\//.test(request.url())) playerMedia.push(request.url());
    });
    await player.goto("/player");
    expect((await player.request.get("/api/admin/global-library")).status()).toBe(401);
    const preview = await player.request.get(`/global-media/${globalTrack.id}?session=${(await sessionHeaders(page))["x-simplevtt-session"]}`);
    expect([401, 404]).toContain(preview.status());
    expect(playerMedia).toEqual([]);
  } finally {
    await playerContext.close();
  }

  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Clear Default Session…", exact: true }).click();
  await page.getByRole("button", { name: "Clear Default Session", exact: true }).click();
  await expect.poll(async () => (await playing()).length).toBe(0);
  await expect.poll(async () => (await localAssets(page)).length).toBe(0);
  await expandAudio(page);
  await page.getByText("Global library", { exact: true }).click();
  await expect(page.getByRole("button", { name: `Add to session ${trackName}`, exact: true })).toBeVisible();
  expect(await globalAssets(page)).toEqual(globals);
  await page.getByRole("button", { name: `Add to session ${trackName}`, exact: true }).click();
  await expect.poll(async () => (await localAssets(page)).length).toBe(1);
  const firstCopy = (await localAssets(page))[0]!;
  expect(firstCopy.id).not.toBe(globalTrack.id);
  await page.getByRole("button", { name: `Add to session ${trackName}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Add to session ${trackName}`, exact: true })).toBeEnabled();
  expect(await localAssets(page)).toEqual([firstCopy]);
  await page.getByRole("button", { name: `Add to session ${effectName}`, exact: true }).click();
  await expect.poll(async () => (await localAssets(page)).length).toBe(3);
  await page.getByText("Session", { exact: true }).click();
  await page.getByRole("button", { name: "Enable Audio", exact: true }).click();
  await page.getByRole("button", { name: `Play ${trackName}`, exact: true }).click();
  await expect.poll(async () => (await playing()).length).toBe(1);
  expect((await playing())[0]).toContain(`/media/${firstCopy.id}?session=`);
  await page.getByRole("tab", { name: "Soundboard", exact: true }).click();
  const sound = page.getByRole("region", { name: "Global dungeon sounds", exact: true })
    .getByRole("button", { name: `Trigger ${effectName}`, exact: true });
  await expect(sound).toBeVisible();
  await expect.poll(() => sound.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await sound.click();
  await expect(page.getByTestId("active-effects")).toContainText("1");
  await expect.poll(async () => (await playing()).length).toBe(1);
  await page.getByRole("tab", { name: "Library", exact: true }).click();
  await page.getByText("Global library", { exact: true }).click();
  await expect(page.getByRole("button", { name: `Add to session ${trackName}`, exact: true })).toBeEnabled();
  await page.screenshot({ path: "test-results/global-library.png", fullPage: true });
  await page.getByRole("button", { name: "Stop all audio", exact: true }).click();
  await expect.poll(async () => (await playing()).length).toBe(0);
  expect(errors).toEqual([]);
});
