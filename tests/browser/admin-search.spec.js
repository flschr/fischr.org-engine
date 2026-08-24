const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

// Die Artikelliste fand einen Beitrag nur über Titel und Dateinamen. Diese Tests halten fest,
// dass sie jetzt auch den Text erreicht — und dass sie dafür nichts kostet, solange niemand
// sucht: Der Volltext ist ein eigener Abruf, der erst bei der ersten Suche losgeht.

const posts = [
  { path: "blog/posts/2026-08-01-lego.md", type: "blob", sha: "lego-sha", size: 400 },
  { path: "blog/posts/2026-08-02-kaffee.md", type: "blob", sha: "kaffee-sha", size: 400 }
];

const postsIndex = [
  { path: "./blog/posts/2026-08-01-lego.md", title: "18 Kilogramm Lego", url: "/lego/", date: "2026-08-01T10:00:00.000Z", draft: false, media: [] },
  { path: "./blog/posts/2026-08-02-kaffee.md", title: "Ein Kaffee zu viel", url: "/kaffee/", date: "2026-08-02T10:00:00.000Z", draft: false, media: [] }
];

const searchIndex = {
  "blog/posts/2026-08-01-lego.md": "Gebaut an einem langen Abend in München, mit zwei Tassen Tee daneben.",
  "blog/posts/2026-08-02-kaffee.md": "Ein Nachmittag in Hamburg, deutlich zu wach für die Uhrzeit."
};

async function openLibrary(page, { index = searchIndex, onSearchRequest } = {}) {
  await page.unroute("**/api/admin/auth/session");
  await page.route("**/admin/posts-index.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(postsIndex)
  }));
  await page.route("**/admin/posts-search.json", (route) => {
    onSearchRequest?.(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(index) });
  });
  await mockAuthenticatedGithub(page, [], posts, { mainTree: posts });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await expect(page.locator("#entryList")).toContainText("18 Kilogramm Lego");
}

test("findet einen Beitrag an einem Wort, das nur in seinem Text steht", async ({ page }) => {
  await openLibrary(page);

  await page.locator("#searchInput").fill("münchen");

  await expect(page.locator("#entryList .entry-card")).toHaveCount(1);
  await expect(page.locator("#entryList")).toContainText("18 Kilogramm Lego");
  // Der Treffer erklärt sich selbst: Der Auszug zeigt die Stelle im Originaltext.
  await expect(page.locator("#entryList .entry-excerpt mark")).toHaveText("München");
  await expect(page.locator("#entryList .entry-excerpt")).toContainText("Gebaut an einem langen Abend");
});

test("ohne Umlaut getippt, mit Umlaut gefunden — und ein Wort im Titel zählt mit", async ({ page }) => {
  await openLibrary(page);

  await page.locator("#searchInput").fill("munchen");
  await expect(page.locator("#entryList .entry-card")).toHaveCount(1);

  // Zwei Wörter, eines im Titel, eines im Text: Beide zusammen ergeben den Treffer.
  await page.locator("#searchInput").fill("lego tee");
  await expect(page.locator("#entryList .entry-card")).toHaveCount(1);
  await expect(page.locator("#entryList .entry-excerpt mark")).toHaveText("Tee");

  await page.locator("#searchInput").fill("lego hamburg");
  await expect(page.locator("#entryList .entry-card")).toHaveCount(0);
  await expect(page.locator("#entryList")).toContainText("Keine Treffer.");
});

test("der Volltext wird erst bei der ersten Suche geholt, und dann nicht wieder", async ({ page }) => {
  const requests = [];
  await openLibrary(page, { onSearchRequest: (url) => requests.push(url) });

  // Die Liste steht, ohne dass der Volltext überhaupt angefragt wurde.
  expect(requests).toEqual([]);

  await page.locator("#searchInput").fill("münchen");
  await expect(page.locator("#entryList .entry-excerpt")).toBeVisible();
  await page.locator("#searchInput").fill("hamburg");
  await expect(page.locator("#entryList .entry-excerpt")).toBeVisible();

  expect(requests).toHaveLength(1);

  // „Aktualisieren“ holt beide Indexe neu: Der Volltext ist ein Build-Ergebnis, und was
  // gerade veröffentlicht wurde, steht erst in der nächsten Fassung.
  await page.locator("#refreshButton").click();
  await page.locator("#searchInput").fill("münchen");
  await expect(page.locator("#entryList .entry-excerpt")).toBeVisible();
  expect(requests).toHaveLength(2);
});

test("ein gescheiterter Abruf sagt es, statt „nichts gefunden“ zu behaupten", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  await page.route("**/admin/posts-index.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(postsIndex)
  }));
  await page.route("**/admin/posts-search.json", (route) => route.fulfill({ status: 500, body: "kaputt" }));
  await mockAuthenticatedGithub(page, [], posts, { mainTree: posts });

  await page.goto("/admin/");
  await expect(page.locator("#entryList")).toContainText("18 Kilogramm Lego");
  await page.locator("#searchInput").fill("münchen");

  await expect(page.locator("#entryList")).toContainText("Volltext ließ sich nicht laden");
  // Die Titelsuche arbeitet weiter — der Ausfall betrifft nur den Text.
  await page.locator("#searchInput").fill("lego");
  await expect(page.locator("#entryList .entry-card")).toHaveCount(1);
});

test("eine vorgemerkte Änderung wird so gefunden, wie sie gerade dasteht", async ({ page }) => {
  // Der ausgelieferte Index kennt den neuen Beitrag nicht — er wurde nie gebaut.
  await openLibrary(page, { index: searchIndex });

  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Ein neuer Anfang");
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("Ein Satz über Regensburg, den noch niemand veröffentlicht hat.");
  await page.locator("#saveButton").click();
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");
  // Der modale Dialog schliesst sich von selbst. Solange er offen ist, ist der Rest des
  // Dokuments inert — ein Tippen ins Suchfeld käme dort nie an.
  await expect(page.locator("#saveDialog")).toBeHidden();

  await page.locator('[data-collection="posts"]').evaluate((button) => button.click());
  await page.locator("#searchInput").fill("regensburg");

  await expect(page.locator("#entryList .entry-card")).toHaveCount(1);
  await expect(page.locator("#entryList")).toContainText("Ein neuer Anfang");
  await expect(page.locator("#entryList .entry-excerpt mark")).toHaveText("Regensburg");
});
