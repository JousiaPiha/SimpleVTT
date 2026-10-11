import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const dot = (page: Page) => page.getByTestId("laser-dot");
async function canvasPoint(page: Page, x: number, y: number) {
  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error("Missing canvas");
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}
async function expectPosition(page: Page, x: number, y: number) {
  await expect(dot(page)).toBeVisible();
  const target = await canvasPoint(page, x, y);
  await expect
    .poll(async () => {
      const box = await dot(page).boundingBox();
      return box
        ? Math.abs(box.x + box.width / 2 - target.x) +
            Math.abs(box.y + box.height / 2 - target.y)
        : Infinity;
    })
    .toBeLessThan(3);
}

test("laser follows the GM on differently sized player displays, clears safely, and does not edit sprites", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin");
  await expect(page).toHaveTitle(/SimpleVTT/);
  await page.getByLabel("Administrator password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("New scene name").fill("Laser alpha");
  await page.getByRole("button", { name: "Create scene", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Laser alpha", exact: true }),
  ).toBeVisible();
  const button = page.getByRole("button", {
    name: "Laser pointer",
    exact: true,
  });
  await expect(button).toBeDisabled();
  await page
    .getByRole("button", { name: "Present scene", exact: true })
    .click();
  await page
    .getByLabel("Import images", { exact: true })
    .setInputFiles({
      name: "laser-hero.png",
      mimeType: "image/png",
      buffer: await readFile("tests/fixtures/hero.png"),
    });
  await page
    .getByRole("button", { name: "Add laser-hero.png to scene", exact: true })
    .click();
  await expect(page.getByLabel("Object name")).toHaveValue("laser-hero.png");
  const beforeX = await page.getByLabel("X position").inputValue();
  const beforeY = await page.getByLabel("Y position").inputValue();
  const before = await (await page.request.get("/api/presentation")).json();
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const player = await context.newPage();
  player.on("pageerror", (e) => errors.push(e.message));
  await player.goto("/player");
  await expect(player.locator("canvas")).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("Hold and move on the scene to point", { exact: false }),
  ).toBeVisible();
  let start = await canvasPoint(page, 0.46, 0.45);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expectPosition(player, 0.46, 0.45);
  const end = await canvasPoint(page, 0.68, 0.6);
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expectPosition(player, 0.68, 0.6);
  await expectPosition(page, 0.68, 0.6);
  // A stationary held pointer survives the 1.5 s expiry through keepalives.
  await page.waitForTimeout(1700);
  await expect(dot(player)).toBeVisible();
  await page.screenshot({ path: "/private/tmp/simple-vtt-laser-admin.png" });
  await player.screenshot({ path: "/private/tmp/simple-vtt-laser-player.png" });
  await page.mouse.up();
  await expect(dot(player)).toBeHidden();
  expect(await page.getByLabel("X position").inputValue()).toBe(beforeX);
  expect(await page.getByLabel("Y position").inputValue()).toBe(beforeY);
  expect(await (await page.request.get("/api/presentation")).json()).toEqual(
    before,
  );
  await player.setViewportSize({ width: 620, height: 400 });
  await page.setViewportSize({ width: 780, height: 1000 });
  await expect(button).toBeInViewport();
  start = await canvasPoint(page, 0.35, 0.3);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expectPosition(player, 0.35, 0.3);
  await page.screenshot({ path: "/private/tmp/simple-vtt-laser-narrow.png" });
  await page.mouse.move(0, 0);
  await expect(dot(player)).toBeHidden();
  await page.mouse.up();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(dot(player)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dot(player)).toBeHidden();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await page.mouse.up();
  await button.click();
  await expect(
    page.getByText("Hold and move on the scene to point", { exact: false }),
  ).toBeVisible();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(dot(player)).toBeVisible();
  // Reload tears down the controller and never restores its transient pointer.
  await page.reload();
  await page.mouse.up();
  await expect(dot(player)).toBeHidden();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await player.reload();
  await expect(dot(player)).toBeHidden();
  expect(errors).toEqual([]);
  await context.close();
});
