const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadModule() {
  const window = { crypto: { randomUUID: () => "request-123" } };
  const source = fs.readFileSync(path.join(__dirname, "..", "blog/admin/publish-status.js"), "utf8");
  vm.runInNewContext(source, { window, Math, Date });
  return window.RWPublishStatus;
}

test("publish requests use stable ids and match their workflow run", () => {
  const status = loadModule();
  assert.equal(status.createRequestId(), "request-123");
  const run = status.findRequestRun({ workflow_runs: [
    { id: 1, display_title: "Publish another-request" },
    { id: 2, display_title: "Publish request-123" }
  ] }, "request-123");
  assert.equal(run.id, 2);
});

test("publish status exposes the active workflow phase", () => {
  const status = loadModule();
  const result = status.describeRun(
    { id: 2, status: "in_progress", html_url: "https://example.test/run" },
    { jobs: [{ steps: [{ name: "Validate production site", status: "in_progress" }] }] }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    state: "running",
    message: "Website bauen und prüfen",
    runId: 2,
    url: "https://example.test/run",
    step: "Validate production site",
    phaseIndex: 7,
    phaseCount: 12,
    timings: { waitingMs: null, preparationMs: null, validationMs: null, deploymentMs: null },
    slowContent: false
  });
});

test("publish status separates queue, preparation, validation, and deploy timing", () => {
  const status = loadModule();
  const result = status.describeRun(
    { id: 2, status: "in_progress", created_at: "2026-07-22T10:00:00Z" },
    { jobs: [{
      started_at: "2026-07-22T10:01:00Z",
      steps: [
        { name: "Validate production site", status: "completed", started_at: "2026-07-22T10:01:30Z", completed_at: "2026-07-22T10:02:30Z" },
        { name: "Deploy to Cloudflare Pages", status: "in_progress", started_at: "2026-07-22T10:02:30Z" }
      ]
    }] },
    { validationMode: "content", startedAt: "2026-07-22T10:00:00Z" }
  );
  assert.equal(result.timings.waitingMs, 60000);
  assert.equal(result.timings.preparationMs, 30000);
  assert.equal(result.timings.validationMs, 60000);
  assert.ok(result.timings.deploymentMs > 0);
  assert.equal(result.slowContent, true);
});

test("every publish workflow phase has a user-facing progress label", () => {
  const status = loadModule();
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/admin-publish.yml"), "utf8");
  const workflowPhases = Array.from(workflow.matchAll(/^\s{6}- name: (.+)$/gm), (match) => match[1]);
  assert.deepEqual(Array.from(status.phaseNames), workflowPhases);
});

test("publish status names the failed workflow phase", () => {
  const status = loadModule();
  const result = status.describeRun(
    { id: 2, status: "completed", conclusion: "failure", html_url: "https://example.test/run" },
    { jobs: [{ steps: [{ name: "Deploy to Cloudflare Pages", conclusion: "failure" }] }] }
  );
  assert.equal(result.state, "failed");
  assert.match(result.message, /Deploy to Cloudflare Pages/);
});
