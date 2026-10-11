import { test, expect } from "@playwright/test";
import { wav } from "../helpers/wav.js";

test("delete controls confirm effects and remove used media and text without affecting other audio", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    const items: HTMLAudioElement[] = [];
    Object.defineProperty(window, "__testAudio", { value: items });
    window.Audio = class extends NativeAudio {
      constructor(src?: string) {
        super(src);
        items.push(this);
      }
    };
  });
  const playing = () =>
    page.evaluate(
      () =>
        (
          window as unknown as { __testAudio: HTMLAudioElement[] }
        ).__testAudio.filter((a) => !a.paused && !a.ended).length,
    );
  await page.goto("/admin");
  await page.getByLabel("Administrator password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("New scene name").fill("Deletion demo");
  await page.getByRole("button", { name: "Create scene" }).click();
  await page
    .getByLabel("Import images")
    .setInputFiles("tests/fixtures/hero.png");
  await page
    .getByRole("button", { name: "Set hero.png as background" })
    .click();
  await page.getByRole("button", { name: "Add hero.png to scene" }).click();
  await expect(page.getByLabel("Object name")).toHaveValue("hero.png");
  await page
    .getByRole("switch", { name: "Visible to players", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Present scene", exact: true })
    .click();
  const assets = await (await page.request.get("/api/admin/assets")).json();
  const image = assets.find((a: { name: string }) => a.name === "hero.png");
  const other = await (
    await page.request.post("/api/admin/scenes", {
      data: { name: "Also uses image" },
      headers: { origin: "http://127.0.0.1:3100" },
    })
  ).json();
  await page.request.patch(`/api/admin/scenes/${other.id}`, {
    data: { backgroundAssetId: image.id },
    headers: { origin: "http://127.0.0.1:3100" },
  });
  const context = await browser.newContext();
  const player = await context.newPage();
  await player.goto("/player");
  const presentation = async () =>
    (await (await player.request.get("/api/presentation")).json()).scene;
  await page.getByRole("button", { name: "Delete image hero.png" }).click();
  await expect(page.getByTestId("asset-usage")).toContainText(
    "2 scene(s): 2 background(s), 1 image object(s)",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await player.request.get(`/media/${image.id}`)).ok()).toBe(true);
  // Failure stays reviewable; retry removes references and file together.
  await page.route(`**/api/admin/assets/${image.id}`, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporary deletion failure" }),
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Delete image hero.png" }).click();
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Temporary deletion failure", { exact: true }),
  ).toBeVisible();
  expect((await player.request.get(`/media/${image.id}`)).ok()).toBe(true);
  await page.unroute(`**/api/admin/assets/${image.id}`);
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete image hero.png" }),
  ).toHaveCount(0);
  await expect.poll(async () => (await presentation()).objects.length).toBe(0);
  expect((await presentation()).backgroundAssetId).toBe(null);
  expect((await page.request.get(`/media/${image.id}`)).status()).toBe(404);
  expect(
    (await (await page.request.get(`/api/admin/scenes/${other.id}`)).json())
      .backgroundAssetId,
  ).toBe(null);
  await page
    .getByRole("button", { name: "Scan media folder", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete image hero.png" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Text & loot", exact: true }).click();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Delete text New text", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("switch", { name: "Content visible to players" })
    .check();
  await expect.poll(async () => (await presentation()).content.length).toBe(1);
  await page
    .getByRole("button", { name: "Delete text New text", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await presentation()).content.length).toBe(1);
  await page
    .getByRole("button", { name: "Delete text New text", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove permanently", exact: true })
    .click();
  await expect.poll(async () => (await presentation()).content.length).toBe(0);
  await page.getByRole("button", { name: "Expand audio panel" }).click();
  const upload = async (category: string, name: string) => {
    await page
      .getByRole("combobox", { name: "Audio import category", exact: true })
      .click();
    await page.getByRole("option", { name: category, exact: true }).click();
    await page
      .getByLabel("Import audio files")
      .setInputFiles({ name, mimeType: "audio/wav", buffer: wav(30) });
    await expect(
      page.getByRole("button", { name: `Delete sound ${name}`, exact: true }),
    ).toBeVisible();
  };
  await upload("Music", "delete-music.wav");
  await upload("Ambience", "keep-rain.wav");
  await page.getByRole("button", { name: "Enable Audio", exact: true }).click();
  await page
    .getByRole("button", { name: "Play delete-music.wav", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start ambience keep-rain.wav", exact: true })
    .click();
  await expect.poll(playing).toBe(2);
  await page.getByRole("tab", { name: "Playlists", exact: true }).click();
  await page.getByLabel("Playlist name").fill("Delete track test");
  await page
    .getByRole("combobox", { name: "Add playlist track", exact: true })
    .click();
  await page
    .getByRole("option", { name: "delete-music.wav", exact: true })
    .click();
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page
    .getByRole("button", { name: "Save playlist", exact: true })
    .click();
  await expect(page.getByText("Playlist saved", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Library", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete sound delete-music.wav" })
    .click();
  await expect(page.getByTestId("asset-usage")).toContainText(
    "1 playlist(s): 1 track",
  );
  await page.screenshot({
    path: "test-results/delete-confirmation.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect.poll(playing).toBe(1);
  await expect(
    page.getByRole("button", { name: "Delete sound delete-music.wav" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Playlists", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play playlist", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Missing track", { exact: true })).toHaveCount(0);
  const lists = await (await page.request.get("/api/admin/playlists")).json();
  expect(
    lists.find((p: { name: string }) => p.name === "Delete track test")
      .trackIds,
  ).toEqual([]);
  await page.getByRole("tab", { name: "Library", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete sound keep-rain.wav" })
    .click();
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect.poll(playing).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});
