const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

test("cleanup rechecks media processing after its confirmation dialog", async ({ page }) => {
  const requests = [];
  const orphan = { path: "blog/assets/images/uploads/orphan.webp", type: "blob", sha: "orphan-sha", size: 1200 };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [orphan]);

  let releaseWorkflow;
  const workflowReleased = new Promise((resolve) => { releaseWorkflow = resolve; });
  await page.route("**/api/github/**", async (route) => {
    if (!route.request().url().includes("admin-normalize-image.yml/runs?")) return route.fallback();
    await workflowReleased;
    return route.fallback();
  });

  await page.goto("/admin/");
  await page.locator("#syncButton").evaluate((button) => button.click());
  await page.locator("#cleanupOrphansButton").click();
  await expect(page.locator("#discardDialog")).toBeVisible();

  await page.locator("#mediaUploadInput").setInputFiles({
    name: "parallel.png",
    mimeType: "image/png",
    buffer: Buffer.from("image")
  });
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.includes("admin-normalize-image.yml/dispatches")
  )).toBe(true);
  await page.locator("#discardDialogAction").click();

  await expect(page.locator("#statusBar")).toContainText("wartet, bis GitHub alle Medien verarbeitet hat");
  expect(requests.some((request) =>
    request.method === "POST" &&
    request.url.endsWith("/git/trees") &&
    request.body.tree?.some((entry) => entry.path === orphan.path && entry.sha === null)
  )).toBe(false);

  releaseWorkflow();
});

test("discarding one queue entry aborts when that entry changed during confirmation", async ({ page }) => {
  const requests = [];
  const original = { path: "blog/assets/images/uploads/orphan.webp", type: "blob", sha: "old-sha", size: 1200 };
  let updateRemote;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [original], {
    onReady({ replaceTree, replaceDraftsHead }) {
      updateRemote = () => {
        replaceTree([{ ...original, sha: "new-sha" }]);
        replaceDraftsHead("concurrent-head-sha");
      };
    }
  });

  await page.goto("/admin/");
  await page.locator("#syncButton").evaluate((button) => button.click());
  await page.locator(".queue-discard").click();
  await expect(page.locator("#discardDialog")).toBeVisible();
  updateRemote();
  await page.locator("#discardDialogAction").click();

  await expect(page.locator("#statusBar")).toContainText("zwischenzeitlich aktualisiert");
  expect(requests.some((request) =>
    request.method === "POST" &&
    request.url.endsWith("/git/trees") &&
    request.body.tree?.some((entry) => entry.path === original.path && entry.sha === null)
  )).toBe(false);
});

test("discard all requires new confirmation when the queue changed", async ({ page }) => {
  const requests = [];
  const original = { path: "blog/assets/images/uploads/original.webp", type: "blob", sha: "original-sha", size: 1200 };
  const added = { path: "blog/assets/images/uploads/added.webp", type: "blob", sha: "added-sha", size: 1200 };
  let updateRemote;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [original], {
    onReady({ replaceTree, replaceDraftsHead }) {
      updateRemote = () => {
        replaceTree([{ ...original, sha: "updated-original-sha" }, added]);
        replaceDraftsHead("concurrent-head-sha");
      };
    }
  });

  await page.goto("/admin/");
  await page.locator("#syncButton").evaluate((button) => button.click());
  await page.locator("#discardAllButton").click();
  await expect(page.locator("#discardDialog")).toBeVisible();
  updateRemote();
  await page.locator("#discardDialogAction").click();

  await expect(page.locator("#statusBar")).toContainText("Warteschlange wurde zwischenzeitlich aktualisiert");
  expect(requests.some((request) => request.method === "PATCH" && request.url.includes("/git/refs/heads/drafts"))).toBe(false);
});

test("unused upload cleanup requires new confirmation when its target set changed", async ({ page }) => {
  const requests = [];
  const original = { path: "blog/assets/images/uploads/original.webp", type: "blob", sha: "original-sha", size: 1200 };
  const added = { path: "blog/assets/images/uploads/added.webp", type: "blob", sha: "added-sha", size: 1200 };
  let updateRemote;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [original], {
    onReady({ replaceTree, replaceDraftsHead }) {
      updateRemote = () => {
        replaceTree([{ ...original, sha: "updated-original-sha" }, added]);
        replaceDraftsHead("concurrent-head-sha");
      };
    }
  });

  await page.goto("/admin/");
  await page.locator("#syncButton").evaluate((button) => button.click());
  await page.locator("#cleanupOrphansButton").click();
  await expect(page.locator("#discardDialog")).toBeVisible();
  updateRemote();
  await page.locator("#discardDialogAction").click();

  await expect(page.locator("#statusBar")).toContainText("unbenutzten Uploads wurden zwischenzeitlich aktualisiert");
  expect(requests.some((request) => request.method === "POST" && request.url.endsWith("/git/trees"))).toBe(false);
});

test("a refresh failure after discard confirmation is reported without writing", async ({ page }) => {
  const requests = [];
  const errors = [];
  const original = { path: "blog/assets/images/uploads/original.webp", type: "blob", sha: "original-sha", size: 1200 };
  let failRefresh;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [original], {
    onReady({ failDraftRefresh }) { failRefresh = failDraftRefresh; }
  });

  await page.goto("/admin/");
  await page.locator("#syncButton").evaluate((button) => button.click());
  await page.locator(".queue-discard").click();
  await expect(page.locator("#discardDialog")).toBeVisible();
  failRefresh();
  await page.locator("#discardDialogAction").click();

  await expect(page.locator("#statusBar")).toContainText("Verwerfen fehlgeschlagen");
  expect(errors).toEqual([]);
  expect(requests.some((request) => request.method === "POST" && request.url.endsWith("/git/trees"))).toBe(false);
});

