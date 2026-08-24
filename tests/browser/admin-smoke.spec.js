const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

// Nothing may reach the publish endpoint. Asserted through a helper so the
// negative claim cannot quietly become vacuous by drifting off the real URL.
async function assertNoPublishStarted(page, requests) {
  // Settle first. The save dialog closes on its own once the non-publishing
  // branch is taken, which is both the signal that the save finished and
  // enough real time for a publish request to have shown up if one were
  // coming. Asserting immediately after the blob POST would pass whether or
  // not the publish was suppressed.
  await expect(page.locator("#saveDialog")).toBeHidden();
  const started = requests.filter((request) =>
    request.method === "POST" &&
    (request.url.endsWith("/api/admin/publish") || request.url.includes("admin-publish.yml/dispatches"))
  );
  expect(started.map((request) => request.url)).toEqual([]);
}

test("admin shell starts without browser errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/admin/");

  await expect(page).toHaveTitle("fischr Admin");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("#libraryTitle")).toHaveText("Articles");
  await expect(page.locator("#newEntryButtonLib")).toBeVisible();
  await expect(page.locator("#connectionState")).toHaveText("nicht verbunden");
  expect(errors).toEqual([]);
});

test("article list defers editor and preview runtimes until needed", async ({ page }) => {
  const runtimeRequests = [];
  page.on("request", (request) => {
    if (/vendor\/editor|vendor\/markdown-it|preview-renderer|markdown-conventions/.test(request.url())) runtimeRequests.push(request.url());
  });
  await page.goto("/admin/");
  await expect(page.locator("#libraryTitle")).toHaveText("Articles");
  expect(runtimeRequests).toEqual([]);

  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator(".cm-content")).toBeVisible();
  expect(runtimeRequests.some((url) => url.includes("vendor/editor"))).toBe(true);
  expect(runtimeRequests.some((url) => url.includes("markdown-it"))).toBe(false);
});

test("a reload does not restore a view the settings turned off", async ({ page }) => {
  const configSha = "social-config-sha";
  const disabled = Buffer.from(JSON.stringify({ stats: { enabled: false } }), "utf8").toString("base64");
  await mockAuthenticatedGithub(page, [], [
    { path: "automation/social-config.json", sha: configSha, type: "blob" }
  ], { blobs: { [configSha]: { content: disabled } } });

  await page.goto("/admin/");
  await expect(page.locator("#libraryTitle")).toHaveText("Articles");
  // The tab is the only thing keeping stats unreachable when they are off.
  await expect(page.locator("#statsNav")).toBeHidden();

  // Simulate having been on stats before the setting was flipped: the restore
  // path bypasses the tab, so it needs its own guard or it lands the reader in
  // a view with no tab marked and no way back through the navigation.
  await page.evaluate(() => history.replaceState({ rw: "stats" }, ""));
  await page.reload();

  await expect(page.locator("#statsView")).toBeHidden();
  await expect(page.locator("#libraryView")).toBeVisible();
  await expect(page.locator("#statsNav")).toBeHidden();
});

test("editor runtime can be retried after a failed download", async ({ page }) => {
  let attempts = 0;
  await page.route(/\/admin\/vendor\/editor\/editor\.js(?:\?.*)?$/, (route) => {
    attempts += 1;
    return attempts === 1 ? route.abort("failed") : route.continue();
  });
  await page.goto("/admin/");

  const newPost = page.locator("#newEntryButtonLib");
  await newPost.click();
  await expect.poll(() => attempts).toBe(1);
  await expect(page.locator("#statusBar")).toContainText("Runtime konnte nicht geladen werden");
  await newPost.click();

  await expect.poll(() => attempts).toBe(2);
  await expect(page.locator(".cm-content")).toBeVisible();
  expect(attempts).toBe(2);
});

test("authenticated admin opens the editor and publish dialog", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();

  await expect(page.locator("#editorViewTitle")).toHaveText("New article");
  const title = page.getByPlaceholder("Titel");
  await expect(title).toBeVisible();
  await title.fill("Browser smoke test");
  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Veröffentlichen" }).click();

  await expect(page.getByRole("dialog", { name: "Veröffentlichen" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Veröffentlichen" }).getByRole("button", { name: "Veröffentlichen" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("authenticated startup falls back when the compact snapshot fails", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests);
  await page.unroute("**/api/admin/snapshot");
  await page.route("**/api/admin/snapshot", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ message: "temporary" })
  }));

  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await expect.poll(() => requests.filter((request) => request.method === "GET").length).toBeGreaterThan(0);
  await expect(page.locator("#newEntryButtonLib")).toBeVisible();
});

