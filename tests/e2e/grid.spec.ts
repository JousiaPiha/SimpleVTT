import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

const pixel = (page: Page, x: number, y: number) =>
  page.locator("canvas").evaluate(
    (canvas, point) => {
      const c = canvas as HTMLCanvasElement;
      return Array.from(
        c
          .getContext("2d")!
          .getImageData(
            Math.floor((point.x * c.width) / 1920),
            Math.floor((point.y * c.height) / 1080),
            1,
            1,
          ).data,
      );
    },
    { x, y },
  );

test("scene grid scales, syncs, persists and leaves sprites draggable", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin");
  await page.getByLabel("Administrator password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("New scene name").fill("Grid alpha");
  await page.getByRole("button", { name: "Create scene", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Grid alpha", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Present scene", exact: true })
    .click();
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const player = await context.newPage();
  player.on("pageerror", (e) => errors.push(e.message));
  await player.goto("/player");
  await expect.poll(() => pixel(player, 120, 55)).toEqual([14, 17, 22, 255]);
  await page
    .getByRole("button", { name: "Scene grid settings", exact: true })
    .click();
  await page
    .getByRole("switch", { name: "Show scene grid", exact: true })
    .check();
  await page
    .getByRole("textbox", { name: "Grid spacing", exact: true })
    .fill("120");
  await page
    .getByRole("textbox", { name: "Grid color", exact: true })
    .fill("#ff0000");
  const slider = page.getByRole("slider", {
    name: "Grid spacing slider",
    exact: true,
  });
  await slider.focus();
  await slider.press("Home");
  await expect(
    page.getByRole("textbox", { name: "Grid spacing", exact: true }),
  ).toHaveValue("20");
  await expect
    .poll(async () => (await pixel(page, 20, 55))[0])
    .toBeGreaterThan(40);
  // Preview changes must not reach the live display until Apply.
  expect(await pixel(player, 20, 55)).toEqual([14, 17, 22, 255]);
  await page.keyboard.press("Escape");
  await expect.poll(() => pixel(page, 20, 55)).toEqual([14, 17, 22, 255]);
  await page
    .getByRole("button", { name: "Scene grid settings", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Grid spacing", exact: true }),
  ).toHaveValue("80");
  await page
    .getByRole("switch", { name: "Show scene grid", exact: true })
    .check();
  const track = await page
    .locator(".mantine-Slider-root")
    .filter({ has: slider })
    .boundingBox();
  if (!track) throw new Error("Missing grid slider");
  await page.mouse.move(
    track.x + track.width * 0.4,
    track.y + track.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    track.x + track.width * 0.75,
    track.y + track.height / 2,
  );
  const draggedSize = Number(
    await page
      .getByRole("textbox", { name: "Grid spacing", exact: true })
      .inputValue(),
  );
  expect(draggedSize).toBeGreaterThan(200);
  await expect
    .poll(async () => (await pixel(page, draggedSize, 55))[0])
    .toBeGreaterThan(40);
  expect(await pixel(player, draggedSize, 55)).toEqual([14, 17, 22, 255]);
  await page.mouse.up();
  await page
    .getByRole("textbox", { name: "Grid spacing", exact: true })
    .fill("120");
  await page
    .getByRole("textbox", { name: "Grid color", exact: true })
    .fill("#ff0000");
  await page.getByRole("button", { name: "Apply grid", exact: true }).click();
  await expect
    .poll(async () => (await pixel(player, 120, 55))[0])
    .toBeGreaterThan(40);
  await expect.poll(() => pixel(player, 60, 55)).toEqual([14, 17, 22, 255]);
  await page.reload();
  await page
    .getByRole("button", { name: "Scene grid settings", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "Show scene grid", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("textbox", { name: "Grid spacing", exact: true }),
  ).toHaveValue("120");
  await expect(
    page.getByRole("textbox", { name: "Grid color", exact: true }),
  ).toHaveValue("#ff0000");
  await page.keyboard.press("Escape");
  await player.setViewportSize({ width: 620, height: 400 });
  await expect
    .poll(async () => (await pixel(player, 120, 55))[0])
    .toBeGreaterThan(40);
  await player.reload();
  await expect
    .poll(async () => (await pixel(player, 120, 55))[0])
    .toBeGreaterThan(40);
  await page.getByLabel("Import images", { exact: true }).setInputFiles({
    name: "grid-hero.png",
    mimeType: "image/png",
    buffer: await readFile("tests/fixtures/hero.png"),
  });
  await page
    .getByRole("button", { name: "Add grid-hero.png to scene", exact: true })
    .click();
  await expect(page.getByLabel("Object name")).toHaveValue("grid-hero.png");
  const canvas = await page.locator("canvas").boundingBox();
  if (!canvas) throw new Error("No canvas");
  await page.mouse.move(
    canvas.x + (canvas.width * 880) / 1920,
    canvas.y + (canvas.height * 480) / 1080,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvas.x + (canvas.width * 1000) / 1920,
    canvas.y + (canvas.height * 600) / 1080,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByLabel("X position").inputValue()))
    .toBeGreaterThan(850);
  await page
    .getByRole("button", { name: "Scene grid settings", exact: true })
    .click();
  await expect(
    page
      .locator(".mantine-Popover-dropdown")
      .filter({
        has: page.getByRole("button", { name: "Apply grid", exact: true }),
      }),
  ).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "/private/tmp/simple-vtt-grid-admin.png",
    fullPage: false,
  });
  await player.screenshot({
    path: "/private/tmp/simple-vtt-grid-player.png",
    fullPage: false,
  });
  await page
    .getByRole("switch", { name: "Show scene grid", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Apply grid", exact: true }).click();
  await expect.poll(() => pixel(player, 120, 55)).toEqual([14, 17, 22, 255]);
  await page.setViewportSize({ width: 780, height: 1000 });
  await page
    .getByRole("button", { name: "Scene grid settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply grid", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page
      .locator(".mantine-Popover-dropdown")
      .filter({
        has: page.getByRole("button", { name: "Apply grid", exact: true }),
      }),
  ).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "/private/tmp/simple-vtt-grid-narrow.png",
    fullPage: false,
  });
  expect(errors).toEqual([]);
  await context.close();
});
