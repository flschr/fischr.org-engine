const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

async function openNewPost(page, text) {
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.locator(".cm-content").click();
  await page.keyboard.insertText(text);
}

async function insertFootnote(page, text) {
  await page.getByRole("toolbar", { name: "Formatierung" }).getByRole("button", { name: "Footnote" }).click();
  await page.getByRole("dialog").getByPlaceholder("Footnote text").fill(text);
  await page.getByRole("dialog").getByRole("button", { name: "Insert" }).click();
}

test("footnotes use normal editor selection, formatting, deletion and undo", async ({ page }) => {
  await openNewPost(page, "Nachrichten aus meinem Leben.");
  await page.keyboard.press("Meta+a");
  await insertFootnote(page, '"Formatierbar" & mehr');
  await expect(page.locator(".cm-footnote-ref")).toHaveText("1");
  const footnoteLine = page.locator(".cm-footnote-line");
  const footnoteText = page.locator(".cm-footnote-text");
  await expect(footnoteLine).toContainText('1. "Formatierbar" & mehr');
  await expect(footnoteLine).not.toContainText("&quot;");
  await expect(footnoteLine).not.toContainText("&amp;");
  await expect(page.locator(".cm-content")).not.toContainText('<section class="footnotes">');
  const toolbar = page.getByRole("toolbar", { name: "Formatierung" });
  const selectFootnoteWord = async () => {
    await footnoteText.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
  };

  for (const format of [
    { button: "Bold (⌘B)", selector: ".cm-strong" },
    { button: "Italic (⌘I)", selector: ".cm-em" },
    { button: "Inline code", selector: ".cm-code" },
    { button: "Strikethrough", selector: ".cm-strike" },
    { button: "Highlight", selector: ".cm-highlight" }
  ]) {
    await selectFootnoteWord();
    await toolbar.getByRole("button", { name: format.button }).click();
    await expect(footnoteLine.locator(format.selector)).toContainText('"Formatierbar" & mehr');
    await toolbar.getByRole("button", { name: format.button }).click();
    await expect(footnoteLine.locator(format.selector)).toHaveCount(0);
  }

  await selectFootnoteWord();
  await page.keyboard.press("Backspace");
  await expect(footnoteLine).not.toContainText("Formatierbar");
  await expect(page.locator(".cm-footnote-empty")).toBeVisible();
  await page.locator(".cm-footnote-empty").click();
  await page.keyboard.insertText("Neu geschrieben");
  await expect(footnoteLine).toContainText("Neu geschrieben");
  await page.getByRole("navigation", { name: "Editor" }).getByRole("button", { name: "Rückgängig" }).click();
  await page.getByRole("navigation", { name: "Editor" }).getByRole("button", { name: "Rückgängig" }).click();
  await expect(footnoteLine).toContainText('"Formatierbar" & mehr');

  await selectFootnoteWord();
  await toolbar.getByRole("button", { name: "Italic (⌘I)" }).click();
  await expect(footnoteLine.locator(".cm-em")).toContainText('"Formatierbar" & mehr');
  await expect(footnoteLine).toContainText('<em>"Formatierbar" & mehr</em>');
  await page.locator(".cm-line").first().click();
  await expect(footnoteLine).not.toContainText("<em>");
  await expect(footnoteLine.locator(".cm-em")).toContainText("Formatierbar");

  await page.getByRole("navigation", { name: "Editor" }).getByRole("button", { name: "Vorschau" }).click();
  await expect(page.locator("#previewPanel .footnote-ref")).toHaveText("1");
  await expect(page.locator("#previewPanel .footnotes")).toContainText('"Formatierbar" & mehr');
  await expect(page.locator("#previewPanel .footnotes em")).toBeVisible();
  await expect(page.locator("#previewPanel")).not.toContainText("&quot;");
});

