import { test, expect } from "@playwright/test";
import { wav } from "../helpers/wav.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VZsAAAAASUVORK5CYII=",
  "base64",
);
test("soundboard groups, built-in and custom icons persist and play without editing", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    const elements: HTMLAudioElement[] = [];
    Object.defineProperty(window, "__soundboardAudio", { value: elements });
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
          window as unknown as { __soundboardAudio: HTMLAudioElement[] }
        ).__soundboardAudio.filter((a) => !a.paused && !a.ended).length,
    );
  await page.goto("/admin");
  await expect(page).toHaveTitle("SimpleVTT");
  await page.getByLabel("Administrator password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Blade clash.wav",
    "Owl call.wav",
    "Background bed.wav",
  ]) {
    const response = await page.request.post(
      `/api/admin/assets?category=${name === "Background bed.wav" ? "music" : "effect"}`,
      {
        headers: { origin: "http://127.0.0.1:3100" },
        multipart: {
          file: {
            name,
            mimeType: "audio/wav",
            buffer: wav(name === "Background bed.wav" ? 90 : 3),
          },
        },
      },
    );
    expect(response.status()).toBe(201);
  }
  await page.reload();
  await page.getByRole("button", { name: "Expand audio panel" }).click();
  await page.getByRole("tab", { name: "Soundboard", exact: true }).click();
  const trigger = page.getByRole("button", {
    name: "Trigger Blade clash.wav",
    exact: true,
  });
  await expect(trigger).toBeDisabled();
  await page.getByRole("button", { name: "Configure Blade clash.wav" }).click();
  await page
    .getByRole("combobox", { name: "Sound group", exact: true })
    .fill("Combat");
  await page
    .getByRole("button", { name: "Use Swords icon", exact: true })
    .click();
  await page.getByRole("button", { name: "Save sound settings" }).click();
  const combat = page.getByRole("region", {
    name: "Combat sounds",
    exact: true,
  });
  await expect(
    combat.getByRole("button", { name: "Trigger Blade clash.wav" }),
  ).toBeVisible();
  await expect(trigger.locator("svg")).toHaveClass(/lucide-swords/);
  await page.getByRole("button", { name: "Configure Owl call.wav" }).click();
  await page
    .getByRole("combobox", { name: "Sound group", exact: true })
    .fill("Nature");
  await page.getByLabel("Custom icon file").setInputFiles({
    name: "owl-icon.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByRole("combobox", {
      name: "Custom icon from library",
      exact: true,
    }),
  ).toHaveValue("owl-icon.png");
  await page.getByRole("button", { name: "Save sound settings" }).click();
  const owl = page.getByRole("button", {
    name: "Trigger Owl call.wav",
    exact: true,
  });
  await expect(owl.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      owl.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("combobox", { name: "Soundboard group", exact: true })
    .click();
  await page.getByRole("option", { name: "Nature", exact: true }).click();
  await expect(owl).toBeVisible();
  await expect(trigger).not.toBeVisible();
  await page.getByLabel("Search sounds", { exact: true }).fill("nomatch");
  await expect(page.getByText("No matching sounds.")).toBeVisible();
  await page.getByLabel("Search sounds", { exact: true }).fill("");
  await page.reload();
  await page.getByRole("button", { name: "Expand audio panel" }).click();
  await page.getByRole("tab", { name: "Soundboard", exact: true }).click();
  await expect(trigger.locator("svg")).toHaveClass(/lucide-swords/);
  await expect(owl.locator("img")).toBeVisible();
  await expect(combat).toBeVisible();
  await page.getByRole("button", { name: "Enable Audio", exact: true }).click();
  await page.getByRole("tab", { name: "Library", exact: true }).click();
  await page
    .getByRole("button", { name: "Play Background bed.wav", exact: true })
    .click();
  await expect.poll(playing).toBe(1);
  await page.getByRole("tab", { name: "Soundboard", exact: true }).click();
  await trigger.click();
  await trigger.click();
  await expect(page.getByTestId("active-effects")).toContainText("2");
  await page.getByRole("button", { name: "Configure Blade clash.wav" }).click();
  await page
    .getByRole("combobox", { name: "Sound group", exact: true })
    .fill("Cancelled group");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(combat).toBeVisible();
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  await player.goto("/player");
  const customUrl = await owl.locator("img").getAttribute("src");
  expect((await player.request.get(customUrl!)).status()).toBe(404);
  expect((await player.request.get("/api/admin/soundboard")).status()).toBe(
    401,
  );
  await playerContext.close();
  await owl.scrollIntoViewIfNeeded();
  await expect(owl).toBeInViewport();
  await page.screenshot({
    path: "/private/tmp/simple-vtt-soundboard-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 780, height: 1000 });
  await owl.scrollIntoViewIfNeeded();
  await expect(owl).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/simple-vtt-soundboard-narrow.png",
    fullPage: false,
  });
  // Clearing a group returns the sound to Ungrouped; a failed save keeps the draft.
  await page.getByRole("button", { name: "Configure Blade clash.wav" }).click();
  await page
    .getByRole("combobox", { name: "Sound group", exact: true })
    .fill("");
  await page.route("**/api/admin/soundboard/*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Save unavailable" }),
    }),
  );
  await page.getByRole("button", { name: "Save sound settings" }).click();
  await expect(page.getByRole("alert")).toContainText("Save unavailable");
  await expect(
    page.getByRole("combobox", { name: "Sound group", exact: true }),
  ).toHaveValue("");
  await page.unroute("**/api/admin/soundboard/*");
  await page.getByRole("button", { name: "Save sound settings" }).click();
  await expect(
    page
      .getByRole("region", { name: "Ungrouped sounds", exact: true })
      .getByRole("button", { name: "Trigger Blade clash.wav" }),
  ).toBeVisible();
  await expect.poll(playing).toBe(1);
  // Reusing an uploaded icon needs no duplicate upload, and deletion falls back safely.
  await page.getByRole("button", { name: "Configure Blade clash.wav" }).click();
  await page
    .getByRole("combobox", { name: "Custom icon from library", exact: true })
    .click();
  await page.getByRole("option", { name: "owl-icon.png", exact: true }).click();
  await page.getByRole("button", { name: "Save sound settings" }).click();
  await expect(trigger.locator("img")).toBeVisible();
  await page
    .getByRole("button", { name: "Delete image owl-icon.png", exact: true })
    .click();
  await expect(page.getByTestId("asset-usage")).toContainText(
    "2 soundboard icon(s)",
  );
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(trigger.locator("svg")).toHaveClass(/lucide-swords/);
  await expect(owl.locator("img")).toHaveCount(0);
  await expect.poll(playing).toBe(1);
  expect(errors).toEqual([]);
});
