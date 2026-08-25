const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

test("media upload button accepts a QuickTime video", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests);
  await page.goto("/admin/");

  await page.locator('[data-collection="media"]').evaluate((button) => button.click());
  await page.locator("#mediaUploadInput").setInputFiles({
    name: "rasenmaeher.MOV",
    mimeType: "",
    buffer: Buffer.from("quicktime")
  });

  await expect(page.locator("#statusBar")).toContainText(/1 Upload (?:wird im Hintergrund verarbeitet|fertig)/);
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" &&
    request.url.includes("admin-prepare-video.yml/dispatches") &&
    request.body.inputs.source_path.endsWith(".mov")
  )).toBe(true);
});

test("video processing locks publishing and every destructive queue action", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests);

  let releaseWorkflow;
  const workflowReleased = new Promise((resolve) => { releaseWorkflow = resolve; });
  await page.route("**/api/github/**", async (route) => {
    if (!route.request().url().includes("admin-prepare-video.yml/runs?")) return route.fallback();
    await workflowReleased;
    return route.fallback();
  });

  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Video wird verarbeitet");
  await page.locator("#imageUploadInput").setInputFiles({
    name: "processing.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.from("quicktime")
  });

  await expect(page.locator(".cm-content")).toContainText("!video(/assets/videos/uploads/");
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.includes("admin-prepare-video.yml/dispatches")
  )).toBe(true);
  await expect(page.locator("#syncButton")).toBeEnabled();

  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");

  await page.locator("#syncButton").evaluate((button) => button.click());
  await expect(page.locator("#queueView")).toBeVisible();
  await expect(page.locator("#pushButton")).toBeDisabled();
  await expect(page.locator("#discardAllButton")).toBeDisabled();
  await expect(page.locator("#cleanupOrphansButton")).toBeDisabled();
  // Just the video upload's own card: the new post itself is a never-published
  // draft (only its title was filled in, "Speichern" was never asked to publish),
  // and a draft that was never public changes nothing on the blog — the queue
  // no longer shows it (04c-queue-actions.js, OHNE_WIRKUNG).
  const discardButtons = page.locator(".queue-discard");
  await expect(discardButtons).toHaveCount(1);
  expect(await discardButtons.evaluateAll((buttons) => buttons.every((button) => button.disabled))).toBe(true);

  releaseWorkflow();
});

test("a failed startup image recovery leaves its queue repair actions available", async ({ page }) => {
  const requests = [];
  const image = { path: "blog/assets/images/uploads/broken.png", type: "blob", sha: "image-sha", size: 1200 };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [image], {
    onWorkflowPoll({ inputs }) {
      return {
        workflow_runs: [{
          display_title: `Normalize ${inputs.request_id}`,
          status: "completed",
          conclusion: "failure"
        }]
      };
    }
  });

  await page.goto("/admin/");
  await expect(page.locator("#statusBar")).toContainText("Bildverarbeitung fehlgeschlagen");
  await page.locator("#syncButton").evaluate((button) => button.click());
  await expect(page.locator("#queueView")).toBeVisible();
  await expect(page.locator("#pushButton")).toBeEnabled();
  await expect(page.locator("#discardAllButton")).toBeEnabled();
  await expect(page.locator("#cleanupOrphansButton")).toBeEnabled();
  await expect(page.locator(".queue-discard")).toBeEnabled();

  const recoveryDispatches = () => requests.filter((request) =>
    request.method === "POST" && request.url.includes("admin-normalize-image.yml/dispatches")
  ).length;
  expect(recoveryDispatches()).toBe(1);
  await page.locator("#pushButton").click();
  await expect.poll(recoveryDispatches).toBe(2);
  // Die Adresse muss die des Starts sein, nicht die des alten Dispatchs: Seit der Admin gar
  // nicht mehr dispatcht, wäre die alte Zusicherung immer erfüllt — auch dann, wenn hier
  // sehr wohl eine Veröffentlichung begonnen hätte.
  expect(requests.some((request) =>
    request.method === "POST" && request.url.endsWith("/api/admin/publish")
  )).toBe(false);
});

test("media deletion stays locked while startup recovery is active", async ({ page }) => {
  const video = { path: "blog/assets/videos/uploads/incomplete.mp4", type: "blob", sha: "video-sha", size: 2400 };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, [], [video]);

  let releaseWorkflow;
  const workflowReleased = new Promise((resolve) => { releaseWorkflow = resolve; });
  await page.route("**/api/github/**", async (route) => {
    if (!route.request().url().includes("admin-prepare-video.yml/runs?")) return route.fallback();
    await workflowReleased;
    return route.fallback();
  });

  await page.goto("/admin/");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());
  const deleteButton = page.locator(`.media-item[data-media-path="${video.path}"]`)
    .getByRole("button", { name: "Löschen" });
  await expect(deleteButton).toBeDisabled();
  await deleteButton.evaluate((button) => {
    button.disabled = false;
    button.click();
  });
  await expect(page.locator("#statusBar")).toContainText("wartet, bis GitHub alle Medien verarbeitet hat");
  await expect(deleteButton).toBeDisabled();

  releaseWorkflow();
  await expect(deleteButton).toBeEnabled();
});
