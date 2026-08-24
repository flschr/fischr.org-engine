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
  // Footnotes moved behind the writing bar's "+" — one of the insertions that
  // is not needed in every article.
  await page.getByRole("toolbar", { name: "Formatierung" }).getByRole("button", { name: "Weitere Einfügungen" }).click();
  await page.getByRole("dialog", { name: "Weitere Einfügungen" }).getByRole("button", { name: "Fußnote" }).click();
  await page.getByRole("dialog").getByPlaceholder("Fußnotentext").fill(text);
  await page.getByRole("dialog").getByRole("button", { name: "Einfügen" }).click();
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

  // Bold and italic stayed on the bar; the rest moved behind its "+" so the bar
  // fits above the on-screen keyboard. Reached either way, the command has to
  // act on the same selection.
  const applyFormat = async (name, inSheet) => {
    if (!inSheet) return toolbar.getByRole("button", { name }).click();
    await toolbar.getByRole("button", { name: "Weitere Einfügungen" }).click();
    await page.getByRole("dialog", { name: "Weitere Einfügungen" }).getByRole("button", { name }).click();
  };

  for (const format of [
    { button: "Fett (⌘B)", selector: ".cm-strong", inSheet: false },
    { button: "Kursiv (⌘I)", selector: ".cm-em", inSheet: false },
    { button: "Code", selector: ".cm-code", inSheet: true },
    { button: "Durchgestrichen", selector: ".cm-strike", inSheet: true },
    { button: "Markieren", selector: ".cm-highlight", inSheet: true }
  ]) {
    await selectFootnoteWord();
    await applyFormat(format.button, format.inSheet);
    await expect(footnoteLine.locator(format.selector)).toContainText('"Formatierbar" & mehr');
    // No re-select in between, deliberately: the second click has to hit the
    // same range the first one left behind. That is the actual claim about the
    // sheet — opening a modal takes DOM focus, and the command still has to
    // find CodeMirror's own selection where it was.
    await applyFormat(format.button, format.inSheet);
    await expect(footnoteLine.locator(format.selector)).toHaveCount(0);
  }

  await selectFootnoteWord();
  await page.keyboard.press("Backspace");
  await expect(footnoteLine).not.toContainText("Formatierbar");
  await expect(page.locator(".cm-footnote-empty")).toBeVisible();
  // CodeMirror's default history groups transactions that land within 500ms
  // of each other into one undo step, regardless of what kind of edit each
  // one is — a Backspace immediately followed by typed text is exactly such a
  // pair. Locally the round-trip through Playwright's own dispatch usually
  // takes longer than that on its own; on a CI runner it does not, so the two
  // silently merged into a single undo step there. The two clicks below then
  // stopped meaning "undo the insert, then undo the backspace" — the first
  // undid both at once, and the second reached one edit further back than
  // intended, resurrecting the already-removed <mark>. Reproduced on GitHub's
  // runner (twice, deterministically) with the exact corrupted state proven
  // via the editor's own document string, not inferred from a timeout.
  //
  // The wait forces the two edits into separate groups on every engine, so
  // "press Undo, then Undo again" keeps meaning what it says regardless of
  // how fast the environment happens to be.
  await page.waitForTimeout(600);
  await page.locator(".cm-footnote-empty").click();
  await page.keyboard.insertText("Neu geschrieben");
  await expect(footnoteLine).toContainText("Neu geschrieben");
  await page.getByRole("navigation", { name: "Schreiben" }).getByRole("button", { name: "Rückgängig" }).click();
  // Undo #1 must land exactly on "insertText undone", not one step further —
  // this is what would have caught the grouping bug immediately instead of
  // two assertions and one button click later.
  await expect(page.locator(".cm-footnote-empty")).toBeVisible();
  await page.getByRole("navigation", { name: "Schreiben" }).getByRole("button", { name: "Rückgängig" }).click();
  await expect(footnoteLine).toContainText('"Formatierbar" & mehr');

  await selectFootnoteWord();
  await toolbar.getByRole("button", { name: "Kursiv (⌘I)" }).click();
  await expect(footnoteLine.locator(".cm-em")).toContainText('"Formatierbar" & mehr');
  await expect(footnoteLine).toContainText('<em>"Formatierbar" & mehr</em>');
  await page.locator(".cm-line").first().click();
  await expect(footnoteLine).not.toContainText("<em>");
  await expect(footnoteLine.locator(".cm-em")).toContainText("Formatierbar");

  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Vorschau" }).click();
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
  const linkDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Link einfügen" }) });
  await linkDialog.getByPlaceholder("https://example.com").fill("https://example.com/fussnote");
  await linkDialog.getByRole("button", { name: "Einfügen" }).click();
  await expect(page.locator(".cm-footnote-line .cm-link")).toContainText("Verlinkte Quelle");

  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Vorschau" }).click();
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
  await page.getByRole("toolbar", { name: "Formatierung" }).getByRole("button", { name: "Fett (⌘B)" }).click();
  await expect(footnoteLine.locator(".cm-strong")).toContainText("Erste Zeile");
  await expect(footnoteLine).toContainText("<br>");

  await page.locator(".cm-line").first().click();
  await expect(footnoteLine.locator("br")).toHaveCount(1);
  await expect(footnoteLine).not.toContainText("<br>");
  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Vorschau" }).click();
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
  await toolbar.getByRole("button", { name: "Fett (⌘B)" }).click();
  await page.locator(".cm-line").first().click();
  await page.locator(".cm-content").evaluate((element) => {
    const view = element.cmTile.view;
    const source = view.state.doc.toString();
    const start = source.indexOf("<strong>ABCDE</strong>") + "<strong>".length + 1;
    view.dispatch({ selection: { anchor: start, head: start + 3 } });
    view.focus();
  });
  await toolbar.getByRole("button", { name: "Fett (⌘B)" }).click();
  await expect(footnoteLine.locator(".cm-strong")).toHaveCount(2);
  await expect(footnoteLine.locator(".cm-strong").nth(0)).toHaveText("A");
  await expect(footnoteLine.locator(".cm-strong").nth(1)).toHaveText("E");
  await expect(footnoteLine).toContainText("ABCDE");
});
