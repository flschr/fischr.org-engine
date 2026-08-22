const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

test("media gallery defers media work and exposes stable reusable cards", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, [], [
    { path: "blog/assets/images/uploads/photo.webp", type: "blob", sha: "image-sha", size: 1200 },
    { path: "blog/assets/videos/uploads/clip.mp4", type: "blob", sha: "video-sha", size: 2400 },
    { path: "blog/assets/images/video-posters/clip.webp", type: "blob", sha: "poster-sha", size: 600 }
  ]);
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.evaluate(() => {
    const grid = document.querySelector("#mediaGrid");
    window.__mediaImageFirst = null;
    window.__mediaImageReplaced = false;
    new MutationObserver(() => {
      const image = grid.querySelector("img");
      if (!image) return;
      if (!window.__mediaImageFirst) window.__mediaImageFirst = image;
      else if (window.__mediaImageFirst !== image) window.__mediaImageReplaced = true;
    }).observe(grid, { childList: true, subtree: true });
  });
  // Enter the media view directly; responsive navigation itself has a separate
  // interaction smoke above, while this test is scoped to gallery rendering.
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  const cards = page.locator(".media-item[data-media-path]");
  await expect(cards).toHaveCount(2);
  await expect(cards.locator("img")).toHaveAttribute("loading", "lazy");
  await expect(cards.locator("img")).toHaveAttribute("decoding", "async");
  await expect(cards.locator("video")).toHaveAttribute("preload", "none");
  await expect(cards.locator("video")).toHaveAttribute("poster", "/assets/images/video-posters/clip.webp");
  const image = cards.locator("img");
  await expect.poll(() => image.evaluate((element) => element === window.__mediaImageFirst)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__mediaImageReplaced)).toBe(false);
});

test("deleting a video also deletes its hidden poster and metadata record", async ({ page }) => {
  const requests = [];
  const video = { path: "blog/assets/videos/uploads/clip.mp4", type: "blob", sha: "video-sha", size: 2400 };
  const poster = { path: "blog/assets/images/video-posters/clip.webp", type: "blob", sha: "poster-sha", size: 600 };
  const metadata = { path: "blog/_data/videoMetadata.json", type: "blob", sha: "metadata-sha", size: 300 };
  const metadataContent = `${JSON.stringify({
    "/assets/videos/uploads/clip.mp4": {
      poster: "/assets/images/video-posters/clip.webp",
      sourceHash: "source-hash"
    }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [video, poster, metadata], {
    mainTree: [video, poster, metadata],
    blobs: { "metadata-sha": { content: metadataContent, encoding: "utf-8" } }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  const videoCard = page.locator('.media-item[data-media-path="blog/assets/videos/uploads/clip.mp4"]');
  await videoCard.getByRole("button", { name: "Löschen" }).click();
  await expect(page.locator("#statusBar")).toContainText("Löschung vorgemerkt");

  const treeRequest = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(treeRequest.body.tree).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: video.path, sha: null }),
    expect.objectContaining({ path: poster.path, sha: null }),
    expect.objectContaining({ path: metadata.path, sha: expect.stringMatching(/^blob-sha-/) })
  ]));
  const metadataRequest = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  expect(JSON.parse(metadataRequest.body.content)).toEqual({});
});

test("discarding a queued video deletion restores video, poster and metadata together", async ({ page }) => {
  const requests = [];
  const video = { path: "blog/assets/videos/uploads/clip.mp4", type: "blob", sha: "video-sha", size: 2400 };
  const poster = { path: "blog/assets/images/video-posters/clip.webp", type: "blob", sha: "poster-sha", size: 600 };
  const metadata = { path: "blog/_data/videoMetadata.json", type: "blob", sha: "metadata-sha", size: 300 };
  const metadataContent = `${JSON.stringify({
    "/assets/videos/uploads/clip.mp4": {
      poster: "/assets/images/video-posters/clip.webp",
      sourceHash: "source-hash"
    }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [video, poster, metadata], {
    mainTree: [video, poster, metadata],
    blobs: { "metadata-sha": { content: metadataContent, encoding: "utf-8" } }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());
  await page.locator('.media-item[data-media-path="blog/assets/videos/uploads/clip.mp4"]')
    .getByRole("button", { name: "Löschen" }).click();
  await expect(page.locator("#statusBar")).toContainText("Löschung vorgemerkt");

  await page.locator("#syncButton").evaluate((button) => button.click());
  await expect(page.locator("#syncButton")).toHaveAttribute("aria-label", "1 Änderung veröffentlichen");
  await expect(page.locator(".queue-card")).toHaveCount(1);
  await expect(page.locator(".queue-card")).toContainText(video.path);
  await expect(page.locator(".queue-card")).not.toContainText(poster.path);
  await page.locator(".queue-card").getByRole("button", { name: "Verwerfen" }).click();
  await page.locator("#discardDialogAction").click();
  await expect(page.locator("#statusBar")).toContainText("Removed from the queue");

  const treeRequests = requests.filter((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(treeRequests.at(-1).body.tree).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: video.path, sha: video.sha }),
    expect.objectContaining({ path: poster.path, sha: poster.sha }),
    expect.objectContaining({ path: metadata.path, sha: expect.stringMatching(/^blob-sha-/) })
  ]));
});

