const { test, expect } = require("@playwright/test");

test("admin service worker updates the shell and serves an offline fallback", async ({ page, context }) => {
  await page.route("**/api/admin/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false })
  }));
  await page.goto("/admin/");
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready);
  await page.reload();
  await expect(page).toHaveTitle("fischr Admin");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Articles", exact: true })).toBeVisible();
});
