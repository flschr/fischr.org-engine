const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadService() {
  const window = {};
  const source = fs.readFileSync(path.join(__dirname, "..", "blog/admin/publish-service.js"), "utf8");
  vm.runInNewContext(source, { window });
  return window.RWPublishService;
}

// Die Wiederaufnahme liest jetzt das Buch. Das findet eine Veröffentlichung auch dann, wenn es
// noch keinen Actions-Lauf gibt — genau das Fenster, in dem der alte Weg blind war und ein
// Neuladen den Vorgang verlor.
test("publish service discovers an active publish across devices", async () => {
  const service = loadService();
  const gefragt = [];
  const request = await service.discoverActiveRequest(async (url, optionen) => {
    gefragt.push({ url, optionen });
    return {
      ok: true,
      json: async () => ({
        laufend: {
          requestId: "shared-request",
          workflowId: "cf_abc",
          runId: 77,
          changeCount: 3,
          startedAt: "2026-07-19T10:00:00Z"
        }
      })
    };
  });

  assert.equal(gefragt.length, 1);
  assert.equal(gefragt[0].url, "/api/admin/publish");
  assert.equal(gefragt[0].optionen.credentials, "same-origin");
  assert.equal(request.requestId, "shared-request");
  assert.equal(request.workflowId, "cf_abc");
  assert.equal(request.runId, 77);
  assert.equal(request.changeCount, 3);
  assert.equal(request.startedAt, "2026-07-19T10:00:00Z");
});

// Eine Veröffentlichung, die noch keinen Lauf hat, ist trotzdem eine — sie darf beim Neuladen
// nicht verloren gehen, nur weil Actions noch nichts anzuzeigen hat.
test("a publish without a run yet is still found", async () => {
  const service = loadService();
  const request = await service.discoverActiveRequest(async () => ({
    ok: true,
    json: async () => ({ laufend: { requestId: "frisch", workflowId: "cf_neu", runId: null, changeCount: 1, startedAt: "" } })
  }));
  assert.equal(request.requestId, "frisch");
  assert.equal(request.runId, null);
});

test("publish service persists only a local cache of the GitHub ledger", () => {
  const service = loadService();
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  service.persistRequest(storage, "publish", { requestId: "abc" });
  assert.equal(service.storedRequest(storage, "publish").requestId, "abc");
  service.clearRequest(storage, "publish");
  assert.equal(service.storedRequest(storage, "publish"), null);
});

// Abgeschlossene Veröffentlichungen stehen weiter im Buch, halten aber nichts mehr. Sie dürfen
// beim Neuladen nicht als laufend wiederauferstehen.
test("publish service does not resurrect a completed run", async () => {
  const service = loadService();
  assert.equal(await service.discoverActiveRequest(async () => ({ ok: true, json: async () => ({ laufend: null }) })), null);
});

// Die Wiederaufnahme ist Komfort. Fällt sie aus, startet der Admin ohne sie — statt gar nicht.
test("a failed lookup does not break startup", async () => {
  const service = loadService();
  assert.equal(await service.discoverActiveRequest(async () => { throw new Error("offline"); }), null);
  assert.equal(await service.discoverActiveRequest(async () => ({ ok: false, status: 503 })), null);
});

// Der Workflow ist die einzige Stelle, die weiss, dass er gar nicht erst bauen wird. Ohne diese
// Auskunft sähe „entschieden, nicht zu bauen" genauso aus wie „Lauf noch nicht sichtbar".
test("der Workflow-Zustand wird über den eigenen Endpunkt gelesen", async () => {
  const service = loadService();
  const aufrufe = [];
  const zustand = await service.fetchWorkflowState("wf 1", async (url, optionen) => {
    aufrufe.push({ url, optionen });
    return { ok: true, json: async () => ({ id: "wf 1", status: "complete", output: { status: "veraltet" } }) };
  });

  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].url, "/api/admin/publish/wf%201");
  assert.equal(aufrufe[0].optionen.credentials, "same-origin");
  assert.equal(zustand.output.status, "veraltet");
});

// Eine Nebenauskunft darf die Statusabfrage nicht mitreissen: Fällt sie aus, bleibt der bisher
// gelesene Zustand gültig, statt eine laufende Veröffentlichung als gescheitert zu melden.
test("ein Ausfall der Workflow-Abfrage bleibt folgenlos", async () => {
  const service = loadService();

  assert.equal(await service.fetchWorkflowState(""), null, "ohne Kennung wird nicht gefragt");
  assert.equal(await service.fetchWorkflowState("wf-1", async () => { throw new Error("offline"); }), null);
  assert.equal(await service.fetchWorkflowState("wf-1", async () => ({ ok: false, status: 503 })), null);
});

// fetchStatus hatte bisher keine eigene Prüfung — nur Greps auf den Quelltext, die nicht sagen,
// was die Funktion tut. Sie ist die Stelle, an der der Titelabgleich verschwunden ist.
test("the run is fetched by its number, not searched for by title", async () => {
  const service = loadService();
  const gefragt = [];
  const github = async (endpunkt) => {
    gefragt.push(endpunkt);
    if (/^actions\/runs\/4711$/.test(endpunkt)) return { id: 4711, status: "in_progress", html_url: "https://x/4711" };
    return { jobs: [{ steps: [{ name: "Publish drafts", status: "in_progress" }] }] };
  };

  const status = await service.fetchStatus(github, statusModulStub(), { requestId: "r1", runId: 4711 });

  assert.deepEqual(gefragt, ["actions/runs/4711", "actions/runs/4711/jobs?per_page=100"]);
  assert.equal(status.gesehen.run.id, 4711);
  // Kein Auflisten mehr, kein Titel — sonst wäre die Kopplung an admin-publish.yml zurück.
  assert.equal(gefragt.some((endpunkt) => endpunkt.includes("workflows/admin-publish.yml")), false);
});

// Bis der Workflow den Lauf gefunden und ins Buch geschrieben hat, gibt es keine Nummer. Das ist
// kein Fehler, sondern das normale erste Fenster jeder Veröffentlichung.
test("without a run number nothing is fetched at all", async () => {
  const service = loadService();
  const gefragt = [];
  const status = await service.fetchStatus(async (endpunkt) => { gefragt.push(endpunkt); return {}; },
    statusModulStub(), { requestId: "r1" });

  assert.deepEqual(gefragt, [], "ohne Nummer wird GitHub nicht befragt");
  assert.equal(status.gesehen.run, null);
});

function statusModulStub() {
  return { describeRun: (run, jobs, request) => ({ state: "running", gesehen: { run, jobs, request } }) };
}