test("video deletion fails safely when derivative metadata is missing", async ({ page }) => {
  const requests = [];
  const video = { path: "blog/assets/videos/uploads/clip.mp4", type: "blob", sha: "video-sha", size: 2400 };
  const metadata = { path: "blog/_data/videoMetadata.json", type: "blob", sha: "metadata-sha", size: 3 };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [video, metadata], {
    mainTree: [video, metadata],
    blobs: { "metadata-sha": { content: "{}\n", encoding: "utf-8" } }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());
  await page.locator('.media-item[data-media-path="blog/assets/videos/uploads/clip.mp4"]')
    .getByRole("button", { name: "Löschen" }).click();

  await expect(page.locator("#statusBar")).toContainText("kein gültiges Vorschaubild");
  expect(requests.some((request) => request.method === "POST" && request.url.endsWith("/git/trees"))).toBe(false);
});

test("an incomplete unpublished video upload can still be discarded safely", async ({ page }) => {
  const requests = [];
  const video = { path: "blog/assets/videos/uploads/incomplete.mp4", type: "blob", sha: "video-sha", size: 2400 };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [video]);
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());
  await page.locator(`.media-item[data-media-path="${video.path}"]`)
    .getByRole("button", { name: "Löschen" }).click();

  await expect(page.locator("#statusBar")).toContainText("Upload entfernt");
  const treeRequest = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(treeRequest.body.tree).toEqual([expect.objectContaining({ path: video.path, sha: null })]);
  expect(requests.some((request) => request.method === "POST" && request.url.endsWith("/git/blobs"))).toBe(false);
});

// Entfernt mit dem gleichnamigen Schutz: er konnte nur greifen, solange Poster als Blobs im
// Baum liegen. Seit der R2-Migration liegt dort keines mehr und es entsteht auch keines mehr,
// die Vorbedingung dieses Falls ist damit nicht mehr herstellbar. Der Test hätte weiter eine
// Fiktion geprüft. Siehe 26c-video-derivatives.part.

