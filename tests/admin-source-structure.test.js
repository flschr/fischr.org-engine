const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const adminSource = require("./helpers/admin-source");

test("admin source is split into bounded responsibilities and builds losslessly", () => {
  const root = path.join(__dirname, "..");
  const sourceDir = path.join(root, "blog/admin/admin-src");
  const parts = fs.readdirSync(sourceDir).filter((name) => name.endsWith(".part")).sort();
  assert.ok(parts.length >= 20);
  for (const name of parts) {
    const lines = fs.readFileSync(path.join(sourceDir, name), "utf8").split("\n").length - 1;
    assert.ok(lines <= 200, `${name} must stay at or below 200 lines`);
  }
  const built = fs.readFileSync(path.join(root, "blog/admin/vendor/app/admin.js"), "utf8");
  assert.equal(built, adminSource());
});
