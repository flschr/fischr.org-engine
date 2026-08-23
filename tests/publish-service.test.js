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

test("publish service discovers an active GitHub publish across devices", async () => {
  const service = loadService();
  const request = await service.discoverActiveRequest(async () => ({
    workflow_runs: [
      { display_title: "Publish completed", status: "completed" },
      { display_title: "Publish shared-request", status: "in_progress", created_at: "2026-07-19T10:00:00Z" }
    ]
  }), "main");
  assert.equal(request.requestId, "shared-request");
  assert.equal(request.discoveredFromGithub, true);
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

test("publish service does not resurrect a completed failed run", async () => {
  const service = loadService();
  const request = await service.discoverActiveRequest(async () => ({
    workflow_runs: [{
      display_title: "Publish failed-request",
      status: "completed",
      conclusion: "failure",
      created_at: new Date().toISOString()
    }]
  }), "main");
  assert.equal(request, null);
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