test("discarding unused uploads keeps posters coupled to their video", async ({ page }) => {
  const requests = [];
  const video = { path: "blog/assets/videos/uploads/new-clip.mp4", type: "blob", sha: "new-video-sha", size: 2400 };
  const poster = { path: "blog/assets/images/video-posters/new-clip.webp", type: "blob", sha: "new-poster-sha", size: 600 };
  const secondVideo = { path: "blog/assets/videos/uploads/second-clip.mp4", type: "blob", sha: "second-video-sha", size: 2600 };
  const secondPoster = { path: "blog/assets/images/video-posters/second-clip.webp", type: "blob", sha: "second-poster-sha", size: 650 };
  const metadata = { path: "blog/_data/videoMetadata.json", type: "blob", sha: "new-metadata-sha", size: 300 };
  const metadataContent = `${JSON.stringify({
    "/assets/videos/uploads/new-clip.mp4": {
      poster: "/assets/images/video-posters/new-clip.webp",
      sourceHash: "new-source-hash"
    },
    "/assets/videos/uploads/second-clip.mp4": {
      poster: "/assets/images/video-posters/second-clip.webp",
      sourceHash: "second-source-hash"
    }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [video, poster, secondVideo, secondPoster, metadata], {
    blobs: { "new-metadata-sha": { content: metadataContent, encoding: "utf-8" } }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator("#syncButton").evaluate((button) => button.click());

  await expect(page.locator("#cleanupOrphansCount")).toHaveText("2");
  await page.locator("#cleanupOrphansButton").click();
  await page.locator("#discardDialogAction").click();
  await expect(page.locator("#statusBar")).toContainText("2 unbenutzte Uploads entfernt");

  const treeRequests = requests.filter((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(treeRequests).toHaveLength(1);
  const treeRequest = treeRequests[0];
  expect(treeRequest.body.tree).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: video.path, sha: null }),
    expect.objectContaining({ path: poster.path, sha: null }),
    expect.objectContaining({ path: secondVideo.path, sha: null }),
    expect.objectContaining({ path: secondPoster.path, sha: null }),
    expect.objectContaining({ path: metadata.path, sha: expect.stringMatching(/^blob-sha-/) })
  ]));
  const metadataRequest = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  expect(JSON.parse(metadataRequest.body.content)).toEqual({});
});

test("invalid metadata in the second unused video prevents every commit", async ({ page }) => {
  const requests = [];
  const firstVideo = { path: "blog/assets/videos/uploads/first.mp4", type: "blob", sha: "first-video-sha", size: 2400 };
  const firstPoster = { path: "blog/assets/images/video-posters/first.webp", type: "blob", sha: "first-poster-sha", size: 600 };
  const secondVideo = { path: "blog/assets/videos/uploads/second.mp4", type: "blob", sha: "second-video-sha", size: 2600 };
  const publishedSecondVideo = { ...secondVideo, sha: "published-second-video-sha" };
  const secondPoster = { path: "blog/assets/images/video-posters/second.webp", type: "blob", sha: "second-poster-sha", size: 650 };
  const metadata = { path: "blog/_data/videoMetadata.json", type: "blob", sha: "metadata-sha", size: 300 };
  const mainMetadata = { ...metadata, sha: "main-metadata-sha" };
  const metadataContent = `${JSON.stringify({
    "/assets/videos/uploads/first.mp4": { poster: "/assets/images/video-posters/first.webp", sourceHash: "first" },
    "/assets/videos/uploads/second.mp4": { sourceHash: "second" }
  }, null, 2)}\n`;
  const mainMetadataContent = `${JSON.stringify({
    "/assets/videos/uploads/second.mp4": { poster: "/assets/images/video-posters/second.webp", sourceHash: "published-second" }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [firstVideo, firstPoster, secondVideo, secondPoster, metadata], {
    mainTree: [publishedSecondVideo, secondPoster, mainMetadata],
    blobs: {
      "metadata-sha": { content: metadataContent, encoding: "utf-8" },
      "main-metadata-sha": { content: mainMetadataContent, encoding: "utf-8" }
    }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator("#syncButton").evaluate((button) => button.click());
  await page.locator("#cleanupOrphansButton").click();
  await page.locator("#discardDialogAction").click();

  await expect(page.locator("#statusBar")).toContainText("Verwerfen fehlgeschlagen");
  const writes = requests.filter((request) => request.method === "POST" && /\/git\/(?:blobs|trees|commits)$/.test(request.url));
  expect(writes).toHaveLength(0);
});

test("a standalone poster repair stays visible and publishable", async ({ page }) => {
  const requests = [];
  const poster = { path: "blog/assets/images/video-posters/repaired.webp", type: "blob", sha: "poster-sha", size: 600 };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [poster]);
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await expect(page.locator("#syncButton")).toHaveAttribute("aria-label", "1 Änderung veröffentlichen");
  await expect(page.locator("#syncButton")).toBeEnabled();
  await page.locator("#syncButton").evaluate((button) => button.click());
  await expect(page.locator(".queue-card")).toHaveCount(1);
  await expect(page.locator(".queue-card")).toContainText("Technische Video-Reparatur");
  await expect(page.locator(".queue-card")).not.toContainText(poster.path);
  await page.locator("#pushButton").click();
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.includes("admin-publish.yml/dispatches")
  )).toBe(true);
  const dispatch = requests.find((request) => request.url.includes("admin-publish.yml/dispatches"));
  expect(dispatch.body.inputs.change_count).toBe("1");
});

test("a standalone poster repair can be discarded without exposing its path", async ({ page }) => {
  const requests = [];
  const poster = { path: "blog/assets/images/video-posters/repaired.webp", type: "blob", sha: "poster-sha", size: 600 };
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [poster]);
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator("#syncButton").evaluate((button) => button.click());
  await expect(page.locator(".queue-card")).not.toContainText(poster.path);
  await page.locator(".queue-card").getByRole("button", { name: "Verwerfen" }).click();
  await page.locator("#discardDialogAction").click();
  await expect(page.locator("#statusBar")).toContainText("Removed from the queue");
  const treeRequest = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(treeRequest.body.tree).toEqual([expect.objectContaining({ path: poster.path, sha: null })]);
});