test("source pages open as raw templates and save without Markdown controls", async ({ page }) => {
  const requests = [];
  const source = `---\ntitle: "Über mich"\npermalink: /about/\n---\n<article>{{ site.title }}</article>\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [
    { path: "blog/about.njk", type: "blob", sha: "identity-sha", size: source.length },
    { path: "blog/pages/datenschutz.md", type: "blob", sha: "privacy-sha", size: 20 }
  ]);
  await page.route(/\/api\/github\/git\/trees\/tree-sha(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ sha: "tree-sha", tree: [
      { path: "blog/about.njk", type: "blob", sha: "identity-sha", size: source.length },
      { path: "blog/pages/datenschutz.md", type: "blob", sha: "privacy-sha", size: 20 }
    ] })
  }));
  await page.route(/\/api\/github\/contents\/blog\/about\.njk/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ sha: "identity-sha", content: Buffer.from(source).toString("base64") })
  }));

  await page.goto("/admin/");
  await page.locator("#entryTypeSelect").selectOption("pages");
  await expect(page.locator("#entryList")).toContainText("Über mich");
  await page.getByText("blog/about.njk", { exact: true }).click();

  await expect(page.locator("#editorViewTitle")).toHaveText("Über mich bearbeiten");
  await expect(page.locator("#titleInput")).toBeHidden();
  // The whole writing bar steps aside, not just the formatting inside it —
  // undo/redo moved in there too and a raw template has no Markdown controls.
  await expect(page.locator("#writingBar")).toBeHidden();
  await expect(page.locator("#formatToolbar")).toBeHidden();
  await expect(page.locator("#undoButton")).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("{{ site.title }}");
  await page.locator("#saveButton").click();
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");
  const blobWrite = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  expect(blobWrite?.body?.content).toBe(source);
});

test("editor inserts image Markdown while GitHub processing is still pending", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests);

  let releaseWorkflow;
  const workflowReleased = new Promise((resolve) => { releaseWorkflow = resolve; });
  await page.route("**/api/github/**", async (route) => {
    if (!route.request().url().includes("admin-normalize-image.yml/runs?")) return route.fallback();
    await workflowReleased;
    return route.fallback();
  });

  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await page.locator("#imageUploadInput").setInputFiles({
    name: "sofort.png",
    mimeType: "image/png",
    buffer: Buffer.from("image")
  });

  await expect(page.locator(".cm-content")).toContainText("![](");
  // Der lokale Pfad, nicht die Auslieferungsadresse: Die entsteht seit der Inhaltsadressierung
  // erst aus den normalisierten Bytes und lässt sich beim Einfügen nicht vorhersagen. Der Build
  // löst den Pfad über das Manifest auf.
  await expect(page.locator(".cm-content")).toContainText("/assets/images/uploads/");
  await expect(page.locator(".cm-content")).not.toContainText("media.mysite.example");
  await expect(page.locator(".cm-content")).toContainText(".webp");
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("Ich kann sofort weiterschreiben.");
  await expect(page.locator(".cm-content")).toContainText("Ich kann sofort weiterschreiben.");

  releaseWorkflow();
  await expect.poll(() => requests.some((request) => request.url.includes("admin-normalize-image.yml/runs?"))).toBe(true);
});

test("failed media can be removed completely and does not poison later saves", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, [], [], { rejectBlobUploads: 1 });
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Fehler sicher behandeln");
  await page.locator("#imageUploadInput").setInputFiles([
    { name: "eins.png", mimeType: "image/png", buffer: Buffer.from("one") },
    { name: "zwei.png", mimeType: "image/png", buffer: Buffer.from("two") }
  ]);

  await expect(page.locator(".cm-content")).toContainText("/assets/images/uploads/");
  await expect(page.locator("#mediaFailureDialog")).toBeVisible();
  await page.getByRole("button", { name: "Medium entfernen" }).click();
  await expect(page.locator(".cm-content")).not.toContainText("/assets/images/uploads/");

  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");
});

test("saving during a failed media upload uses one recovery dialog", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, [], [], { rejectBlobUploads: 1 });
  let releaseFailure;
  const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
  await page.route("**/api/github/**", async (route) => {
    if (route.request().method() !== "POST" || !route.request().url().endsWith("/git/blobs")) {
      return route.fallback();
    }
    await failureGate;
    return route.fallback();
  });
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Upload erneut versuchen");
  await page.locator("#imageUploadInput").setInputFiles({
    name: "retry.png",
    mimeType: "image/png",
    buffer: Buffer.from("retry")
  });
  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Speichern" }).click();
  releaseFailure();

  await expect(page.locator("#mediaFailureDialog")).toBeVisible();
  await page.getByRole("button", { name: "Erneut versuchen" }).click();
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");
  await expect(page.locator("#mediaFailureDialog")).toBeHidden();
});

test("failed media cleanup updates its saved article after navigating away", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests);
  let releaseFailure;
  const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
  await page.route("**/api/github/**", async (route) => {
    if (!route.request().url().includes("admin-normalize-image.yml/runs?")) return route.fallback();
    await failureGate;
    const dispatch = requests.find((request) => request.url.includes("admin-normalize-image.yml/dispatches"));
    const requestId = dispatch?.body?.inputs?.request_id || "missing";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflow_runs: [{ display_title: `Normalize ${requestId}`, status: "completed", conclusion: "failure" }]
      })
    });
  });

  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Artikel mit späterem Medienfehler");
  await page.locator("#imageUploadInput").setInputFiles({
    name: "late-failure.png",
    mimeType: "image/png",
    buffer: Buffer.from("late failure")
  });
  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");
  await expect(page.locator("#saveDialog")).toBeHidden();

  await page.getByRole("button", { name: "Artikel", exact: true }).evaluate((button) => button.click());
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Anderer Artikel");
  releaseFailure();

  await expect(page.locator("#mediaFailureDialog")).toBeVisible();
  await page.getByRole("button", { name: "Medium entfernen" }).click();
  await expect(page.getByPlaceholder("Titel")).toHaveValue("Anderer Artikel");
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" &&
    request.url.endsWith("/git/trees") &&
    request.body.tree?.some((entry) => entry.path.endsWith("artikel-mit-spaeterem-medienfehler.md")) &&
    request.body.tree?.some((entry) => /blog\/assets\/images\/uploads\//.test(entry.path) && entry.sha === null)
  )).toBe(true);
  const cleanedArticleBlob = requests
    .filter((request) => request.method === "POST" && request.url.endsWith("/git/blobs"))
    .map((request) => String(request.body.content || ""))
    .findLast((content) => content.includes("Artikel mit späterem Medienfehler"));
  expect(cleanedArticleBlob).toContain("Artikel mit späterem Medienfehler");
  expect(cleanedArticleBlob).not.toContain("/assets/images/uploads/late-failure.webp");
  expect(cleanedArticleBlob).not.toContain("title: Anderer Artikel");
});

test("failed video cleanup removes only its own poster and metadata", async ({ page }) => {
  const requests = [];
  const metadataPath = "blog/_data/videoMetadata.json";
  const otherPoster = "blog/assets/images/video-posters/other-draft.webp";
  const otherVideo = "/assets/videos/other-draft.mp4";
  const initialMetadata = {
    [otherVideo]: { poster: "/assets/images/video-posters/other-draft.webp", sourceHash: "other" }
  };
  const tree = [
    { path: metadataPath, type: "blob", sha: "initial-metadata" },
    { path: otherPoster, type: "blob", sha: "other-poster" }
  ];
  const blobs = {
    "initial-metadata": { encoding: "utf-8", content: `${JSON.stringify(initialMetadata, null, 2)}\n` }
  };
  let uploadedVideo = "";
  let uploadedPoster = "";

  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, tree, {
    blobs,
    onWorkflowPoll({ workflow, inputs, tree: currentTree, replaceTree }) {
      if (workflow !== "admin-prepare-video.yml") return null;
      uploadedVideo = `/${inputs.source_path.replace(/^blog\//, "")}`;
      uploadedPoster = `blog/assets/images/video-posters/${inputs.source_path.split("/").pop().replace(/\.[^.]+$/, "")}.webp`;
      const preparedMetadata = {
        ...initialMetadata,
        [uploadedVideo]: { poster: `/${uploadedPoster.replace(/^blog\//, "")}`, sourceHash: "uploaded" }
      };
      blobs["prepared-metadata"] = { encoding: "utf-8", content: `${JSON.stringify(preparedMetadata, null, 2)}\n` };
      replaceTree([
        ...currentTree.filter((entry) => entry.path !== metadataPath),
        { path: metadataPath, type: "blob", sha: "prepared-metadata" },
        { path: uploadedPoster, type: "blob", sha: "uploaded-poster" }
      ]);
      const requestId = inputs.request_id;
      return { workflow_runs: [{ display_title: `Prepare video ${requestId}`, status: "completed", conclusion: "failure" }] };
    }
  });

  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.locator("#imageUploadInput").setInputFiles({
    name: "cleanup.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.from("video")
  });
  await expect(page.locator("#mediaFailureDialog")).toBeVisible();
  await page.getByRole("button", { name: "Medium entfernen" }).click();

  const findCleanupTree = () => requests.findLast((request) =>
    request.method === "POST" &&
    request.url.endsWith("/git/trees") &&
    request.body.tree?.some((entry) => entry.path === uploadedPoster && entry.sha === null)
  );
  await expect.poll(findCleanupTree).toBeTruthy();
  const cleanupTree = findCleanupTree();
  expect(cleanupTree.body.tree).toContainEqual(expect.objectContaining({ path: uploadedPoster, sha: null }));
  expect(cleanupTree.body.tree).not.toContainEqual(expect.objectContaining({ path: otherPoster }));
  const cleanedMetadata = requests
    .filter((request) => request.method === "POST" && request.url.endsWith("/git/blobs"))
    .map((request) => String(request.body.content || ""))
    .findLast((content) => content.includes(otherVideo));
  expect(cleanedMetadata).toContain(otherVideo);
  expect(cleanedMetadata).not.toContain(uploadedVideo);
});

