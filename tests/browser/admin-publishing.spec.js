const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

test("authenticated editor saves a real draft snapshot and dispatches its reviewed commit", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  const requests = [];
  await mockAuthenticatedGithub(page, requests);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await page.getByPlaceholder("Titel").fill("Transactional browser test");
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("Saved through the GitHub object API.");
  await page.getByRole("navigation", { name: "Editor" }).getByRole("button", { name: "Veröffentlichen" }).click();
  await page.getByRole("dialog", { name: "Veröffentlichen" }).getByRole("button", { name: "Veröffentlichen" }).click();
  await expect(page.locator("#syncNowDialog")).toBeVisible();
  await page.locator("#syncNowDialog").getByRole("button", { name: "Veröffentlichen und syncen" }).click();
  await expect.poll(() => requests.some((request) => request.method === "POST" && request.url.includes("admin-publish.yml/dispatches"))).toBe(true);
  const dispatch = requests.find((request) => request.url.includes("admin-publish.yml/dispatches"));
  expect(dispatch.body.inputs.draft_sha).toBe("new-commit-sha");
  expect(dispatch.body.inputs.main_sha).toBe("main-head-sha");
  expect(dispatch.body.inputs.change_count).toBe("1");

  // Der Modus steht nur in der gespeicherten Anfrage, nicht in den Workflow-Inputs: Aus ihm
  // beschriftet sich die Fortschrittskarte, und nur ein Content-Publish warnt nach 90 Sekunden.
  // Er wurde still leer gelassen, weil `publishPlan` im Browser den Absatz `<p id="publishPlan">`
  // traf statt eines Plans — ein Fehler, den nur eine Prüfung im echten Dokument sieht.
  const storedRequest = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("rw-admin-publish-request-v1"))
  );
  expect(storedRequest.validationMode).toBe("content");
});
