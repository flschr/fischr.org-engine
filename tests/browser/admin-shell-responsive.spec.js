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
  await expect(page.locator("#libraryTitle")).toHaveText("Pages");
  // The marked tab is what tells the reader where they are now that no heading does.
  await expect(page.locator('[data-collection="pages"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-collection="posts"]')).not.toHaveAttribute("aria-current", "page");
});

test("tabs are siblings in history, the editor is depth", async ({ page }) => {
  await page.goto("/admin/");
  const depth = () => page.evaluate(() => history.length);
  const start = await depth();

  // Switching tabs replaces the entry — otherwise a back swipe would walk the
  // tab chain backwards instead of doing nothing.
  await page.getByRole("button", { name: "Seiten", exact: true }).click();
  await expect(page.locator("#libraryTitle")).toHaveText("Pages");
  await page.getByRole("button", { name: "Mediathek", exact: true }).click();
  await expect(page.locator("#mediaView")).toBeVisible();
  await page.getByRole("button", { name: "Seiten", exact: true }).click();
  await expect(page.locator("#libraryTitle")).toHaveText("Pages");
  expect(await depth()).toBe(start);

  // Opening an entry is the one move that goes deeper, so back leads out of it —
  // and back to the list it was opened from.
  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator("#editorForm")).toBeVisible();
  expect(await depth()).toBe(start + 1);

  await page.goBack();
  await expect(page.locator("#editorForm")).toBeHidden();
  await expect(page.locator("#libraryTitle")).toHaveText("Pages");
});

test("a reload stays on the view it was on", async ({ page }) => {
  await page.goto("/admin/");

  await page.getByRole("button", { name: "Mediathek", exact: true }).click();
  await expect(page.locator("#mediaView")).toBeVisible();
  await page.reload();
  // history.state survives F5 and is now the only record of the current view,
  // so init has to read it instead of always landing on the article list.
  await expect(page.locator("#mediaView")).toBeVisible();
  await expect(page.locator('[data-collection="media"]')).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Seiten", exact: true }).click();
  await expect(page.locator("#libraryTitle")).toHaveText("Pages");
  await page.reload();
  await expect(page.locator("#libraryTitle")).toHaveText("Pages");
});

test("a reloaded new draft keeps the collection it was started in", async ({ page }) => {
  await page.goto("/admin/");

  await page.getByRole("button", { name: "Seiten", exact: true }).click();
  await expect(page.locator("#libraryTitle")).toHaveText("Pages");
  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator("#editorForm")).toBeVisible();

  await page.reload();
  await expect(page.locator("#editorForm")).toBeVisible();
  // A draft with no path yet has nothing to derive its collection from, so the
  // restored entry has to carry it — or a new page comes back as a new post and
  // would save into blog/posts/.
  await expect(page.locator("#libraryTitle")).toHaveText("Pages");
  // The meta panel is collapsed, so ask which fields the editor configured for
  // this collection rather than which ones are on screen: pages get permalink,
  // posts get slug.
  const fields = await page.evaluate(() => ({
    slug: getComputedStyle(document.querySelector('[data-field="slug"]')).display,
    permalink: getComputedStyle(document.querySelector('[data-field="permalink"]')).display
  }));
  expect(fields.slug).toBe("none");
  expect(fields.permalink).not.toBe("none");
});

test("no view repeats what the navigation already says", async ({ page }) => {
  await page.goto("/admin/");

  // Costs no space, still announced: a screen reader has no highlighted tab to
  // read. (Playwright counts a 1px clip-path element as "visible", so measure
  // the box rather than asking toBeHidden.)
  const title = page.locator("#libraryTitle");
  expect((await title.boundingBox()).height).toBeLessThanOrEqual(1);
  await expect(title).toHaveText("Articles");
  await expect(page.getByRole("heading", { name: "Articles", exact: true })).toBeAttached();

  // The tools start at the workspace's inner edge, with no heading above them.
  // Measured from inside the padding, or the workspace's own inset counts too.
  const contentStart = await page.locator("#content").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.y + parseFloat(getComputedStyle(node).paddingTop);
  });
  const toolsTop = (await page.locator("#libraryView .library-tools").boundingBox()).y;
  expect(toolsTop - contentStart).toBeLessThan(4);

  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator("#editorForm")).toBeVisible();
  const editorTitleHeight = await page.locator("#editorViewTitle")
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(editorTitleHeight).toBeLessThanOrEqual(1);
  // The article's own title field is the visible heading in the editor.
  await expect(page.getByPlaceholder("Titel")).toBeVisible();
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

test("phones pull to refresh, desktop keeps the button", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.startsWith("mobile");
  await page.goto("/admin/");

  // Switching tabs reuses the cached tree on purpose, so a way to force a reload
  // has to exist on both — as a gesture where there is a finger, a button where
  // there is a cursor.
  await expect(page.locator("#refreshButton")).toBeVisible({ visible: !mobile });
  await expect(page.locator("#pullRefresh")).toBeAttached();
});

