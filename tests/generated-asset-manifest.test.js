const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createManifest, validateManifest } = require("../lib/eleventy/generated-asset-manifest");
const { removeObsoletePublicStyles } = require("../scripts/build-admin-vendor");

test("generated asset validation rejects changed and missing outputs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generated-assets-"));
  const output = "generated/app.js";
  const manifest = "generated/manifest.json";
  fs.mkdirSync(path.join(root, "generated"), { recursive: true });
  fs.writeFileSync(path.join(root, output), "expected");
  fs.writeFileSync(path.join(root, manifest), JSON.stringify(createManifest(root, [output])));

  assert.deepEqual(validateManifest(root, [output], manifest), { ok: true });
  fs.writeFileSync(path.join(root, output), "changed");
  assert.match(validateManifest(root, [output], manifest).reason, /outputs changed/);
  fs.rmSync(path.join(root, output));
  assert.match(validateManifest(root, [output], manifest).reason, /outputs missing/);
});

test("public style builds remove obsolete CSS outputs only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generated-styles-"));
  const directory = path.join(root, "blog/assets/css/generated");
  const main = path.join(directory, "main.css");
  const obsolete = path.join(directory, "identity.css");
  const unrelated = path.join(directory, "notes.txt");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(main, "main");
  fs.writeFileSync(obsolete, "obsolete");
  fs.writeFileSync(unrelated, "keep");

  removeObsoletePublicStyles(root, { main: "blog/assets/css/generated/main.css" });

  assert.equal(fs.existsSync(main), true);
  assert.equal(fs.existsSync(obsolete), false);
  assert.equal(fs.existsSync(unrelated), true);
});