test("footnote insertion moves preceding whitespace behind the reference", async ({ page }) => {
  await openNewPost(page, "Bezugswort nächstes");
  await page.locator(".cm-content").evaluate(async (element) => {
    const view = element.cmTile.view;
    view.dispatch({ selection: { anchor: "Bezugswort ".length } });
    view.focus();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await insertFootnote(page, "Anmerkung");

  const source = await page.locator(".cm-content").evaluate((element) => element.cmTile.view.state.doc.toString());
  expect(source).toContain('Bezugswort<sup class="footnote-ref" id="fnref-1"><a href="#fn-1">1</a></sup> nächstes');
  expect(source).not.toMatch(/\s<sup class=["']footnote-ref["']/);
});

test("footnote selections can be linked from the editor toolbar", async ({ page }) => {
  await openNewPost(page, "Text mit Quelle");
  await page.keyboard.press("Meta+a");
  await insertFootnote(page, "Verlinkte Quelle");

  const footnoteText = page.locator(".cm-footnote-text");
  await footnoteText.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.getByRole("toolbar", { name: "Formatierung" }).getByRole("button", { name: "Link (⌘K)" }).click();
  const linkDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Insert link" }) });
  await linkDialog.getByPlaceholder("https://example.com").fill("https://example.com/fussnote");
  await linkDialog.getByRole("button", { name: "Insert" }).click();
  await expect(page.locator(".cm-footnote-line .cm-link")).toContainText("Verlinkte Quelle");

  await page.getByRole("navigation", { name: "Editor" }).getByRole("button", { name: "Vorschau" }).click();
  await expect(page.locator("#previewPanel .footnotes a[href='https://example.com/fussnote']")).toBeVisible();
});

test("multiline footnotes render line breaks and reveal their source only while editing", async ({ page }) => {
  await openNewPost(page, "Artikeltext");
  await page.keyboard.press("Meta+a");
  await insertFootnote(page, "Erste Zeile\nZweite Zeile");

  const footnoteLine = page.locator(".cm-footnote-line");
  const footnoteText = page.locator(".cm-footnote-text");
  await expect(footnoteLine.locator("br")).toHaveCount(1);
  await expect(footnoteLine).not.toContainText("<br>");
  await footnoteText.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.getByRole("toolbar", { name: "Formatierung" }).getByRole("button", { name: "Bold (⌘B)" }).click();
  await expect(footnoteLine.locator(".cm-strong")).toContainText("Erste Zeile");
  await expect(footnoteLine).toContainText("<br>");

  await page.locator(".cm-line").first().click();
  await expect(footnoteLine.locator("br")).toHaveCount(1);
  await expect(footnoteLine).not.toContainText("<br>");
  await page.getByRole("navigation", { name: "Editor" }).getByRole("button", { name: "Vorschau" }).click();
  await expect(page.locator("#previewPanel .footnotes br")).toHaveCount(1);
});

test("footnote formatting can be removed from only part of a formatted range", async ({ page }) => {
  await openNewPost(page, "Artikeltext");
  await page.keyboard.press("Meta+a");
  const toolbar = page.getByRole("toolbar", { name: "Formatierung" });
  await insertFootnote(page, "ABCDE");

  const footnoteText = page.locator(".cm-footnote-text");
  const footnoteLine = page.locator(".cm-footnote-line");
  await footnoteText.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await toolbar.getByRole("button", { name: "Bold (⌘B)" }).click();
  await page.locator(".cm-line").first().click();
  await page.locator(".cm-content").evaluate((element) => {
    const view = element.cmTile.view;
    const source = view.state.doc.toString();
    const start = source.indexOf("<strong>ABCDE</strong>") + "<strong>".length + 1;
    view.dispatch({ selection: { anchor: start, head: start + 3 } });
    view.focus();
  });
  await toolbar.getByRole("button", { name: "Bold (⌘B)" }).click();
  await expect(footnoteLine.locator(".cm-strong")).toHaveCount(2);
  await expect(footnoteLine.locator(".cm-strong").nth(0)).toHaveText("A");
  await expect(footnoteLine.locator(".cm-strong").nth(1)).toHaveText("E");
  await expect(footnoteLine).toContainText("ABCDE");
});