test("discarding an unpublished video upload removes all generated derivatives", async ({ page }) => {
  const requests = [];
  const video = { path: "blog/assets/videos/uploads/new-clip.mp4", type: "blob", sha: "new-video-sha", size: 2400 };
  const poster = { path: "blog/assets/images/video-posters/new-clip.webp", type: "blob", sha: "new-poster-sha", size: 600 };
  const metadata = { path: "blog/_data/videoMetadata.json", type: "blob", sha: "new-metadata-sha", size: 300 };
  const metadataContent = `${JSON.stringify({
    "/assets/videos/uploads/new-clip.mp4": {
      poster: "/assets/images/video-posters/new-clip.webp",
      sourceHash: "new-source-hash"
    }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [video, poster, metadata], {
    blobs: { "new-metadata-sha": { content: metadataContent, encoding: "utf-8" } }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());
  await page.locator(`.media-item[data-media-path="${video.path}"]`)
    .getByRole("button", { name: "Löschen" }).click();

  await expect(page.locator("#statusBar")).toContainText("Upload entfernt");
  const treeRequest = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(treeRequest.body.tree).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: video.path, sha: null }),
    expect.objectContaining({ path: poster.path, sha: null }),
    expect.objectContaining({ path: metadata.path, sha: expect.stringMatching(/^blob-sha-/) })
  ]));
  const metadataRequest = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  expect(JSON.parse(metadataRequest.body.content)).toEqual({});
});

// Posters live in R2 since DB-1129 and are no longer blobs in the tree. The admin used to
// demand one in both of these paths, which left every video permanently "unprepared" and every
// deletion impossible.
test("deleting a video whose poster lives only in R2 succeeds", async ({ page }) => {
  const requests = [];
  const video = { path: "blog/assets/videos/uploads/clip.mp4", type: "blob", sha: "video-sha", size: 2400 };
  const metadata = { path: "blog/_data/videoMetadata.json", type: "blob", sha: "metadata-sha", size: 300 };
  const metadataContent = `${JSON.stringify({
    "/assets/videos/uploads/clip.mp4": {
      poster: "/assets/images/video-posters/clip.webp",
      sourceHash: "source-hash"
    }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [video, metadata], {
    mainTree: [video, metadata],
    blobs: { "metadata-sha": { content: metadataContent, encoding: "utf-8" } }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  const videoCard = page.locator('.media-item[data-media-path="blog/assets/videos/uploads/clip.mp4"]');
  await videoCard.getByRole("button", { name: "Löschen" }).click();
  await expect(page.locator("#statusBar")).toContainText("Löschung vorgemerkt");
  await expect(page.locator("#statusBar")).not.toContainText("Vorschaubild");

  const treeRequest = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(treeRequest.body.tree).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: video.path, sha: null }),
    expect.objectContaining({ path: metadata.path, sha: expect.stringMatching(/^blob-sha-/) })
  ]));
  // Nothing may be staged for a poster that is not tracked — the tree API would be asked to
  // delete a path that does not exist.
  expect(treeRequest.body.tree.some((entry) => entry.path.includes("video-posters"))).toBe(false);
  const metadataRequest = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  expect(JSON.parse(metadataRequest.body.content)).toEqual({});
});

