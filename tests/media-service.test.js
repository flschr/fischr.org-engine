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

test("media service dispatches a durable image request and waits for its exact run", async () => {
  const calls = [];
  const service = loadService().create({
    publishBranch: "main",
    createRequestId: () => "request-1",
    delay: async () => {},
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
