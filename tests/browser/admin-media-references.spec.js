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
