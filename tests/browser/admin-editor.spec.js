const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

test("admin preview cannot execute stored active HTML", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page);
  await page.addInitScript(() => { window.__previewAttack = 0; });
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.insertText('<section class="footnotes"><ol><li id="fn-1"><p><img src=x onerror="window.__previewAttack=1">safe<a class="footnote" href="#fnref-1">↗︎</a></p></li></ol></section>');
  await page.getByRole("navigation", { name: "Editor" }).getByRole("button", { name: "Vorschau" }).click();
  await expect(page.locator("#previewPanel")).toContainText("safe");
  await expect.poll(() => page.evaluate(() => window.__previewAttack)).toBe(0);
  await expect(page.locator("#previewPanel [onerror]")).toHaveCount(0);
});

test("select all in the article editor stays inside the article text", async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Hardware keyboard select-all is covered by desktop browsers.");
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Dieser Titel gehört nicht zum Artikeltext");

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.insertText("Nur dieser Artikeltext soll markiert werden.");
  await expect(editor).toHaveText("Nur dieser Artikeltext soll markiert werden.");
  await editor.click();
  const selectAllShortcut = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
    ? "Meta+a"
    : "Control+a";
  await editor.press(selectAllShortcut);

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || ""))
    .toBe("Nur dieser Artikeltext soll markiert werden.");
  await page.keyboard.insertText("Ersetzt");
  await expect(editor).toHaveText("Ersetzt");
  await expect(page.getByPlaceholder("Titel")).toHaveValue("Dieser Titel gehört nicht zum Artikeltext");
});
