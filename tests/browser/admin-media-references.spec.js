const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

test("a published video shows the article that uses it", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  await page.route("**/admin/posts-index.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      path: "./blog/posts/video-post.md",
      title: "Video-Beitrag",
      url: "/video-beitrag/",
      date: "2026-07-25T20:00:00.000Z",
      draft: false,
      media: ["/assets/videos/uploads/clip.mp4"]
    }])
  }));
  await mockAuthenticatedGithub(page, [], [
    { path: "blog/assets/videos/uploads/clip.mp4", type: "blob", sha: "video-sha", size: 2400 },
    { path: "blog/assets/images/video-posters/clip.webp", type: "blob", sha: "poster-sha", size: 600 }
  ]);

  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  const videoCard = page.locator('.media-item[data-media-path="blog/assets/videos/uploads/clip.mp4"]');
  await expect(videoCard).toContainText("Video-Beitrag");
  await expect(page.locator('.media-item[data-media-path="blog/assets/images/video-posters/clip.webp"]'))
    .toHaveCount(0);
});

// Bilder aus dem Upload heißen "img_2481.webp". Was darauf zu sehen ist, steht nur im Alt-Text
// des Beitrags, der sie verwendet — die Suche muss ihn deshalb erreichen, und die Karte muss
// ihn zeigen, sonst ist ein Treffer auf einen nichtssagenden Dateinamen nicht erklärbar.
test("finds an image by the alt text of the article that uses it", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  await page.route("**/admin/posts-index.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      path: "./blog/posts/sommerabend.md",
      title: "Sommerabend",
      url: "/sommerabend/",
      date: "2026-07-25T20:00:00.000Z",
      draft: false,
      media: [{ url: "/assets/images/uploads/img_2481.webp", alt: "Zwei Kraniche im Nebel" }]
    }])
  }));
  await mockAuthenticatedGithub(page, [], [
    { path: "blog/assets/images/uploads/img_2481.webp", type: "blob", sha: "cranes-sha", size: 1200 },
    { path: "blog/assets/images/uploads/img_9000.webp", type: "blob", sha: "other-sha", size: 1200 }
  ]);

  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");
  await page.locator('[data-collection="media"]').evaluate((button) => button.click());

  const cranes = page.locator('.media-item[data-media-path="blog/assets/images/uploads/img_2481.webp"]');
  await expect(cranes.locator(".media-alt")).toHaveText("Zwei Kraniche im Nebel");
  await expect(page.locator('.media-item[data-media-path="blog/assets/images/uploads/img_9000.webp"] .media-alt'))
    .toHaveCount(0);

  await page.fill("#mediaSearchInput", "kraniche");
  await expect(page.locator(".media-item")).toHaveCount(1);
  await expect(cranes).toBeVisible();

  await page.fill("#mediaSearchInput", "nebel im wald");
  await expect(page.locator(".media-item")).toHaveCount(0);
});
