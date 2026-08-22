const { test, expect } = require("@playwright/test");
const { useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

// The admin shell's viewport behaviour — collapsed sidebar, mobile navigation, history — is the
// one part of the admin that genuinely differs per device, so playwright.config.js runs this file
// in the viewport projects while the rest of the admin suite runs once. Each test still names the
// project it targets: the file is the selection, the skips are the precision.
test("mobile navigation opens and exposes the primary sections", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only interaction");
  await page.goto("/admin/");

  const toggle = page.getByRole("button", { name: "Seitenleiste ausklappen" });
  await expect(toggle).toBeVisible();
  await toggle.click();

  await expect(page.getByRole("button", { name: "Artikel", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mediathek", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Einstellungen", exact: true })).toBeVisible();

  await page.goBack();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("body")).toHaveClass(/is-sidebar-collapsed/);
});

test("desktop sidebar stays open and browser back navigates immediately", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "Desktop-only interaction");
  await page.goto("/admin/");

  await expect(page.locator("#sidebarToggle")).toBeHidden();
  await expect(page.getByRole("button", { name: "Artikel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Seiten", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pages", exact: true })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Articles", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Artikel", exact: true })).toBeVisible();
});

test("mobile sidebar is hidden before startup requests finish", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only startup regression");
  const htmlResponse = await page.request.get("/admin/");
  expect(await htmlResponse.text()).toContain('<body class="admin-body is-sidebar-collapsed is-sidebar-initializing">');
  await page.unroute("**/api/admin/auth/session");
  await page.route("**/api/admin/auth/session", () => {});

  await page.goto("/admin/", { waitUntil: "domcontentloaded" });

  await expect(page.locator("body")).toHaveClass(/is-sidebar-collapsed/);
  await expect(page.locator("#sidebar")).toHaveCSS("transform", /matrix\(1, 0, 0, 1, -/);
  await expect(page.getByRole("button", { name: "Seitenleiste ausklappen" })).toBeVisible();
});
