const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

// Die Warteschlange zeigt, was sich am öffentlichen Blog ändert — und benennt, was.
//
// Vorher zeigte sie jede Abweichung zwischen `drafts` und `main` als „Änderung". Ein nie
// veröffentlichter Entwurf stand darin, obwohl er öffentlich nichts bewirkt: Er trägt
// `draft: true` und wird weder gerendert (.eleventy.js) noch syndiziert (publish-utils.js).
// Und „Neu" bzw. „Geändert" sagte nicht, ob gleich etwas erscheint, aktualisiert wird oder
// von der Seite verschwindet.

function eintrag(pfad, sha) {
  return { path: pfad, type: "blob", sha, size: 60 };
}

function inhalt(titel, entwurf) {
  return Buffer.from(`---\ntitle: ${titel}\ndate: 2026-01-01\ndraft: ${entwurf}\n---\n\nText.\n`).toString("base64");
}

async function queueMit(page, { drafts, main, blobs, index }) {
  await page.route("**/admin/posts-index.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(index)
  }));
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, [], drafts, { mainTree: main, blobs });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator("#syncButton").evaluate((button) => button.click());
  await expect(page.locator("#queueView")).toBeVisible();
}

test("ein nie veröffentlichter Entwurf steht nicht in der Warteschlange", async ({ page }) => {
  const pfad = "blog/posts/2026-01-01-entwurf.md";
  await queueMit(page, {
    drafts: [eintrag(pfad, "sha-neu")],
    main: [],
    blobs: { "sha-neu": { encoding: "base64", content: inhalt("Entwurf", "true") } },
    index: []
  });

  await expect(page.locator(".queue-card")).toHaveCount(0);
  await expect(page.locator("#syncButton")).toHaveAttribute("aria-label", "0 Änderungen veröffentlichen");
});

test("aus einem Entwurf wird beim Freigeben ein Veröffentlichen", async ({ page }) => {
  const pfad = "blog/posts/2026-01-01-entwurf.md";
  await queueMit(page, {
    drafts: [eintrag(pfad, "sha-frei")],
    main: [eintrag(pfad, "sha-alt")],
    blobs: {
      "sha-frei": { encoding: "base64", content: inhalt("Entwurf", "false") },
      "sha-alt": { encoding: "base64", content: inhalt("Entwurf", "true") }
    },
    index: [{ path: pfad, title: "Entwurf", url: "", date: "2026-01-01", draft: true, media: [] }]
  });

  await expect(page.locator(".queue-card")).toHaveCount(1);
  await expect(page.locator(".queue-card .entry-pill").first()).toHaveText("Veröffentlichen");
});

test("ein bestehender Beitrag heisst aktualisieren, nicht geändert", async ({ page }) => {
  const pfad = "blog/posts/2026-01-01-live.md";
  await queueMit(page, {
    drafts: [eintrag(pfad, "sha-neu")],
    main: [eintrag(pfad, "sha-alt")],
    blobs: {
      "sha-neu": { encoding: "base64", content: inhalt("Live", "false") },
      "sha-alt": { encoding: "base64", content: inhalt("Live", "false") }
    },
    index: [{ path: pfad, title: "Live", url: "/live/", date: "2026-01-01", draft: false, media: [] }]
  });

  await expect(page.locator(".queue-card .entry-pill").first()).toHaveText("Aktualisieren");
});

// Zurückziehen und Löschen sind zwei verschiedene Dinge, und beide verkleinern die Seite —
// vorher hiess das eine „Geändert" und war von einer Aktualisierung nicht zu unterscheiden.
test("Zurückziehen wird als solches benannt und als Verkleinerung geführt", async ({ page }) => {
  const pfad = "blog/posts/2026-01-01-live.md";
  await queueMit(page, {
    drafts: [eintrag(pfad, "sha-entwurf")],
    main: [eintrag(pfad, "sha-alt")],
    blobs: {
      "sha-entwurf": { encoding: "base64", content: inhalt("Live", "true") },
      "sha-alt": { encoding: "base64", content: inhalt("Live", "false") }
    },
    index: [{ path: pfad, title: "Live", url: "/live/", date: "2026-01-01", draft: false, media: [] }]
  });

  await expect(page.locator(".queue-card .entry-pill").first()).toHaveText("Zurückziehen");
  await expect(page.locator(".queue-card").first()).toHaveClass(/is-delete/);
});