test("failed replacement video cleanup restores the complete published family", async ({ page }) => {
  const requests = [];
  const metadataPath = "blog/_data/videoMetadata.json";
  const mainTree = [];
  const blobs = {};
  let uploadedVideo = "";
  let draftPoster = "";
  let mainPoster = "";

  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [], {
    mainTree,
    blobs,
    onWorkflowPoll({ workflow, inputs, tree, replaceTree }) {
      if (workflow !== "admin-prepare-video.yml") return null;
      const base = inputs.source_path.split("/").pop().replace(/\.[^.]+$/, "");
      uploadedVideo = `/${inputs.source_path.replace(/^blog\//, "")}`;
      draftPoster = `blog/assets/images/video-posters/${base}-draft.webp`;
      mainPoster = `blog/assets/images/video-posters/${base}-published.webp`;
      const mainMetadata = { [uploadedVideo]: { poster: `/${mainPoster.replace(/^blog\//, "")}`, sourceHash: "published" } };
      const draftMetadata = { [uploadedVideo]: { poster: `/${draftPoster.replace(/^blog\//, "")}`, sourceHash: "replacement" } };
      blobs["main-family-metadata"] = { encoding: "utf-8", content: `${JSON.stringify(mainMetadata, null, 2)}\n` };
      blobs["draft-family-metadata"] = { encoding: "utf-8", content: `${JSON.stringify(draftMetadata, null, 2)}\n` };
      mainTree.splice(0, mainTree.length,
        { path: inputs.source_path, type: "blob", sha: "published-video" },
        { path: mainPoster, type: "blob", sha: "published-poster" },
        { path: metadataPath, type: "blob", sha: "main-family-metadata" }
      );
      replaceTree([
        ...tree.filter((entry) => entry.path !== metadataPath),
        { path: draftPoster, type: "blob", sha: "draft-poster" },
        { path: metadataPath, type: "blob", sha: "draft-family-metadata" }
      ]);
      return { workflow_runs: [{ display_title: `Prepare video ${inputs.request_id}`, status: "completed", conclusion: "failure" }] };
    }
  });

  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.locator("#imageUploadInput").setInputFiles({
    name: "replacement.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.from("video")
  });
  await expect(page.locator("#mediaFailureDialog")).toBeVisible();
  await page.getByRole("button", { name: "Medium entfernen" }).click();

  const findCleanupTree = () => requests.findLast((request) =>
    request.method === "POST" &&
    request.url.endsWith("/git/trees") &&
    request.body.tree?.some((entry) => entry.path === mainPoster && entry.sha === "published-poster")
  );
  await expect.poll(findCleanupTree).toBeTruthy();
  expect(findCleanupTree().body.tree).toContainEqual(expect.objectContaining({ path: draftPoster, sha: null }));
  const restoredMetadata = requests
    .filter((request) => request.method === "POST" && request.url.endsWith("/git/blobs"))
    .map((request) => String(request.body.content || ""))
    .findLast((content) => content.includes("published"));
  expect(restoredMetadata).toContain(uploadedVideo);
  expect(restoredMetadata).toContain(`/${mainPoster.replace(/^blog\//, "")}`);
  expect(restoredMetadata).not.toContain(`/${draftPoster.replace(/^blog\//, "")}`);
});

