const { test, expect } = require("@playwright/test");
const { useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

// The admin shell's viewport behaviour — the bottom tab bar, the full-screen editor, history — is
// the one part of the admin that genuinely differs per device, so playwright.config.js runs this
// file in the viewport projects while the rest of the admin suite runs once. Each test still names
// the project it targets: the file is the selection, the skips are the precision.
test("mobile sections are reachable without opening anything", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only interaction");
  await page.goto("/admin/");

  // No drawer to reveal them: every destination is on screen from the start.
  await expect(page.getByRole("button", { name: "Artikel", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mediathek", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Einstellungen", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Seiten", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pages", exact: true })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Articles", exact: true })).toBeVisible();
});

test("mobile tab bar sits below the content it must not cover", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only layout");
  await page.goto("/admin/");

  const viewport = page.viewportSize();
  const bar = await page.locator("#sidebar").boundingBox();
  expect(bar.y + bar.height).toBeCloseTo(viewport.height, 0);
  // The workspace has to end above the bar, or the last list row is untappable.
  const workspacePadding = await page.locator("#content").evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom));
  expect(workspacePadding).toBeGreaterThanOrEqual(bar.height);

  // Publish is an action with a state: with nothing pending it costs no space.
  await expect(page.locator("#syncButton")).toBeHidden();
});

test("mobile editor hides the tab bar and leads back out", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only interaction");
  await page.goto("/admin/");

  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator("#editorForm")).toBeVisible();
  // Full-screen editing: the bar would sit under the keyboard anyway.
  await expect(page.locator("#sidebar")).toBeHidden();

  // A standalone PWA has no browser back button, so this is the only way out.
  const back = page.getByRole("button", { name: "Zurück zur Liste" });
  await expect(back).toBeVisible();
  await back.click();

  await expect(page.locator("#editorForm")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Articles", exact: true })).toBeVisible();
  await expect(page.locator("#sidebar")).toBeVisible();
});

test("desktop keeps the sidebar and needs no back button", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "Desktop-only interaction");
  await page.goto("/admin/");

  await expect(page.getByRole("button", { name: "Artikel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Seiten", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pages", exact: true })).toBeVisible();

  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator("#editorForm")).toBeVisible();
  // The sidebar never leaves, so the editor's back button stays a phone affordance.
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zurück zur Liste" })).toBeHidden();

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Pages", exact: true })).toBeVisible();
});

test("mobile navigation works before startup requests finish", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only startup regression");
  await page.unroute("**/api/admin/auth/session");
  await page.route("**/api/admin/auth/session", () => {});

  await page.goto("/admin/", { waitUntil: "domcontentloaded" });

  // The bar is markup, not state: it must not wait for the session to resolve.
  await expect(page.getByRole("button", { name: "Artikel", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mediathek", exact: true })).toBeVisible();
});
