import { test, expect } from "@playwright/test";

test("GM prepares private text and loot, reveals, edits, pages and reuses saved content", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin");
  await page.getByLabel("Administrator password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("New scene name").fill("Chapter one");
  await page.getByRole("button", { name: "Create scene" }).click();
  await page
    .getByRole("button", { name: "Present scene", exact: true })
    .click();
  const playerContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const player = await playerContext.newPage();
  player.on("pageerror", (e) => errors.push(e.message));
  const messages: string[] = [];
  player.on("websocket", (ws) =>
    ws.on("framereceived", (e) => messages.push(e.payload.toString())),
  );
  await player.goto("/player");
  const publicState = async () =>
    (await (await player.request.get("/api/presentation")).json()).scene;
  await page.getByRole("tab", { name: "Text & loot", exact: true }).click();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await expect(page.getByLabel("GM content name")).toHaveValue("New text");
  await page.getByLabel("GM content name").fill("Private chapter label");
  await page.getByLabel("Display text").fill("The forgotten gate");
  await page.getByRole("button", { name: "Save content", exact: true }).click();
  await expect(
    page.getByText("Content saved. Drag it on the canvas to position it."),
  ).toBeVisible();
  expect((await publicState()).content).toEqual([]);
  expect(messages.join("")).not.toContain("forgotten");
  await page
    .getByRole("switch", { name: "Content visible to players" })
    .check();
  await expect
    .poll(async () => (await publicState()).content[0]?.text)
    .toBe("The forgotten gate");
  expect(messages.join("")).not.toContain("Private chapter label");
  // Unsaved edits and hide/reveal do not publish a draft.
  await page.getByLabel("Display text").fill("Beyond the gate");
  await page
    .getByRole("switch", { name: "Content visible to players" })
    .uncheck();
  await expect.poll(async () => (await publicState()).content.length).toBe(0);
  await page
    .getByRole("switch", { name: "Content visible to players" })
    .check();
  await expect
    .poll(async () => (await publicState()).content[0]?.text)
    .toBe("The forgotten gate");
  await page.getByRole("tab", { name: "Objects", exact: true }).click();
  await page.getByRole("tab", { name: "Text & loot", exact: true }).click();
  await expect(page.getByLabel("Display text")).toHaveValue("Beyond the gate");
  await page.getByRole("button", { name: "Save content", exact: true }).click();
  await expect
    .poll(async () => (await publicState()).content[0]?.text)
    .toBe("Beyond the gate");
  await expect(
    page.getByRole("button", { name: "Save content", exact: true }),
  ).toBeDisabled();
  const canvas = await page.locator("canvas").boundingBox();
  const scale = canvas!.width / 1920;
  await page.mouse.move(canvas!.x + 180 * scale, canvas!.y + 280 * scale);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + 380 * scale, canvas!.y + 380 * scale, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await publicState()).content[0]?.x))
    .toBe(300);
  // Inspect actual rendered pixels: the revealed panel differs from the neutral scene.
  await expect
    .poll(() =>
      player.locator("canvas").evaluate((c) => {
        const canvas = c as HTMLCanvasElement;
        return Array.from(
          canvas
            .getContext("2d")!
            .getImageData(
              Math.floor((320 * canvas.width) / 1920),
              Math.floor((220 * canvas.height) / 1080),
              1,
              1,
            ).data,
        );
      }),
    )
    .toEqual([17, 24, 32, 255]);
  await page.getByRole("button", { name: "Add loot", exact: true }).click();
  await expect(page.getByLabel("GM content name")).toHaveValue("New loot");
  await page.getByLabel("GM content name").fill("Treasure");
  await page.getByLabel("Loot title").fill("Chest contents");
  await page
    .getByLabel("Loot description")
    .fill("A reward for opening the gate");
  for (let i = 1; i <= 5; i++) {
    await page
      .getByRole("button", { name: "Add loot item", exact: true })
      .click();
    await page.getByLabel(`Item ${i} name`, { exact: true }).fill(`Gem ${i}`);
    await page
      .getByLabel(`Item ${i} quantity`, { exact: true })
      .fill(String(i));
    await page
      .getByLabel(`Item ${i} description`, { exact: true })
      .fill("A polished stone");
  }
  await page.getByLabel("Content width").fill("700");
  await page.getByRole("button", { name: "Save content", exact: true }).click();
  await expect(
    page.getByText("Content saved. Drag it on the canvas to position it."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit content Treasure", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("GM content name")).toHaveValue("Treasure");
  await page.getByLabel("Content X", { exact: true }).fill("1100");
  await page.getByLabel("Content X", { exact: true }).blur();
  expect(JSON.stringify(await publicState())).not.toContain("Gem");
  await page
    .getByRole("switch", { name: "Content visible to players" })
    .check();
  await expect.poll(async () => (await publicState()).content.length).toBe(2);
  await expect
    .poll(() =>
      player.locator("canvas").evaluate((c) => {
        const canvas = c as HTMLCanvasElement;
        return canvas
          .getContext("2d")!
          .getImageData(
            Math.floor((1120 * canvas.width) / 1920),
            Math.floor((120 * canvas.height) / 1080),
            1,
            1,
          ).data[0];
      }),
    )
    .toBe(17);
  // A stale page can remain after shortening a list; Previous must move the displayed page immediately.
  const live = await publicState();
  const loot = live.content.find((i: { type: string }) => i.type === "loot");
  expect(
    (
      await page.request.patch(
        `/api/admin/scenes/${live.id}/content/${loot.id}`,
        { data: { page: 24 }, headers: { origin: "http://127.0.0.1:3100" } },
      )
    ).ok(),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Edit Chapter one", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit content Treasure", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Previous loot page", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await publicState()).content.find(
          (i: { type: string }) => i.type === "loot",
        )?.page,
    )
    .toBe(0);
  const firstPage = await player
    .locator("canvas")
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await page
    .getByRole("button", { name: "Next loot page", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await publicState()).content.find(
          (i: { type: string }) => i.type === "loot",
        )?.page,
    )
    .toBe(1);
  await expect
    .poll(() =>
      player
        .locator("canvas")
        .evaluate((c) => (c as HTMLCanvasElement).toDataURL()),
    )
    .not.toBe(firstPage);
  await player.reload();
  await expect(player.locator("canvas")).toBeVisible();
  await player.screenshot({ path: "test-results/content-player.png" });
  await page.screenshot({
    path: "test-results/content-editor.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/content-editor-1280.png",
    fullPage: true,
  });
  await page.getByLabel("New scene name").fill("Chapter two");
  await page.getByRole("button", { name: "Create scene" }).click();
  await expect(
    page.getByRole("heading", { name: "Chapter two" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Copy from scene", exact: true })
    .click();
  await page.getByRole("option", { name: "Chapter one", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Prepared content", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Private chapter label (text)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy into current scene", exact: true })
    .click();
  await expect(page.getByLabel("Display text")).toHaveValue("Beyond the gate");
  await expect(
    page.getByRole("switch", { name: "Content visible to players" }),
  ).not.toBeChecked();
  expect((await publicState()).content.length).toBe(2);
  await page
    .getByRole("button", { name: "Present scene", exact: true })
    .click();
  await expect.poll(async () => (await publicState()).content.length).toBe(0);
  await page.reload();
  await page.getByRole("tab", { name: "Text & loot", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Edit content Private chapter label",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Display text")).toHaveValue("Beyond the gate");
  await page
    .getByRole("button", { name: "Remove content", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove permanently", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Edit content Private chapter label",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  await playerContext.close();
});