test("invalid video metadata aborts cleanup without changing the editor", async ({ page }) => {
  const requests = [];
  const metadataPath = "blog/_data/videoMetadata.json";
  const blobs = { "invalid-metadata": { encoding: "utf-8", content: "{broken" } };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [], {
    blobs,
    onWorkflowPoll({ workflow, inputs, tree, replaceTree }) {
      if (workflow !== "admin-prepare-video.yml") return null;
      replaceTree([
        ...tree.filter((entry) => entry.path !== metadataPath),
        { path: metadataPath, type: "blob", sha: "invalid-metadata" }
      ]);
      return { workflow_runs: [{ display_title: `Prepare video ${inputs.request_id}`, status: "completed", conclusion: "failure" }] };
    }
  });

  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.locator("#imageUploadInput").setInputFiles({
    name: "protected.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.from("video")
  });
  await expect(page.locator("#mediaFailureDialog")).toBeVisible();
  const markdownBeforeCleanup = await page.locator(".cm-content").innerText();
  const requestCount = requests.length;
  await page.getByRole("button", { name: "Medium entfernen" }).click();

  await expect(page.locator("#statusBar")).toContainText("Bereinigung wurde zum Schutz bestehender Videos abgebrochen");
  await expect(page.locator(".cm-content")).toHaveText(markdownBeforeCleanup);
  expect(requests.slice(requestCount).some((request) =>
    request.method === "POST" && request.url.endsWith("/git/trees")
  )).toBe(false);
});

