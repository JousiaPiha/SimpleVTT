import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../src/server/app.js";
import { loadAdminPassword } from "../../src/server/services/startup-password.js";

test("first-run web setup persists, retries failed saves, and becomes ordinary sign-in", async ({
  page,
  browser,
}) => {
  const root = await mkdtemp(join(tmpdir(), "vtt-setup-browser-"));
  const passwordFile = join(root, "config", "admin-password.json");
  let app = await buildApp({
    dataDir: join(root, "data"),
    adminPassword: null,
    adminPasswordFile: passwordFile,
    logger: false,
  });
  const otherContext = await browser.newContext();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    let url = await app.listen({ host: "127.0.0.1", port: 0 });
    await page.goto(`${url}/admin`);
    await expect(page).toHaveTitle("SimpleVTT");
    await expect(
      page.getByRole("heading", { name: "Welcome to SimpleVTT" }),
    ).toBeVisible();
    await expect(page.getByLabel("Administrator password")).toHaveAttribute(
      "type",
      "password",
    );
    expect((await page.request.get(`${url}/api/admin/scenes`)).status()).toBe(
      401,
    );
    expect(
      (await (await page.request.get(`${url}/api/presentation`)).json()).scene,
    ).toBeNull();
    await page.screenshot({
      path: join(tmpdir(), "simple-vtt-web-setup-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Create password" }),
    ).toBeInViewport();
    await page.screenshot({
      path: join(tmpdir(), "simple-vtt-web-setup-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const other = await otherContext.newPage();
    await other.goto(`${url}/admin`);
    await expect(other.getByLabel("Confirm password")).toBeVisible();

    await page.getByLabel("Administrator password").fill("x");
    await page.getByLabel("Confirm password").fill("y");
    await page.getByRole("button", { name: "Create password" }).click();
    await expect(
      page.getByText("Passwords did not match.", { exact: true }),
    ).toBeVisible();
    await expect(stat(passwordFile)).rejects.toMatchObject({ code: "ENOENT" });
    await page.getByLabel("Confirm password").fill("x");
    // An actual persistence failure must retain the form and keep admin locked.
    await writeFile(join(root, "config"), "unwritable location");
    await page.getByRole("button", { name: "Create password" }).click();
    await expect(
      page.getByText(/Could not save the administrator password/),
    ).toBeVisible();
    await expect(page.getByLabel("Administrator password")).toHaveValue("x");
    expect((await page.request.get(`${url}/api/admin/scenes`)).status()).toBe(
      401,
    );
    await rm(join(root, "config"));
    await page.getByRole("button", { name: "Create password" }).click();
    await expect(
      page.getByRole("button", { name: "Sessions", exact: true }),
    ).toHaveText("Default Session");
    const saved = await readFile(passwordFile, "utf8");
    expect(JSON.parse(saved)).not.toHaveProperty("password");

    await other.getByLabel("Administrator password").fill("other");
    await other.getByLabel("Confirm password").fill("other");
    await other.getByRole("button", { name: "Create password" }).click();
    await expect(
      other.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(other.getByLabel("Confirm password")).toHaveCount(0);
    expect(await readFile(passwordFile, "utf8")).toBe(saved);

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await app.close();
    app = await buildApp({
      dataDir: join(root, "data"),
      adminPassword: await loadAdminPassword(passwordFile),
      adminPasswordFile: passwordFile,
      logger: false,
    });
    url = await app.listen({ host: "127.0.0.1", port: 0 });
    await page.goto(`${url}/admin`);
    await expect(page.getByLabel("Confirm password")).toHaveCount(0);
    await page.getByLabel("Administrator password").fill("x");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sessions", exact: true }),
    ).toHaveText("Default Session");
    expect(errors).toEqual([]);
  } finally {
    await otherContext.close();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
