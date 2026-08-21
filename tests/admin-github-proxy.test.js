const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const proxySource = fs.readFileSync(path.join(root, "functions/api/github/[[path]].js"), "utf8");
const mediaServiceSource = fs.readFileSync(path.join(root, "blog/admin/media-service.js"), "utf8");

test("GitHub proxy permits every admin media workflow used by the editor", () => {
  const mediaWorkflows = Array.from(
    mediaServiceSource.matchAll(/dispatch\(\s*"([^"]+\.yml)"/g),
    (match) => match[1]
  );

  assert.deepEqual(mediaWorkflows.sort(), ["admin-normalize-image.yml", "admin-prepare-video.yml"]);
  mediaWorkflows.forEach((workflow) => {
    assert.ok(proxySource.includes(`"${workflow}"`), `${workflow} must be allowed by the proxy`);
  });
});

test("GitHub proxy keeps workflow access on an explicit allowlist", () => {
  assert.match(proxySource, /ALLOWED_WORKFLOWS\.has\(workflow\[1\]\)/);
  assert.doesNotMatch(proxySource, /endpoint\.startsWith\("actions\/workflows\/"\)/);
});