test("a cleanup conflict leaves the editor reference untouched", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [], { rejectCleanupTrees: 1 });
  await page.route("**/api/github/**", async (route) => {
    if (!route.request().url().includes("admin-normalize-image.yml/runs?")) return route.fallback();
    const dispatch = requests.find((request) => request.url.includes("admin-normalize-image.yml/dispatches"));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflow_runs: [{
          display_title: `Normalize ${dispatch?.body?.inputs?.request_id || "missing"}`,
          status: "completed",
          conclusion: "failure"
        }]
      })
    });
  });

  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.locator("#imageUploadInput").setInputFiles({
    name: "conflict.png",
    mimeType: "image/png",
    buffer: Buffer.from("image")
  });
  await expect(page.locator("#mediaFailureDialog")).toBeVisible();
  const markdownBeforeCleanup = await page.locator(".cm-content").innerText();
  await page.getByRole("button", { name: "Medium entfernen" }).click();

  await expect(page.locator("#statusBar")).toContainText("Medium konnte nicht bereinigt werden");
  await expect(page.locator(".cm-content")).toHaveText(markdownBeforeCleanup);
});

test("a refresh failure after the durable cleanup still completes the editor action", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [], { rejectMainRefreshAfterCleanup: 1 });
  await page.route("**/api/github/**", async (route) => {
    if (!route.request().url().includes("admin-normalize-image.yml/runs?")) return route.fallback();
    const dispatch = requests.find((request) => request.url.includes("admin-normalize-image.yml/dispatches"));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflow_runs: [{
          display_title: `Normalize ${dispatch?.body?.inputs?.request_id || "missing"}`,
          status: "completed",
          conclusion: "failure"
        }]
      })
    });
  });

  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Refresh darf Cleanup nicht umdrehen");
  await page.locator("#imageUploadInput").setInputFiles({
    name: "refresh.png",
    mimeType: "image/png",
    buffer: Buffer.from("image")
  });
  await expect(page.locator("#mediaFailureDialog")).toBeVisible();
  await page.getByRole("button", { name: "Medium entfernen" }).click();

  await expect(page.locator("#statusBar")).toContainText("Fehlgeschlagene Medien wurden entfernt");
  await expect(page.locator(".cm-content")).not.toContainText("/assets/images/uploads/");
  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");
});

