import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, rm, readFile, rename } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const choose = async (
  page: Page,
  action: "Save Session As…" | "Open Session…",
  path: string,
) => {
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  await page.getByLabel("Server folder path").fill(path);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page.getByLabel("Server folder path")).toBeEnabled();
  await page
    .getByRole("button", {
      name: action.startsWith("Save")
        ? "Save in this folder"
        : "Open this session",
      exact: true,
    })
    .click();
};

test("sessions copy drafts, autosave independently, reopen blank, and browse folders", async ({
  page,
  browser,
}) => {
  const root = await mkdtemp(join(tmpdir(), "simple-vtt-session-e2e-"));
  const destination = join(root, "Temple session");
  await mkdir(destination);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/admin");
    await page.getByLabel("Administrator password").fill("test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("New scene name").fill("Portable temple");
    await page
      .getByRole("button", { name: "Create scene", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Present scene", exact: true })
      .click();
    await page
      .getByLabel("Import images")
      .setInputFiles("tests/fixtures/hero.png");
    await expect(
      page.getByRole("button", { name: "Add hero.png to scene" }).first(),
    ).toBeVisible();
    const playerContext = await browser.newContext();
    const player = await playerContext.newPage();
    await player.goto("/player");
    await choose(page, "Save Session As…", destination);
    await expect(
      page.getByRole("button", { name: "Sessions", exact: true }),
    ).toHaveText("Temple session", { timeout: 15000 });
    await expect(
      page.getByRole("button", { name: "Edit Portable temple", exact: true }),
    ).toBeVisible();
    expect(
      (await (await player.request.get("/api/presentation")).json()).scene,
    ).toBeNull();
    expect(
      JSON.parse(await readFile(join(destination, "session.json"), "utf8"))
        .application,
    ).toBe("SimpleVTT");
    await page.getByLabel("New scene name").fill("Only in named session");
    await page
      .getByRole("button", { name: "Create scene", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Only in named session" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Close Session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Sessions", exact: true }),
    ).toHaveText("Default Session");
    await expect(
      page.getByRole("button", {
        name: "Edit Only in named session",
        exact: true,
      }),
    ).toHaveCount(0);
    await choose(page, "Open Session…", destination);
    await expect(
      page.getByRole("button", { name: "Sessions", exact: true }),
    ).toHaveText("Temple session");
    await page
      .getByRole("button", { name: "Edit Only in named session", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Only in named session" }),
    ).toBeVisible();
    expect(
      (await (await player.request.get("/api/presentation")).json()).scene,
    ).toBeNull();
    await page
      .getByRole("button", { name: "Present scene", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await player.request.get("/api/presentation")).json()).scene
            ?.id,
      )
      .toBeTruthy();
    // An explicit draft must survive a refused session change.
    await page.getByLabel("New scene name").fill("Unfinished draft");
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Close Session", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Session needs attention" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to workspace" }).click();
    await expect(page.getByLabel("New scene name")).toHaveValue(
      "Unfinished draft",
    );
    await page.getByLabel("New scene name").fill("");
    await page.screenshot({
      path: "test-results/sessions-admin.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Open Session…", exact: true })
      .click();
    await expect(page.getByLabel("Server folder path")).toBeEnabled();
    await page.screenshot({
      path: "test-results/sessions-picker.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Close Session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Sessions", exact: true }),
    ).toHaveText("Default Session");
    await playerContext.close();
    expect(errors).toEqual([]);
  } finally {
    // The isolated test server owns these files, never the user's default data.
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid folders retain the session and restored storage retains local drafts", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "simple-vtt-recovery-e2e-"));
  const destination = join(root, "Recovery session");
  const moved = join(root, "Disconnected session");
  await mkdir(destination);
  try {
    await page.goto("/admin");
    await page.getByLabel("Administrator password").fill("test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sessions", exact: true }),
    ).toHaveText("Default Session");
    await choose(page, "Open Session…", destination);
    await expect(page.getByRole("status")).toContainText(
      "Session operation failed",
    );
    await expect(
      page.getByRole("button", { name: "Sessions", exact: true }),
    ).toHaveText("Default Session");
    await choose(page, "Save Session As…", destination);
    await expect(
      page.getByRole("button", { name: "Sessions", exact: true }),
    ).toHaveText("Recovery session");
    await page.getByLabel("New scene name").fill("Retain this draft");
    await rename(destination, moved);
    await expect(
      page.getByText("Session storage needs attention", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel("New scene name")).toHaveValue(
      "Retain this draft",
    );
    await expect(
      page
        .locator("[inert]")
        .filter({ has: page.getByLabel("New scene name") }),
    ).toHaveCount(1);
    await page.screenshot({
      path: "test-results/sessions-recovery.png",
      fullPage: true,
    });
    await rename(moved, destination);
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Retry session storage" }).click();
    await expect(
      page.getByText("Session storage needs attention", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("New scene name")).toHaveValue(
      "Retain this draft",
    );
    await page.getByLabel("New scene name").fill("");
    await page.setViewportSize({ width: 780, height: 1000 });
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Save Session As…", exact: true })
      .click();
    await expect(page.getByLabel("Server folder path")).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Save in this folder" }),
    ).toBeDisabled();
    await page
      .getByLabel("Server folder path")
      .fill(join(root, "Missing drive"));
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Folder not found");
    await page.screenshot({
      path: "test-results/sessions-picker-narrow.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.getByLabel("Server folder path")).toHaveValue(homedir());
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Close Session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Sessions", exact: true }),
    ).toHaveText("Default Session");
  } finally {
    await rename(moved, destination).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