test("a queued video with metadata but no poster blob does not block publishing", async ({ page }) => {
  const requests = [];
  const video = { path: "blog/assets/videos/uploads/clip.mp4", type: "blob", sha: "video-sha", size: 2400 };
  const metadata = { path: "blog/_data/videoMetadata.json", type: "blob", sha: "metadata-sha", size: 300 };
  const metadataContent = `${JSON.stringify({
    "/assets/videos/uploads/clip.mp4": {
      poster: "/assets/images/video-posters/clip.webp",
      sourceHash: "source-hash"
    }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [video, metadata], {
    mainTree: [metadata],
    blobs: { "metadata-sha": { content: metadataContent, encoding: "utf-8" } }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator("#syncButton").evaluate((button) => button.click());
  await expect(page.locator(".queue-card")).toHaveCount(1);
  await page.locator("#pushButton").evaluate((button) => button.click());

  // The guard rejects with this message and then re-dispatches the preparation workflow; a
  // video whose metadata is committed must pass both.
  await expect(page.locator("#statusBar")).not.toContainText("wartet, bis GitHub alle Medien verarbeitet");
  await expect
    .poll(() => requests.filter((request) => request.url.includes("admin-prepare-video.yml/dispatches")).length)
    .toBe(0);
});

// Since DB-1129 the media bytes live in R2 and blog/assets/images|videos hold no blobs at all.
// The gallery kept listing the tree and therefore showed "No media yet." for the whole library.
test("media gallery lists files that only exist in the R2 manifest", async ({ page }) => {
  const manifest = { path: "automation/media-manifest.json", type: "blob", sha: "manifest-sha", size: 400 };
  const manifestContent = `${JSON.stringify({
    "images/responsive/uploads/photo-abcdef123456-680.webp": { sha256: "variant-hash", size: 400 },
    "images/uploads/copy.webp": { sha256: "photo-hash", size: 1200 },
    "images/uploads/photo.webp": { sha256: "photo-hash", size: 1200 },
    "images/video-posters/clip.webp": { sha256: "poster-hash", size: 600 },
    "videos/uploads/clip.mp4": { sha256: "clip-hash", size: 2400 }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, [], [manifest], {
    mainTree: [manifest],
    blobs: { "manifest-sha": { content: manifestContent, encoding: "utf-8" } }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  const cards = page.locator(".media-item[data-media-path]");
  await expect(cards).toHaveCount(3);
  await expect(page.locator('.media-item[data-media-path="blog/assets/images/uploads/photo.webp"]')).toBeVisible();
  await expect(page.locator('.media-item[data-media-path="blog/assets/videos/uploads/clip.mp4"] video'))
    .toHaveAttribute("poster", "/assets/images/video-posters/clip.webp");
  // Derived objects carry manifest entries too and must stay out of the library: the poster is
  // hidden behind its video, the responsive variant only ever exists in _site and R2.
  await expect(page.locator('.media-item[data-media-path*="video-posters"]')).toHaveCount(0);
  await expect(page.locator('.media-item[data-media-path*="responsive"]')).toHaveCount(0);
  // Duplicates are recognized through the manifest's sha256 now that no blob sha exists.
  await expect(page.locator('.media-item[data-media-path="blog/assets/images/uploads/photo.webp"] .entry-meta'))
    .toContainText("Duplikat");
});

test("deleting an image that only exists in R2 removes its manifest entry", async ({ page }) => {
  const requests = [];
  const manifest = { path: "automation/media-manifest.json", type: "blob", sha: "manifest-sha", size: 400 };
  const manifestContent = `${JSON.stringify({
    "images/uploads/keep.webp": { sha256: "keep-hash", size: 900 },
    "images/uploads/photo.webp": { sha256: "photo-hash", size: 1200 }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [manifest], {
    mainTree: [manifest],
    blobs: { "manifest-sha": { content: manifestContent, encoding: "utf-8" } }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  const card = page.locator('.media-item[data-media-path="blog/assets/images/uploads/photo.webp"]');
  await card.getByRole("button", { name: "Löschen" }).click();
  await expect(page.locator("#statusBar")).toContainText("Löschung vorgemerkt");

  const blobRequest = requests.findLast((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  expect(JSON.parse(blobRequest.body.content)).toEqual({ "images/uploads/keep.webp": { sha256: "keep-hash", size: 900 } });
  const treeRequest = requests.findLast((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(treeRequest.body.tree).toEqual([
    expect.objectContaining({ path: manifest.path, sha: expect.stringMatching(/^blob-sha-/) })
  ]);
  // Nothing may be staged for the image itself — the tree API would be asked to delete a path
  // that does not exist.
  expect(treeRequest.body.tree.some((entry) => entry.path.includes("uploads/photo.webp"))).toBe(false);
  await expect(page.locator(".media-item[data-media-path]")).toHaveCount(1);
});

test("deleting a video that only exists in R2 removes its manifest entry and metadata", async ({ page }) => {
  const requests = [];
  const manifest = { path: "automation/media-manifest.json", type: "blob", sha: "manifest-sha", size: 400 };
  const metadata = { path: "blog/_data/videoMetadata.json", type: "blob", sha: "metadata-sha", size: 300 };
  const manifestContent = `${JSON.stringify({
    "videos/uploads/clip.mp4": { sha256: "clip-hash", size: 2400 }
  }, null, 2)}\n`;
  const metadataContent = `${JSON.stringify({
    "/assets/videos/uploads/clip.mp4": { poster: "/assets/images/video-posters/clip.webp", sourceHash: "source-hash" }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [manifest, metadata], {
    mainTree: [manifest, metadata],
    blobs: {
      "manifest-sha": { content: manifestContent, encoding: "utf-8" },
      "metadata-sha": { content: metadataContent, encoding: "utf-8" }
    }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  const card = page.locator('.media-item[data-media-path="blog/assets/videos/uploads/clip.mp4"]');
  await card.getByRole("button", { name: "Löschen" }).click();
  await expect(page.locator("#statusBar")).toContainText("Löschung vorgemerkt");

  const treeRequest = requests.findLast((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(treeRequest.body.tree).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: manifest.path, sha: expect.stringMatching(/^blob-sha-/) }),
    expect.objectContaining({ path: metadata.path, sha: expect.stringMatching(/^blob-sha-/) })
  ]));
  expect(treeRequest.body.tree.some((entry) => entry.path.includes("videos/uploads/clip.mp4"))).toBe(false);
  await expect(page.locator(".media-item[data-media-path]")).toHaveCount(0);
});

// An upload is recorded as a small automation/media-uploads/ record and only folded into the
// manifest by the next production build (lib/media-manifest.js). Until then the file has no
// manifest entry, no blob and no queue change — a gallery that only reads the manifest cannot
// see the image the writer just uploaded.
test("media gallery lists an upload that is only recorded, not yet folded into the manifest", async ({ page }) => {
  const manifest = { path: "automation/media-manifest.json", type: "blob", sha: "manifest-sha", size: 400 };
  const record = { path: "automation/media-uploads/images__uploads__fresh.webp.json", type: "blob", sha: "record-sha", size: 120 };
  const manifestContent = `${JSON.stringify({
    "images/uploads/old.webp": { sha256: "old-hash", size: 900 }
  }, null, 2)}\n`;
  const recordContent = `${JSON.stringify({
    key: "images/uploads/fresh.webp",
    entry: { sha256: "fresh-hash", size: 3072, contentType: "image/webp" }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, [], [manifest, record], {
    mainTree: [manifest, record],
    blobs: {
      "manifest-sha": { content: manifestContent, encoding: "utf-8" },
      "record-sha": { content: recordContent, encoding: "utf-8" }
    }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  await expect(page.locator(".media-item[data-media-path]")).toHaveCount(2);
  await expect(page.locator('.media-item[data-media-path="blog/assets/images/uploads/fresh.webp"] .entry-meta'))
    .toContainText("3 KB");
});

test("deleting a recorded upload removes its record instead of rewriting the manifest", async ({ page }) => {
  const requests = [];
  const manifest = { path: "automation/media-manifest.json", type: "blob", sha: "manifest-sha", size: 400 };
  const record = { path: "automation/media-uploads/images__uploads__fresh.webp.json", type: "blob", sha: "record-sha", size: 120 };
  const manifestContent = `${JSON.stringify({
    "images/uploads/old.webp": { sha256: "old-hash", size: 900 }
  }, null, 2)}\n`;
  const recordContent = `${JSON.stringify({
    key: "images/uploads/fresh.webp",
    entry: { sha256: "fresh-hash", size: 3072 }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [manifest, record], {
    mainTree: [manifest, record],
    blobs: {
      "manifest-sha": { content: manifestContent, encoding: "utf-8" },
      "record-sha": { content: recordContent, encoding: "utf-8" }
    }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  await page.locator('.media-item[data-media-path="blog/assets/images/uploads/fresh.webp"]')
    .getByRole("button", { name: "Löschen" }).click();
  await expect(page.locator("#statusBar")).toContainText("Löschung vorgemerkt");

  const treeRequest = requests.findLast((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(treeRequest.body.tree).toEqual([expect.objectContaining({ path: record.path, sha: null })]);
  // The key is not in the committed manifest, so rewriting 2.7 MB would be pure noise.
  expect(treeRequest.body.tree.some((entry) => entry.path === manifest.path)).toBe(false);
  await expect(page.locator(".media-item[data-media-path]")).toHaveCount(1);
});

test("deleting a re-uploaded file removes manifest entry and record in one commit", async ({ page }) => {
  const requests = [];
  const manifest = { path: "automation/media-manifest.json", type: "blob", sha: "manifest-sha", size: 400 };
  const record = { path: "automation/media-uploads/images__uploads__photo.webp.json", type: "blob", sha: "record-sha", size: 120 };
  const manifestContent = `${JSON.stringify({
    "images/uploads/photo.webp": { sha256: "old-hash", size: 900 }
  }, null, 2)}\n`;
  const recordContent = `${JSON.stringify({
    key: "images/uploads/photo.webp",
    entry: { sha256: "new-hash", size: 3072 }
  }, null, 2)}\n`;
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests, [manifest, record], {
    mainTree: [manifest, record],
    blobs: {
      "manifest-sha": { content: manifestContent, encoding: "utf-8" },
      "record-sha": { content: recordContent, encoding: "utf-8" }
    }
  });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  // One file, one card: the record is the newer upload for that key and wins over the manifest.
  const card = page.locator('.media-item[data-media-path="blog/assets/images/uploads/photo.webp"]');
  await expect(page.locator(".media-item[data-media-path]")).toHaveCount(1);
  await expect(card.locator(".entry-meta")).toContainText("3 KB");

  await card.getByRole("button", { name: "Löschen" }).click();
  await expect(page.locator("#statusBar")).toContainText("Löschung vorgemerkt");

  const treeRequest = requests.findLast((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  // Both halves in one commit — dropping only the manifest entry would let the next build fold
  // the record back in and resurrect the file.
  expect(treeRequest.body.tree).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: manifest.path, sha: expect.stringMatching(/^blob-sha-/) }),
    expect.objectContaining({ path: record.path, sha: null })
  ]));
  const blobRequest = requests.findLast((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  expect(JSON.parse(blobRequest.body.content)).toEqual({});
  await expect(page.locator(".media-item[data-media-path]")).toHaveCount(0);
});