test("a failed post-commit tree read preserves the cleaned article for its next save", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [], { rejectCleanupReconcileRead: true });
  let releaseFailure;
  const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
  await page.route("**/api/github/**", async (route) => {
    if (!route.request().url().includes("admin-normalize-image.yml/runs?")) return route.fallback();
    await failureGate;
    const dispatch = requests.find((request) => request.url.includes("admin-normalize-image.yml/dispatches"));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflow_runs: [{
          display_title: `Normalize ${dispatch?.body?.inputs?.request_id || "missing"}`,
          status: "completed",
          conclusion: "failure"
        }]
      })
    });
  });

  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Cleanup mit Tree-Ausfall");
  await page.locator("#imageUploadInput").setInputFiles({
    name: "tree-read.png",
    mimeType: "image/png",
    buffer: Buffer.from("image")
  });
  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");
  await expect(page.locator("#saveDialog")).toBeHidden();
  releaseFailure();

  await expect(page.locator("#mediaFailureDialog")).toBeVisible();
  await page.getByRole("button", { name: "Medium entfernen" }).click();
  await expect(page.locator("#statusBar")).toContainText("Fehlgeschlagene Medien wurden entfernt");
  await expect(page.locator(".cm-content")).not.toContainText("/assets/images/uploads/");
  await page.locator(".cm-content").click();
  await page.keyboard.insertText(" Weiterbearbeitet.");
  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");
});

test("saving an edited public article writes to drafts and publishes nothing", async ({ page }) => {
  const requests = [];
  const path = "blog/posts/2026-08-18-public.md";
  const sha = "public-post-sha";
  const content = `---\ntitle: Öffentlicher Artikel\nslug: public\ndate: 2026-08-18T12:00:00+02:00\ndraft: false\n---\n\nÖffentlicher Text.\n`;
  const tree = [{ path, type: "blob", sha, size: content.length }];
  const blobs = { [sha]: { encoding: "base64", content: Buffer.from(content).toString("base64") } };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, tree, { mainTree: tree, blobs });
  await page.goto("/admin/");
  await page.locator('[data-collection="posts"]').evaluate((button) => button.click());
  await page.locator(".entry-card").filter({ hasText: path }).click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" Bearbeitet.");
  await expect(page.locator(".cm-content")).toContainText("Bearbeitet.");

  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator("#saveDialogText")).toContainText("In GitHub gespeichert");

  // Saving writes to drafts and stops there, even for an article that is
  // already public. Every publish is a real Actions build sharing one
  // non-cancelling deploy queue, so the saves made while writing must not each
  // become one. Sending is the deliberate act, and it is a different button.
  await expect(page.getByRole("dialog", { name: "Veröffentlichen" })).toHaveCount(0);
  // The edit itself has to reach the blob. Asserting only that *a* blob was
  // written would hold even if the typing never landed — the save would still
  // write the unchanged article.
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.endsWith("/git/blobs") && /Bearbeitet\./.test(request.body.content || "")
  )).toBe(true);
  await assertNoPublishStarted(page, requests);
});

test("saving a public article as draft queues the removal without publishing it", async ({ page }) => {
  const requests = [];
  const path = "blog/posts/2026-08-18-save-unpublish.md";
  const sha = "save-unpublish-sha";
  const content = `---\ntitle: Öffentlichen Artikel zurückziehen\nslug: save-unpublish\ndate: 2026-08-18T12:00:00+02:00\ndraft: false\n---\n\nÖffentlicher Text.\n`;
  const tree = [{ path, type: "blob", sha, size: content.length }];
  const blobs = { [sha]: { encoding: "base64", content: Buffer.from(content).toString("base64") } };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, tree, { mainTree: tree, blobs });
  await page.goto("/admin/");
  await page.locator('[data-collection="posts"]').evaluate((button) => button.click());
  await page.locator(".entry-card").filter({ hasText: path }).click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await page.locator("#draftInput").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Speichern" }).click();
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.endsWith("/git/blobs") && /draft: true/.test(request.body.content || "")
  )).toBe(true);

  // Ticking the draft box and saving queues the removal; it does not carry it
  // out. Taking the article off the site is what the "⋯" menu's Zurückziehen
  // is for, and that one asks first.
  await assertNoPublishStarted(page, requests);
});

