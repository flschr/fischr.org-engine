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
