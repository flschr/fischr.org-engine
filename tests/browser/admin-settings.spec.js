const { test, expect } = require("@playwright/test");
const { mockAuthenticatedGithub, useAdminRouteDefaults } = require("./admin-test-support");

useAdminRouteDefaults(test);

// Die Social-Konfiguration ist die einzige Datei, die der Admin nicht in die Entwürfe schreibt,
// sondern direkt auf den Veröffentlichungs-Branch — von dort liest sie der Syndikations-Cron.
// Dieser Weg hatte keinen eigenen Test, und genau darin lief er ab 2026-07-20 in einen
// ReferenceError: der gemeinsame Commit-Helfer war in den Entwurfsspeicher gewandert, dieser
// zweite Aufrufer nicht. Sichtbar war das nur als Text in der Statuszeile.
test("saving the settings commits the social configuration onto the published branch", async ({ page }) => {
  const configSha = "social-config-sha";
  const stored = {
    social: {
      gotosocialInstance: "https://social.example.org",
      maxAgeDays: 30,
      rules: [{ id: "artikel", name: "Artikel", template: "{title} {url}" }]
    },
    stats: { enabled: true }
  };
  const requests = [];
  // mainTree, not just the initial (drafts) tree: saving now passes expectedBlobs
  // (compare-and-swap against the published branch — see 14a-social-controls.js),
  // which reads the tree behind refs/heads/main, not the drafts tree.
  await mockAuthenticatedGithub(page, requests, [
    { path: "automation/social-config.json", sha: configSha, type: "blob" }
  ], {
    mainTree: [{ path: "automation/social-config.json", sha: configSha, type: "blob" }],
    blobs: { [configSha]: { content: Buffer.from(JSON.stringify(stored), "utf8").toString("base64") } }
  });

  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/admin/");
  await page.locator("#syncButton").click();
  await page.locator("#queueSettingsButton").click();
  await expect(page.locator("#cfgGotosocialInstance")).toHaveValue("https://social.example.org");

  await page.locator("#cfgGotosocialInstance").fill("https://social.fischr.example");
  const save = page.locator("#socialConfigSave");
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page.locator("#socialConfigStatus")).toHaveText("Gespeichert");
  await expect(page.locator("#statusBar")).toContainText("Social-Konfiguration gespeichert.");
  expect(errors).toEqual([]);

  // Der Commit muss auf dem Veröffentlichungs-Branch landen, nicht in den Entwürfen.
  const refUpdates = requests.filter((request) => request.method === "PATCH" && request.url.includes("/git/refs/heads/"));
  expect(refUpdates.map((request) => decodeURIComponent(request.url.split("/git/refs/heads/")[1]))).toEqual(["main"]);

  const upload = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  const saved = JSON.parse(upload.body.content);
  expect(saved.social.gotosocialInstance).toBe("https://social.fischr.example");
  // The loaded fixture still carries the retired stats toggle — a save
  // migrates it away rather than round-tripping it forever.
  expect("stats" in saved).toBe(false);

  const tree = requests.find((request) => request.method === "POST" && request.url.endsWith("/git/trees"));
  expect(tree.body.tree.map((entry) => entry.path)).toEqual(["automation/social-config.json"]);
});

// Ohne diese Absicherung würde ein leeres {} als "geladen" durchgehen (dieselbe Klasse Bug wie
// beim Sync-Schalter, siehe 27f-social-sync-toggle.js): Speichern hätte die komplette Datei auf
// den Entwurf reduziert, der aus dem gescheiterten Laden entstand.
test("a failed config load blocks saving instead of overwriting the file", async ({ page }) => {
  const requests = [];
  // Keine passende Baumzeile: der Inhaltsabruf liefert leeren Inhalt, JSON.parse("") wirft,
  // loadSocialConfig() fängt das intern ab und setzt nie eine echte socialConfigSha.
  await mockAuthenticatedGithub(page, requests, [], { mainTree: [] });

  await page.goto("/admin/");
  await page.locator("#syncButton").click();
  await page.locator("#queueSettingsButton").click();

  await page.locator("#cfgGotosocialInstance").fill("https://social.fischr.example");
  const save = page.locator("#socialConfigSave");
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page.locator("#statusBar")).toContainText("Konnte nicht geladen werden");

  const blobUploads = requests.filter((request) => request.method === "POST" && request.url.endsWith("/git/blobs"));
  expect(blobUploads).toEqual([]);
});