test("unpublishing a public article runs from the article menu, confirmed", async ({ page }) => {
  const requests = [];
  const path = "blog/posts/2026-08-18-public.md";
  const sha = "public-post-sha";
  const content = `---\ntitle: Öffentlicher Artikel\nslug: public\ndate: 2026-08-18T12:00:00+02:00\ndraft: false\n---\n\nÖffentlicher Text.\n`;
  const tree = [{ path, type: "blob", sha, size: content.length }];
  const blobs = { [sha]: { encoding: "base64", content: Buffer.from(content).toString("base64") } };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, tree, { mainTree: tree, blobs });
  await page.goto("/admin/");
  await page.locator('[data-collection="posts"]').evaluate((button) => button.click());
  await page.locator(".entry-card").filter({ hasText: path }).click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");

  // The send button always sends. Unpublishing is the opposite intent and sits
  // behind the article bar's "⋯", where a mis-tap cannot reach it.
  const bar = page.getByRole("navigation", { name: "Artikel" });
  // Public and nothing waiting: there is nothing to send, so no send button.
  // Checked against a sibling that is never hidden, so an editor that had not
  // finished opening could not satisfy this by accident.
  await expect(bar.getByRole("button", { name: "Speichern" })).toBeVisible();
  await expect(page.locator("#publishButton")).toBeHidden();
  await expect(bar.getByRole("button", { name: "Veröffentlichung zurücknehmen" })).toHaveCount(0);

  await bar.getByRole("button", { name: "Weitere Artikelaktionen" }).click();
  const menu = page.getByRole("dialog", { name: "Weitere Artikelaktionen" });
  await menu.getByRole("button", { name: "Veröffentlichung zurückziehen" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Veröffentlichung zurückziehen?" })).toBeVisible();
  await page.getByRole("button", { name: "Zurückziehen", exact: true }).click();

  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.endsWith("/git/blobs") && /draft: true/.test(request.body.content || "")
  )).toBe(true);
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.endsWith("/api/admin/publish")
  )).toBe(true);
});

test("a queued new post is not mistaken for an already public article", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Noch nicht öffentlich");
  await page.locator("#draftInput").evaluate((input) => {
    input.checked = false;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.locator("#editorMetaLine")).toContainText("Veröffentlichung vorgemerkt");
  // Nothing is live yet, so this is a publication and not an update.
  const publish = page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Veröffentlichen" });
  await publish.click();
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.endsWith("/git/blobs") && /draft: false/.test(request.body.content || "")
  )).toBe(true);
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.endsWith("/api/admin/publish")
  )).toBe(true);
});

test("a queued slug rename remains an update of the public article", async ({ page }) => {
  const requests = [];
  const oldPath = "blog/posts/2026-08-18-old.md";
  const newPath = "blog/posts/2026-08-18-new.md";
  const oldContent = `---\ntitle: Alter Titel\nslug: old\ndate: 2026-08-18T12:00:00+02:00\ndraft: false\n---\n\nText.\n`;
  const newContent = oldContent.replace("Alter Titel", "Neuer Titel").replace("slug: old", "slug: new");
  const draftTree = [{ path: newPath, type: "blob", sha: "new-sha", size: newContent.length }];
  const mainTree = [{ path: oldPath, type: "blob", sha: "old-sha", size: oldContent.length }];
  const blobs = {
    "old-sha": { encoding: "base64", content: Buffer.from(oldContent).toString("base64") },
    "new-sha": { encoding: "base64", content: Buffer.from(newContent).toString("base64") }
  };
  const renameContent = `${JSON.stringify({ [newPath]: oldPath }, null, 2)}\n`;
  draftTree.push({ path: "automation/admin-rename-origins.json", type: "blob", sha: "rename-sha", size: renameContent.length });
  blobs["rename-sha"] = { encoding: "base64", content: Buffer.from(renameContent).toString("base64") };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, draftTree, { mainTree, blobs });
  await page.goto("/admin/");
  await page.locator('[data-collection="posts"]').evaluate((button) => button.click());
  await page.locator(".entry-card").filter({ hasText: newPath }).click();

  await expect(page.locator("#editorMetaLine")).toContainText("Veröffentlicht");
  await expect(page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Änderung veröffentlichen" })).toBeVisible();
  await page.locator("#syncButton").evaluate((button) => button.click());
  await expect(page.locator("#queueView")).not.toContainText("admin-rename-origins.json");
  await expect(page.locator("#pushButtonCount")).toHaveText("2");
  const renamedCard = page.locator(".queue-card").filter({ hasText: newPath });
  await renamedCard.getByRole("button", { name: "Verwerfen" }).click();
  await page.locator("#discardDialogAction").click();
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" &&
    request.url.endsWith("/git/trees") &&
    request.body.tree?.some((entry) => entry.path === "automation/admin-rename-origins.json" && entry.sha === null)
  )).toBe(true);
});