test("the pull indicator tracks the finger and glides back", async ({ page }, testInfo) => {
  // Chromium only: WebKit has no Touch constructor, so the events cannot be
  // synthesised there. What this asserts is a cascade rule, which does not vary
  // by engine — the real gesture on real hardware is not something a synthetic
  // touch would prove anyway.
  test.skip(testInfo.project.name !== "mobile", "Needs synthesised touch events");
  await page.goto("/admin/");

  const pull = (type, y) => page.evaluate(([kind, clientY]) => {
    const touch = new Touch({ identifier: 1, target: document.body, clientX: 180, clientY, pageX: 180, pageY: clientY });
    document.dispatchEvent(new TouchEvent(kind, {
      bubbles: true,
      cancelable: true,
      touches: kind === "touchend" ? [] : [touch],
      changedTouches: [touch]
    }));
    const node = document.getElementById("pullRefresh");
    return { classes: node.className, transition: getComputedStyle(node).transitionDuration };
  }, [type, y]);

  await pull("touchstart", 100);
  const dragging = await pull("touchmove", 260);
  expect(dragging.classes).toContain("is-ready");
  // No transform transition while a finger is down, or the indicator lags the touch.
  expect(dragging.transition).not.toContain("0.3s");

  const released = await pull("touchend", 260);
  // ...but releasing has to glide. These two rules weigh the same in the
  // cascade, so this is what catches one silently replacing the other.
  expect(released.transition).toContain("0.3s");
  expect(released.classes).toContain("is-settling");
});

test("mobile editor hides the tab bar and leaves the way out to the platform", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only interaction");
  await page.goto("/admin/");

  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator("#editorForm")).toBeVisible();
  // Full-screen editing: the bar would sit under the keyboard anyway.
  await expect(page.locator("#sidebar")).toBeHidden();

  // Getting out is the platform's job — browser back, or the edge-swipe in a
  // home-screen app. Both arrive here as a popstate, which is the path this
  // asserts; the bar carries no back button of its own any more.
  await expect(page.getByRole("button", { name: "Zurück zur Liste" })).toHaveCount(0);
  await page.goBack();

  await expect(page.locator("#editorForm")).toBeHidden();
  await expect(page.locator("#libraryTitle")).toHaveText("Articles");
  await expect(page.locator("#sidebar")).toBeVisible();
});

test("desktop keeps the sidebar and needs no back button", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "Desktop-only interaction");
  await page.goto("/admin/");

  await expect(page.getByRole("button", { name: "Artikel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Seiten", exact: true }).click();
  await expect(page.locator("#libraryTitle")).toHaveText("Pages");

  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator("#editorForm")).toBeVisible();
  // The sidebar never leaves, so the editor's back button stays a phone affordance.
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zurück zur Liste" })).toHaveCount(0);

  await page.goBack();
  await expect(page.locator("#libraryTitle")).toHaveText("Pages");
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

test("the writing bar sits at the bottom of a phone and the article bar at the top", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only layout");
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator("#editorForm")).toBeVisible();

  const viewport = page.viewportSize();
  const box = async (selector) => page.locator(selector).boundingBox();
  const writing = await box("#writingBar");
  const article = await box(".editor-bar");

  // The whole point of the split. While typing, the thumbs are at the bottom
  // of the screen and so is the keyboard; formatting used to live at the very
  // top, which is the furthest point from both.
  expect(writing.y).toBeGreaterThan(viewport.height / 2);
  expect(Math.round(writing.y + writing.height)).toBeLessThanOrEqual(viewport.height + 1);
  expect(article.y).toBeLessThan(viewport.height / 4);

  // One row each, not sideways-scrolling strips: everything in both is
  // reachable without a swipe. The article bar carries six buttons now that
  // alt-text sits there, which is the count worth watching.
  const bar = page.locator("#writingBar");
  const overflows = await bar.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(overflows).toBe(false);
  const articleOverflows = await page.locator(".editor-bar").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(articleOverflows).toBe(false);
  for (const name of ["Fett (⌘B)", "Kursiv (⌘I)", "Link (⌘K)", "Bild oder Video einfügen", "Weitere Einfügungen"]) {
    await expect(bar.getByRole("button", { name })).toBeVisible();
  }

  // With no keyboard open the bar rests on the bottom edge, so the offset that
  // lifts it is zero rather than absent — an unset variable would silently
  // collapse the calc() that positions the article's bottom padding.
  const inset = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--keyboard-inset").trim());
  expect(inset).toBe("0px");
});

test("nothing pinned to the bottom edge lands on top of the writing bar", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only layout");
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator("#editorForm")).toBeVisible();

  // --bottom-chrome is the one value everything on the bottom edge measures
  // from. The editor used to declare it as the home indicator alone, which was
  // true until the writing bar moved down there — after that the status toast
  // sat squarely on top of the link, image and "+" buttons.
  const writing = await page.locator("#writingBar").boundingBox();

  await page.evaluate(() => window.RWAdminTestStatus?.() ?? null);
  await page.locator("#statusBar").evaluate((el) => {
    el.textContent = "Testmeldung";
    el.classList.add("is-visible");
  });
  const toast = await page.locator("#statusBar").boundingBox();

  // The toast must end above where the bar begins.
  expect(Math.round(toast.y + toast.height)).toBeLessThanOrEqual(Math.round(writing.y));
});
