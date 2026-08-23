const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

// Ein weggewischter Dialog darf nicht die vorige Wahl wiederholen.
//
// `<dialog>.returnValue` überlebt das Schliessen. Nach einem Escape leert Chromium ihn, WebKit
// lässt ihn stehen — gemessen mit einem echten Tastendruck auf einem nackten <dialog>:
//
//     chromium:  nach Klick "delete"  →  nach Escape ""
//     webkit:    nach Klick "delete"  →  nach Escape "delete"
//
// Ein Dialog, der seinen Wert nicht vor dem Öffnen zurücksetzt, antwortet beim zweiten Mal also
// mit der ersten Antwort, ohne dass jemand etwas gewählt hätte. Beim Löschen heisst das: eine
// zweite Löschung in der Warteschlange, die niemand bestätigt hat — auf dem Gerät, auf dem
// geschrieben wird, und auf Chromium unsichtbar.
//
// Deshalb läuft dieser Test in beiden Desktop-Engines. Auf Chromium allein wäre er immer grün,
// egal wie kaputt der Code ist.
test("ein weggewischter Löschdialog merkt nichts vor", async ({ page }) => {
  const erster = { path: "blog/posts/2026-01-01-erster.md", type: "blob", sha: "sha-erster", size: 40 };
  const zweiter = { path: "blog/posts/2026-01-02-zweiter.md", type: "blob", sha: "sha-zweiter", size: 40 };
  const tree = [erster, zweiter];
  const inhalt = (titel) => Buffer.from(`---\ntitle: ${titel}\ndate: 2026-01-01\n---\n\nText.\n`).toString("base64");
  const blobs = {
    "sha-erster": { encoding: "base64", content: inhalt("Erster") },
    "sha-zweiter": { encoding: "base64", content: inhalt("Zweiter") }
  };

  await page.unroute("**/api/admin/auth/session");
  await mockAuthenticatedGithub(page, [], tree, { mainTree: tree, blobs });
  await page.goto("/admin/");
  await expect(page.locator("#connectionState")).toHaveText("verbunden");

  const loeschen = async (pfad) => {
    await page.locator('[data-collection="posts"]').evaluate((button) => button.click());
    await page.locator(".entry-card").filter({ hasText: pfad }).click();
    await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
    await page.locator("#docMenuButton").click();
    await expect(page.locator("#docMenuDialog")).toBeVisible();
    await page.locator("#docMenuDelete").click();
    await expect(page.locator("#deleteDialog")).toBeVisible();
  };

  // Einmal wirklich löschen — danach trägt der Dialog "delete" in seinem returnValue.
  await loeschen(erster.path);
  await page.getByRole("button", { name: "Löschung vormerken" }).click();
  await expect(page.locator("#syncButton")).toHaveAttribute("aria-label", "1 Änderung veröffentlichen");

  // Denselben Dialog erneut öffnen und wegwischen, ohne etwas zu wählen.
  await loeschen(zweiter.path);
  await page.keyboard.press("Escape");
  await expect(page.locator("#deleteDialog")).toBeHidden();

  // Geprüft wird in der Warteschlange, nicht am Knopf.
  //
  // Die Beschriftung sagt vor und nach dem Fehler dasselbe, solange die zweite Löschung noch
  // nicht gerendert ist — eine Zusicherung darauf war erfüllt, bevor überhaupt etwas passieren
  // konnte, und blieb deshalb auch dann grün, als der Fehler nachweislich auftrat. Das Öffnen
  // der Warteschlange wartet auf ihr Rendern, hier gibt es dieses Fenster nicht.
  await page.locator("#syncButton").evaluate((button) => button.click());
  await expect(page.locator("#queueView")).toBeVisible();
  await expect(page.locator(".queue-card")).toHaveCount(1);
});