test("the send button appears only when there is something to send", async ({ page }) => {
  const requests = [];
  const path = "blog/posts/2026-08-18-public.md";
  const sha = "public-post-sha";
  const content = `---\ntitle: Öffentlicher Artikel\nslug: public\ndate: 2026-08-18T12:00:00+02:00\ndraft: false\n---\n\nÖffentlicher Text.\n`;
  const tree = [{ path, type: "blob", sha, size: content.length }];
  const blobs = { [sha]: { encoding: "base64", content: Buffer.from(content).toString("base64") } };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, tree, { mainTree: tree, blobs });
  await page.goto("/admin/");

  // A fresh draft: nothing is live yet, so sending is the only way anything
  // becomes live and the button has to be there even before a single keystroke.
  await page.locator("#newEntryButtonLib").click();
  const send = page.getByRole("navigation", { name: "Artikel" }).getByRole("button", { name: "Veröffentlichen" });
  await expect(send).toBeVisible();

  // Now the published article. This assertion could pass for the wrong reason —
  // an editor that has not finished opening has no buttons at all — so wait for
  // the editor to be live and for a sibling button that is never hidden before
  // claiming the send button is absent.
  await page.locator('[data-collection="posts"]').evaluate((button) => button.click());
  await page.locator(".entry-card").filter({ hasText: path }).click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  const bar = page.getByRole("navigation", { name: "Artikel" });
  await expect(bar.getByRole("button", { name: "Speichern" })).toBeVisible();
  await expect(page.locator("#editorMetaLine")).toContainText("Veröffentlicht");
  await expect(page.locator("#publishButton")).toBeHidden();
  const saveBefore = await page.locator("#saveButton").boundingBox();

  // One keystroke is a difference, and a difference is worth sending. This is
  // the half that makes the assertion above mean something: the button was
  // genuinely absent and genuinely comes back.
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" Bearbeitet.");
  // Prove the edit landed before reading anything off it. A click alone does
  // not reliably put the caret where insertText needs it, and an assertion
  // about a button reacting to an edit that never happened would pass for the
  // wrong reason.
  await expect(page.locator(".cm-content")).toContainText("Bearbeitet.");
  await expect(bar.getByRole("button", { name: "Änderung veröffentlichen" })).toBeVisible();

  // Its slot was reserved the whole time, so nothing else moved sideways when
  // it appeared — a row that re-flows under the pointer on the first keystroke
  // is exactly the kind of jitter this editor was meant to lose.
  const after = await page.locator("#saveButton").boundingBox();
  expect(Math.round(after.x)).toBe(Math.round(saveBefore.x));
});

test("a send button that is not offered is not reachable either", async ({ page }) => {
  // Reserving the slot means the button is still in the document while there is
  // nothing to send. That must not make it something a keyboard or a screen
  // reader can still land on — otherwise the row is honest to the eye and lying
  // to everyone else.
  const path = "blog/posts/2026-08-18-public.md";
  const sha = "public-post-sha";
  const content = `---\ntitle: Öffentlicher Artikel\nslug: public\ndate: 2026-08-18T12:00:00+02:00\ndraft: false\n---\n\nText.\n`;
  const tree = [{ path, type: "blob", sha, size: content.length }];
  const blobs = { [sha]: { encoding: "base64", content: Buffer.from(content).toString("base64") } };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, [], tree, { mainTree: tree, blobs });
  await page.goto("/admin/");
  await page.locator('[data-collection="posts"]').evaluate((button) => button.click());
  await page.locator(".entry-card").filter({ hasText: path }).click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await expect(page.locator("#publishButton")).toBeHidden();

  // Not focusable, even when asked directly.
  const focusable = await page.locator("#publishButton").evaluate((element) => {
    element.focus();
    return document.activeElement === element;
  });
  expect(focusable).toBe(false);

  // And absent from the bar's accessible contents, not merely invisible in it.
  const labels = await page.getByRole("navigation", { name: "Artikel" })
    .getByRole("button").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
  expect(labels).not.toContain("Veröffentlichen");
  expect(labels).not.toContain("Änderung veröffentlichen");
  expect(labels).toContain("Speichern");
});
