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
  // Gestartet wird über den eigenen Endpunkt, nicht mehr per Dispatch aus dem Browser. Was
  // geprüft wird, ist unverändert: Es geht genau der Stand raus, den die Queue gezeigt hat.
  await expect.poll(() => requests.some((request) => request.method === "POST" && request.url.endsWith("/api/admin/publish"))).toBe(true);
  const start = requests.find((request) => request.url.endsWith("/api/admin/publish"));
  expect(start.body.draftSha).toBe("new-commit-sha");
  expect(start.body.mainSha).toBe("main-head-sha");
  expect(start.body.changeCount).toBe(1);
  expect(requests.some((request) => request.url.includes("admin-publish.yml/dispatches"))).toBe(false);

  // Der Modus steht nur in der gespeicherten Anfrage, nicht in den Workflow-Inputs: Aus ihm
  // beschriftet sich die Fortschrittskarte, und nur ein Content-Publish warnt nach 90 Sekunden.
  // Er wurde still leer gelassen, weil `publishPlan` im Browser den Absatz `<p id="publishPlan">`
  // traf statt eines Plans — ein Fehler, den nur eine Prüfung im echten Dokument sieht.
  const storedRequest = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("rw-admin-publish-request-v1"))
  );
  expect(storedRequest.validationMode).toBe("content");
  // Die Kennung der Instanz muss den Neuladen überleben — sie ist der einzige Weg zurück zu
  // einem Vorgang, für den nie ein Actions-Lauf erscheint.
  expect(storedRequest.workflowId).toBe("workflow-instance-1");
});

// Die Warteschlange ist der einzige Ort, der zeigt, was eine laufende Veröffentlichung gerade
// tut: Fortschritt, Schritt, Lauf-Link, Fehlermeldung. Solange ihr Knopf während des Laufs
// gesperrt war, sperrte er genau diese Sicht aus — wer den Admin während eines Laufs öffnete,
// kam bis zu dessen Ende nicht mehr hinein.
test("die Warteschlange bleibt während einer laufenden Veröffentlichung erreichbar", async ({ page }) => {
  await page.unroute("**/api/admin/auth/session");
  const requests = [];
  await mockAuthenticatedGithub(page, requests, [], {
    onWorkflowPoll({ workflow }) {
      if (workflow !== "admin-publish.yml") return null;
      return {
        workflow_runs: [{
          id: 4711,
          display_title: "Publish laufender-lauf",
          status: "in_progress",
          html_url: "https://github.com/example/example-blog/actions/runs/4711",
          created_at: "2026-01-01T10:00:00Z"
        }]
      };
    }
  });

  // Der Admin wird geladen, während auf GitHub bereits veröffentlicht wird: Der laufende Vorgang
  // wird beim Start gefunden, ohne dass in dieser Sitzung etwas angestossen wurde.
  await page.goto("/admin/");
  await expect(page.locator("#syncButton")).toHaveClass(/is-publishing/);
  await expect(page.locator("#queueView")).toBeHidden();

  // Ein echter Klick — an einem gesperrten Knopf würde er scheitern.
  await expect(page.locator("#syncButton")).toBeEnabled();
  await page.locator("#syncButton").click();
  await expect(page.locator("#queueView")).toBeVisible();
  await expect(page.locator(".queue-progress")).toBeVisible();

  // Sichtbar heisst nicht startbar: Veröffentlicht wird weiterhin nichts, solange etwas läuft.
  await expect(page.locator("#pushButton")).toBeDisabled();
});
