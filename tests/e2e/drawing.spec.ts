import { test, expect, type Page } from "@playwright/test";
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error("No canvas");
  await page.mouse.move(
    box.x + box.width * from[0],
    box.y + box.height * from[1],
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], {
    steps: 12,
  });
  await page.mouse.up();
}
test("draw, erase, sync, reload, and switch tools without editing scene objects", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin");
  await page.getByLabel("Administrator password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("New scene name").fill("Drawing alpha");
  await page.getByRole("button", { name: "Create scene", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Drawing alpha", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Present scene", exact: true })
    .click();
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const player = await context.newPage();
  await player.goto("/player");
  const marks = (p: Page) => p.locator(".drawing-overlay [data-drawing-id]");
  for (const [index, name] of ["Freehand", "Oval", "Rectangle"].entries()) {
    await page.getByRole("button", { name, exact: true }).click();
    await drag(page, [0.1 + index * 0.25, 0.2], [0.25 + index * 0.25, 0.5]);
    await expect(marks(page)).toHaveCount(index + 1);
    await expect(marks(player)).toHaveCount(index + 1);
  }
  await expect(marks(player).nth(1)).toHaveAttribute("rx", /\d/);
  await expect(marks(player).nth(2)).toHaveAttribute("width", /\d/);
  await page.reload();
  await expect(marks(page)).toHaveCount(3);
  await player.reload();
  await expect(marks(player)).toHaveCount(3);
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  const rect = await marks(page).nth(2).boundingBox();
  if (!rect) throw new Error("No rectangle");
  await page.mouse.click(rect.x + rect.width / 2, rect.y);
  await expect(marks(player)).toHaveCount(2);
  await expect(marks(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Freehand", exact: true }).click();
  await page
    .getByRole("button", { name: "Laser pointer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Freehand", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Select and move", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByLabel("Drawing line width").selectOption("10");
  await drag(page, [0.65, 0.7], [0.4, 0.55]);
  await expect(marks(player)).toHaveCount(3);
  await expect(marks(player).nth(2)).toHaveAttribute("stroke-width", "10");
  await page.screenshot({ path: "/private/tmp/simple-vtt-drawing-admin.png" });
  await player.screenshot({
    path: "/private/tmp/simple-vtt-drawing-player.png",
  });
  await page.setViewportSize({ width: 780, height: 1000 });
  await expect(
    page.getByRole("button", { name: "Freehand", exact: true }),
  ).toBeInViewport();
  await player.setViewportSize({ width: 620, height: 400 });
  await page.screenshot({ path: "/private/tmp/simple-vtt-drawing-narrow.png" });
  expect(errors).toEqual([]);
  await context.close();
});
