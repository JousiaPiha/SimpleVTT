import { test, expect, type Page } from "@playwright/test";
import { wav } from "../helpers/wav.js";

test("GM mixes audio independently of scenes, persists preparation, and players never load audio", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Observe real native media instances, including ones not attached to the DOM.
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    const elements: HTMLAudioElement[] = [];
    Object.defineProperty(window, "__testAudio", { value: elements });
    window.Audio = class extends NativeAudio {
      constructor(src?: string) {
        super(src);
        elements.push(this);
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
  await page.getByRole("button", { name: "Expand audio panel" }).click();
  await expect(
    page.getByRole("button", { name: "Enable Audio", exact: true }),
  ).toBeVisible();
  const upload = async (category: string, name: string, seconds: number) => {
    await page
      .getByRole("combobox", { name: "Audio import category", exact: true })
      .click();
    await page.getByRole("option", { name: category, exact: true }).click();
    await page
      .getByLabel("Import audio files")
      .setInputFiles({ name, mimeType: "audio/wav", buffer: wav(seconds) });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  };
  await upload("Music", "session-music.wav", 45);
  await upload("Ambience", "rain-loop.wav", 20);
  await upload("Ambience", "wind-loop.wav", 20);
  await upload("Sound effect", "door-hit.wav", 2);
  expect(await playing()).toBe(0);
  await page.getByRole("button", { name: "Enable Audio", exact: true }).click();
  await page
    .getByRole("button", { name: "Play session-music.wav", exact: true })
    .click();
  await expect.poll(playing).toBe(1);
  await page
    .getByRole("button", { name: "Start ambience rain-loop.wav" })
    .click();
  await page
    .getByRole("button", { name: "Start ambience wind-loop.wav" })
    .click();
  await expect.poll(playing).toBe(3);
  await page.getByRole("button", { name: "Trigger door-hit.wav" }).click();
  await page.getByRole("button", { name: "Trigger door-hit.wav" }).click();
  await expect(page.getByTestId("active-effects")).toContainText("2");
  await page
    .getByRole("button", { name: "Stop ambience rain-loop.wav" })
    .click();
  await expect.poll(playing).toBe(2);
  await page.getByRole("button", { name: "Pause music" }).click();
  await expect.poll(playing).toBe(1);
  await page.getByRole("button", { name: "Resume music" }).click();
  await expect.poll(playing).toBe(2);
  await page.getByRole("button", { name: "Collapse audio panel" }).click();
  await page.getByLabel("New scene name").fill("Audio keeps playing");
  await page.getByRole("button", { name: "Create scene" }).click();
  await expect(
    page.getByRole("heading", { name: "Audio keeps playing" }),
  ).toBeVisible();
  expect(await playing()).toBe(2);
  await page.getByRole("button", { name: "Expand audio panel" }).click();
  await page.getByRole("tab", { name: "Playlists", exact: true }).click();
  await page.getByLabel("Playlist name").fill("Session soundtrack");
  await page
    .getByRole("combobox", { name: "Add playlist track", exact: true })
    .click();
  await page
    .getByRole("option", { name: "session-music.wav", exact: true })
    .click();
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page
    .getByRole("button", { name: "Save playlist", exact: true })
    .click();
  await expect(page.getByText("Playlist saved", { exact: true })).toBeVisible();
  await page
    .getByRole("slider", { name: "Master volume", exact: true })
    .focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/admin/audio-preferences")).json())
          .volumes.master,
    )
    .toBe(0.01);
  const assets = (await (
    await page.request.get("/api/admin/assets")
  ).json()) as { id: string; name: string; mimeType: string }[];
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  const mediaRequests: string[] = [];
  player.on("request", (request) => {
    if (request.url().includes("/media/")) mediaRequests.push(request.url());
  });
  await player.goto("/player");
  for (const asset of assets.filter((a) => a.mimeType.startsWith("audio/")))
    expect((await player.request.get(`/media/${asset.id}`)).status()).toBe(404);
  expect(mediaRequests).toEqual([]);
  await page.reload();
  await page.getByRole("button", { name: "Expand audio panel" }).click();
  await expect(
    page.getByRole("button", { name: "Enable Audio", exact: true }),
  ).toBeVisible();
  expect(await playing()).toBe(0);
  await page.getByRole("tab", { name: "Playlists", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Select playlist", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Session soundtrack", exact: true })
    .click();
  await expect(page.getByLabel("Playlist name")).toHaveValue(
    "Session soundtrack",
  );
  await expect(
    page.getByRole("slider", { name: "Master volume", exact: true }),
  ).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: "Enable Audio", exact: true }).click();
  await page
    .getByRole("button", { name: "Play playlist", exact: true })
    .click();
  await expect.poll(playing).toBe(1);
  await page.screenshot({
    path: "test-results/audio-panel.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("tab", { name: "Library", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Import audio", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/audio-library-1280.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(playing).toBe(0);
  await expect(page.getByLabel("Administrator password")).toBeVisible();
  expect(errors).toEqual([]);
  await playerContext.close();
});
