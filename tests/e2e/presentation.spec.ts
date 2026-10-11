import { test, expect } from "@playwright/test";

test("GM prepares and reveals a persistent scene while players receive only public data", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin");
  await page.getByLabel("Administrator password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("New scene name").fill("The old observatory");
  await page.getByRole("button", { name: "Create scene" }).click();
  await expect(
    page.getByRole("heading", { name: "The old observatory" }),
  ).toBeVisible();
  const playerContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const player = await playerContext.newPage();
  const messages: string[] = [];
  player.on("websocket", (ws) =>
    ws.on("framereceived", (event) => messages.push(event.payload.toString())),
  );
  await player.goto("/player");
  await page
    .getByRole("button", { name: "Present scene", exact: true })
    .click();
  await page
    .getByLabel("Import images")
    .setInputFiles("tests/fixtures/hero.png");
  await expect(
    page.getByRole("button", { name: "Add hero.png to scene" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add hero.png to scene" }).click();
  await expect(page.getByLabel("Object name")).toHaveValue("hero.png");
  const hiddenState = await (
    await player.request.get("/api/presentation")
  ).json();
  expect(hiddenState.scene.objects).toEqual([]);
  expect(messages.join("")).not.toContain("hero.png");
  const hiddenPixel = await page.locator("canvas").evaluate((canvas) => {
    const c = canvas as HTMLCanvasElement;
    return Array.from(
      c
        .getContext("2d")!
        .getImageData(
          Math.floor((880 * c.width) / 1920),
          Math.floor((480 * c.height) / 1080),
          1,
          1,
        ).data,
    );
  });
  expect(hiddenPixel[1]).toBeGreaterThanOrEqual(99);
  expect(hiddenPixel[1]).toBeLessThanOrEqual(101);
  await page.getByRole("switch", { name: "Visible to players" }).check();
  await expect
    .poll(
      async () =>
        (await (await player.request.get("/api/presentation")).json()).scene
          .objects.length,
    )
    .toBe(1);
  await page.getByLabel("X position").fill("500");
  await page.getByLabel("X position").blur();
  await expect
    .poll(
      async () =>
        (await (await player.request.get("/api/presentation")).json()).scene
          .objects[0].x,
    )
    .toBe(500);
  // Check real canvas pixels: transparent borders preserve the background.
  const pixel = (target: typeof player, x: number, y: number) =>
    target.locator("canvas").evaluate(
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
  await expect.poll(() => pixel(player, 580, 480)).toEqual([36, 183, 171, 255]);
  await expect.poll(() => pixel(player, 505, 385)).toEqual([14, 17, 22, 255]);

  // Drag uses logical coordinates even though the editor canvas is scaled.
  const canvas = await page.locator("canvas").boundingBox();
  const scale = canvas!.width / 1920;
  await page.mouse.move(canvas!.x + 580 * scale, canvas!.y + 480 * scale);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + 780 * scale, canvas!.y + 580 * scale, {
    steps: 10,
  });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Math.round(
        (await (await player.request.get("/api/presentation")).json()).scene
          .objects[0].x,
      ),
    )
    .toBe(700);
  await expect
    .poll(async () =>
      Math.abs(
        (await (await player.request.get("/api/presentation")).json()).scene
          .objects[0].y - 480,
      ),
    )
    .toBeLessThan(1 / scale);
  const moved = (await (await player.request.get("/api/presentation")).json())
    .scene.objects[0];
  await page.mouse.move(
    canvas!.x + (moved.x + moved.width) * scale,
    canvas!.y + (moved.y + moved.height) * scale,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvas!.x + (moved.x + moved.width * 1.5) * scale,
    canvas!.y + (moved.y + moved.height * 1.5) * scale,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await (await player.request.get("/api/presentation")).json()).scene
          .objects[0].scale,
    )
    .toBeGreaterThan(1.2);
  await page.getByLabel("Scale", { exact: true }).fill("1.5");
  await page.getByLabel("Rotation", { exact: true }).fill("45");
  await page.getByLabel("Rotation", { exact: true }).blur();
  await expect
    .poll(
      async () =>
        (await (await player.request.get("/api/presentation")).json()).scene
          .objects[0].rotation,
    )
    .toBe(45);
  await expect
    .poll(
      async () =>
        (await (await player.request.get("/api/presentation")).json()).scene
          .objects[0].scale,
    )
    .toBe(1.5);
  await page
    .getByLabel("Import images")
    .setInputFiles("tests/fixtures/background.png");
  await page
    .getByRole("button", { name: "Set background.png as background" })
    .click();
  await expect
    .poll(
      async () =>
        (await (await player.request.get("/api/presentation")).json()).scene
          .backgroundAssetId,
    )
    .toBeTruthy();
  await expect(player.locator("canvas")).toBeVisible();
  const size = await player.locator("canvas").boundingBox();
  expect(size!.width / size!.height).toBeCloseTo(16 / 9, 2);
  await player.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await player.locator("canvas").boundingBox())!.width)
    .toBeLessThanOrEqual(390);
  const portrait = await player.locator("canvas").boundingBox();
  expect(portrait!.width).toBeLessThanOrEqual(390);
  expect(portrait!.width / portrait!.height).toBeCloseTo(16 / 9, 2);
  await player.reload();
  await expect(player.locator("canvas")).toBeVisible();
  const saved = (await (await player.request.get("/api/presentation")).json())
    .scene.objects[0];
  await page.reload();
  await page.getByRole("button", { name: "Edit The old observatory" }).click();
  await page.getByRole("button", { name: "Select hero.png" }).click();
  await expect
    .poll(async () => Number(await page.getByLabel("X position").inputValue()))
    .toBe(Number(saved.x.toFixed(1)));
  await page.getByRole("switch", { name: "Visible to players" }).uncheck();
  await expect
    .poll(
      async () =>
        (await (await player.request.get("/api/presentation")).json()).scene
          .objects.length,
    )
    .toBe(0);
  await expect(player.getByRole("button")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/admin.png", fullPage: true });
  await playerContext.close();
});
