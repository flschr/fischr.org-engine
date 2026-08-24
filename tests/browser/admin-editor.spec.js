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
  await page.keyboard.insertText('<section class="footnotes"><ol><li id="fn-1"><p><img src=x onerror="window.__previewAttack=1">safe<a class="footnote" href="#fnref-1">↑︎</a></p></li></ol></section>');
  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Vorschau" }).click();
  await expect(page.locator("#previewPanel")).toContainText("safe");
  await expect.poll(() => page.evaluate(() => window.__previewAttack)).toBe(0);
  await expect(page.locator("#previewPanel [onerror]")).toHaveCount(0);
});

test("admonition toolbar wraps selected text and previews the chosen type", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.insertText("Selected warning text");
  await editor.press("Shift+Home");
  await page.getByRole("button", { name: "Weitere Einfügungen" }).click();
  await page.getByRole("dialog", { name: "Weitere Einfügungen" }).getByRole("button", { name: "Hinweis einfügen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Typ", { exact: true }).selectOption("CAUTION");
  await dialog.getByLabel("Titel", { exact: true }).fill("Back up first");
  await dialog.getByRole("button", { name: "Einfügen" }).click();

  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Vorschau" }).click();
  await expect(page.getByRole("note", { name: "Vorsicht", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Artikeloptionen" }).click();
  await page.getByLabel("Sprache").selectOption("en");

  const admonition = page.locator("#previewPanel .admonition-caution");
  await expect(page.getByRole("note", { name: "Caution", exact: true })).toBeVisible();
  await expect(admonition).toContainText("Back up first");
  await expect(admonition).toContainText("Selected warning text");
  await expect(admonition.locator(".admonition-icon")).toBeVisible();
});

test("select all in the article editor stays inside the article text", async ({ page }) => {
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

test("dismissing the article menu never repeats the action chosen last time", async ({ page }) => {
  // Engine-sensitive by nature, which is why it lives in this file. WebKit
  // leaves <dialog>.returnValue untouched when the dialog is dismissed with
  // Escape; Chromium clears it to "". Without an explicit reset before every
  // showModal(), a "delete" picked earlier is still sitting in returnValue and
  // fires again on the next dismissal — destructively, and only on the browser
  // this admin is actually written on.
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Menü zweimal öffnen");

  const openMenu = () => page.getByRole("navigation", { name: "Artikel" })
    .getByRole("button", { name: "Weitere Artikelaktionen" }).click();

  await openMenu();
  await page.getByRole("dialog", { name: "Weitere Artikelaktionen" })
    .getByRole("button", { name: "Artikel löschen" }).click();
  await expect(page.locator("#deleteDialog")).toBeVisible();
  await page.locator("#deleteDialog").getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.locator("#deleteDialog")).toBeHidden();

  await openMenu();
  await expect(page.getByRole("dialog", { name: "Weitere Artikelaktionen" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Weitere Artikelaktionen" })).toBeHidden();

  // Dismissing chose nothing, so nothing may have been chosen.
  await expect(page.locator("#deleteDialog")).toBeHidden();
});

test("the article menu names the kind of entry it is about", async ({ page }) => {
  // The delete confirmation next door is collection-aware, so the menu leading
  // to it has to agree: a page is not an article.
  const source = `---\ntitle: "Über mich"\npermalink: /about/\n---\nText.\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, [], [{ path: "blog/pages/about.md", type: "blob", sha: "s", size: source.length }]);
  await page.route(/\/api\/github\/git\/trees\/tree-sha(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ sha: "tree-sha", tree: [{ path: "blog/pages/about.md", type: "blob", sha: "s", size: source.length }] }) }));
  await page.route(/\/api\/github\/contents\/blog\/pages\/about\.md/, (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ sha: "s", content: Buffer.from(source).toString("base64") }) }));

  await page.goto("/admin/");
  await page.locator("#entryTypeSelect").selectOption("pages");
  await page.getByText("blog/pages/about.md", { exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");

  await page.getByRole("navigation", { name: "Artikel" })
    .getByRole("button", { name: "Weitere Artikelaktionen" }).click();
  const menu = page.getByRole("dialog", { name: "Weitere Artikelaktionen" });
  await expect(menu.getByRole("button", { name: "Seite löschen" })).toBeVisible();
  // Unpublishing is a post-only idea; it must not be offered for a page.
  await expect(menu.getByRole("button", { name: "Veröffentlichung zurückziehen" })).toBeHidden();
});

test("alt-text generation sits next to inserting an image, not among the document actions", async ({ page }) => {
  // Moved on request: it gets used right after inserting an image, so it
  // belongs where that happens — the writing bar, not the article bar's
  // document-level actions (unpublish, delete, alt-text used to sit there).
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();

  const writingBar = page.getByRole("navigation", { name: "Schreiben" });
  await expect(writingBar.getByRole("button", { name: "Alt-Texte erzeugen" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Alt-Texte erzeugen" })).toHaveCount(0);

  // Immediately after "Bild oder Video einfügen" in DOM order — adjacency is
  // the actual point, not just "somewhere in the writing bar".
  const order = await writingBar.getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label")));
  const imageIndex = order.indexOf("Bild oder Video einfügen");
  expect(imageIndex).toBeGreaterThanOrEqual(0);
  expect(order[imageIndex + 1]).toBe("Alt-Texte erzeugen");

  // And the click reaches the real handler, not just a relocated dead button.
  await page.getByPlaceholder("Titel").fill("Ohne fehlende Alt-Texte");
  await writingBar.getByRole("button", { name: "Alt-Texte erzeugen" }).click();
  await expect(page.locator("#statusBar")).toContainText("Alle Bilder haben bereits einen Alt-Text");
});

test("Enter in the title moves into the article text instead of starting a new line", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();

  const title = page.getByPlaceholder("Titel");
  await title.click();
  await page.keyboard.insertText("Ein Titel");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Erster Satz.");

  await expect(title).toHaveValue("Ein Titel");
  await expect(page.locator(".cm-content")).toContainText("Erster Satz.");
  const focused = await page.evaluate(() => document.activeElement?.className || "");
  expect(focused).toContain("cm-content");
});

test("metadata fields still save on Enter now that the editor is not a <form>", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Speichern per Enter");
  await page.getByRole("button", { name: "Artikeloptionen" }).click();
  await page.locator("#slugInput").fill("speichern-per-enter");
  await page.locator("#slugInput").press("Enter");
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.endsWith("/git/blobs") && /speichern-per-enter/.test(request.body.content || "")
  )).toBe(true);
});
