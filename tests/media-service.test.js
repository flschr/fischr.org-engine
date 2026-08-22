const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadService() {
  const window = {};
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "blog/admin/media-service.js"), "utf8"),
    { window }
  );
  return window.RWMediaService;
}

// 404 = the media endpoint is not deployed. The workflow has to remain a complete fallback,
// so this branch can be merged and even deployed before the endpoint is configured.
test("media service dispatches a durable image request and waits for its exact run", async () => {
  const calls = [];
  const service = loadService().create({
    publishBranch: "main",
    createRequestId: () => "request-1",
    delay: async () => {},
    fetchImpl: async () => ({ status: 404, ok: false }),
    github: async (path, options) => {
      calls.push({ path, options });
      if (path.includes("/runs?")) {
        return { workflow_runs: [{ display_title: "Normalize request-1", status: "completed", conclusion: "success" }] };
      }
      return {};
    }
  });
  await service.normalizeImage("draft-sha", "blog/assets/images/uploads/raw.png", "blog/assets/images/uploads/raw.webp");
  assert.equal(calls[0].path, "actions/workflows/admin-normalize-image.yml/dispatches");
  assert.equal(calls[0].options.body.inputs.draft_sha, "draft-sha");
  assert.equal(calls[0].options.body.inputs.target_path, "blog/assets/images/uploads/raw.webp");
});

test("media service prefers the endpoint and never dispatches a workflow when it answers", async () => {
  const dispatched = [];
  const record = { key: "images/uploads/raw.webp", entry: { sha256: "abc" } };
  const service = loadService().create({
    publishBranch: "main",
    createRequestId: () => "request-1",
    delay: async () => {},
    github: async (path, options) => {
      dispatched.push(path);
      return {};
    },
    fetchImpl: async (url, init) => {
      assert.equal(url, "/api/admin/media/normalize");
      assert.equal(init.credentials, "same-origin");
      assert.deepEqual(JSON.parse(init.body), {
        draftSha: "draft-sha",
        sourcePath: "blog/assets/images/uploads/raw.png",
        targetPath: "blog/assets/images/uploads/raw.webp"
      });
      return {
        status: 200,
        ok: true,
        json: async () => ({
          status: "normalized",
          recordPath: "automation/media-uploads/images__uploads__raw.webp.json",
          record
        })
      };
    }
  });

  const result = await service.normalizeImage(
    "draft-sha", "blog/assets/images/uploads/raw.png", "blog/assets/images/uploads/raw.webp"
  );
  assert.equal(result.via, "endpoint");
  assert.equal(result.status, "normalized");
  assert.deepEqual(result.record, record);
  assert.deepEqual(dispatched, [], "the workflow must not run when the endpoint handled it");
});

// An image over the transform ceiling is the workflow's job, not a failure to report.
test("media service falls back to the workflow for an oversized image", async () => {
  const dispatched = [];
  const service = loadService().create({
    publishBranch: "main",
    createRequestId: () => "request-1",
    delay: async () => {},
    github: async (path) => {
      dispatched.push(path);
      if (path.includes("/runs?")) {
        return { workflow_runs: [{ display_title: "Normalize request-1", status: "completed", conclusion: "success" }] };
      }
      return {};
    },
    fetchImpl: async () => ({ status: 413, ok: false })
  });

  const result = await service.normalizeImage(
    "draft-sha", "blog/assets/images/uploads/raw.png", "blog/assets/images/uploads/raw.webp"
  );
  assert.equal(result.via, "workflow");
  assert.equal(dispatched[0], "actions/workflows/admin-normalize-image.yml/dispatches");
});

// A real endpoint defect must surface immediately instead of quietly costing the writer
// another minute in a workflow run.
test("media service surfaces a genuine endpoint failure instead of falling back", async () => {
  const dispatched = [];
  const service = loadService().create({
    publishBranch: "main",
    createRequestId: () => "request-1",
    delay: async () => {},
    github: async (path) => {
      dispatched.push(path);
      return {};
    },
    fetchImpl: async () => ({
      status: 502,
      ok: false,
      json: async () => ({ message: "Bildumwandlung fehlgeschlagen." })
    })
  });

  await assert.rejects(
    () => service.normalizeImage("draft-sha", "blog/assets/images/uploads/raw.png", "blog/assets/images/uploads/raw.webp"),
    /Bildumwandlung fehlgeschlagen/
  );
  assert.deepEqual(dispatched, []);
});
