const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

// Der Schalter lebt in der Sync-Ansicht, nicht in den Einstellungen, und schreibt trotzdem
// dieselbe automation/social-config.json direkt auf den Veröffentlichungs-Branch — mit
// derselben Absicherung (expectedBlobs) wie das Einstellungen-Formular, seit ein Audit
// (PR #183) zeigte, dass ein fehlgeschlagenes Laden sonst fast die ganze Datei überschreiben
// könnte und zwei unabhängige Schreiber sich sonst stillschweigend überschreiben.
//
// Zwei einzelne Tests statt eines mit Pause-dann-Fortsetzen-Ablaufs: Der Mock-Baum für den
// Veröffentlichungs-Branch ist eine statische Fixture (siehe mainTree in admin-test-support.js)
// und zieht einen zweiten Commit in derselben Sitzung nicht nach — ein zweiter Schreibvorgang
// im selben Test träfe deshalb den Fixture-Stand, nicht die eigene erste Schreibung.
test("the sync toggle pauses GoToSocial posting", async ({ page }) => {
  const configSha = "social-config-sha";
  const stored = { social: { gotosocialInstance: "https://social.example.org", rules: [{ id: "artikel", name: "Artikel", template: "{title} {url}" }] } };
  const requests = [];
  const initialEntry = { path: "automation/social-config.json", sha: configSha, type: "blob" };
  await mockAuthenticatedGithub(page, requests, [initialEntry], {
    mainTree: [initialEntry],
    blobs: { [configSha]: { content: Buffer.from(JSON.stringify(stored), "utf8").toString("base64") } }
  });

  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/admin/");
  await page.locator("#syncButton").click();

  const toggle = page.locator("#socialSyncToggle");
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();

  await toggle.uncheck();
  await expect(page.locator("#statusBar")).toContainText("Social-Sync pausiert.");

  const upload = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  const saved = JSON.parse(upload.body.content);
  expect(saved.social.enabled).toBe(false);
  expect(saved.social.gotosocialInstance).toBe("https://social.example.org");

  expect(errors).toEqual([]);
});

test("the sync toggle resumes GoToSocial posting", async ({ page }) => {
  const configSha = "social-config-sha";
  const stored = { social: { gotosocialInstance: "https://social.example.org", enabled: false, rules: [{ id: "artikel", name: "Artikel", template: "{title} {url}" }] } };
  const requests = [];
  const initialEntry = { path: "automation/social-config.json", sha: configSha, type: "blob" };
  await mockAuthenticatedGithub(page, requests, [initialEntry], {
    mainTree: [initialEntry],
    blobs: { [configSha]: { content: Buffer.from(JSON.stringify(stored), "utf8").toString("base64") } }
  });

  await page.goto("/admin/");
  await page.locator("#syncButton").click();

  const toggle = page.locator("#socialSyncToggle");
  await expect(toggle).not.toBeChecked();

  await toggle.check();
  await expect(page.locator("#statusBar")).toContainText("Social-Sync fortgesetzt.");

  const upload = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  const saved = JSON.parse(upload.body.content);
  expect("enabled" in saved.social).toBe(false);
});

// Ohne diese Absicherung würde ein leeres {} als "geladen" durchgehen (siehe
// refreshSocialSyncToggle in 27f-social-sync-toggle.js): der Schalter zeigte "aktiv" und ein
// Klick hätte die komplette Konfigurationsdatei auf { social: { enabled: false } } reduziert.
test("a failed config load leaves the sync toggle disabled instead of writable", async ({ page }) => {
  const requests = [];
  // Keine passende Baumzeile: der Inhaltsabruf liefert leeren Inhalt, JSON.parse("") wirft,
  // loadSocialConfig() fängt das intern ab und setzt nie eine echte socialConfigSha.
  await mockAuthenticatedGithub(page, requests, [], { mainTree: [] });

  await page.goto("/admin/");
  await page.locator("#syncButton").click();

  const toggle = page.locator("#socialSyncToggle");
  await expect(toggle).toBeDisabled();

  const blobUploads = requests.filter((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  expect(blobUploads).toEqual([]);
});
