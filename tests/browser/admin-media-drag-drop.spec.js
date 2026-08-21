const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

test("editor drag and drop accepts a QuickTime video without a MIME type", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator(".cm-content")).toBeVisible();

  await page.locator("#editorForm").evaluate((editor) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["quicktime"], "rasenmaeher.MOV", { type: "" }));
    for (const type of ["dragenter", "dragover", "drop"]) {
      editor.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
  });

  await expect(page.locator(".cm-content")).toContainText("!video(/assets/videos/uploads/");
  await expect(page.locator(".cm-content")).toContainText(".mov)");
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" && request.url.includes("admin-prepare-video.yml/dispatches")
  )).toBe(true);
});

test("editor drag and drop accepts WebKit's protected phase and uploads every photo once", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator(".cm-content")).toBeVisible();

  await page.locator("#editorForm").evaluate((editor) => {
    const first = new File(["first-photo"], "first.jpg", { type: "image/jpeg", lastModified: 1 });
    const second = new File(["second-photo"], "second.jpg", { type: "image/jpeg", lastModified: 2 });
    const protectedTransfer = {
      files: [],
      items: [{ kind: "string", type: "text/plain" }],
      types: ["text/plain", "Files"],
      dropEffect: "none"
    };
    window.__protectedDragAccepted = ["dragenter", "dragover"].every((type) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: protectedTransfer });
      editor.dispatchEvent(event);
      return event.defaultPrevented;
    });

    const transfer = new DataTransfer();
    transfer.items.add(first);
    transfer.items.add(second);
    editor.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });

  await expect.poll(() => page.evaluate(() => window.__protectedDragAccepted)).toBe(true);
  await expect(page.locator("#statusBar")).toContainText(/2 Uploads (?:werden im Hintergrund verarbeitet|fertig)/);
  await expect(page.locator(".cm-content")).toContainText("first-");
  await expect(page.locator(".cm-content")).toContainText("second-");
  await expect.poll(() => requests.filter((request) =>
    request.method === "POST" && request.url.includes("admin-normalize-image.yml/dispatches")
  ).length).toBe(2);
});

test("editor drag and drop retains files exposed only through transfer items", async ({ page }) => {
  const requests = [];
  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, requests);
  await page.goto("/admin/");
  await page.locator("#newEntryButtonLib").click();
  await expect(page.locator(".cm-content")).toBeVisible();

  await page.locator("#editorForm").evaluate((editor) => {
    const first = new File(["first-photo"], "first.jpg", { type: "image/jpeg", lastModified: 1 });
    const second = new File(["second-photo"], "second.jpg", { type: "image/jpeg", lastModified: 2 });
    const transfer = {
      files: [first],
      items: [first, second].map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
      types: ["Files"],
      dropEffect: "none"
    };
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    editor.dispatchEvent(event);
  });

  await expect(page.locator("#statusBar")).toContainText(/2 Uploads (?:werden im Hintergrund verarbeitet|fertig)/);
  await expect(page.locator(".cm-content")).toContainText("first-");
  await expect(page.locator(".cm-content")).toContainText("second-");
  await expect.poll(() => requests.filter((request) =>
    request.method === "POST" && request.url.includes("admin-normalize-image.yml/dispatches")
  ).length).toBe(2);
});
