const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const manifestFile = "blog/admin/vendor/.build-manifest.json";
const inputPaths = [
  "package-lock.json",
  "scripts/build-admin-vendor.js",
  "lib/eleventy/admin-icon-bundle.js",
  "lib/eleventy/generated-asset-manifest.js",
  "lib/eleventy/runtime-vendors.js",
  "blog/admin/admin-src",
  "blog/admin/editor-src",
  "blog/admin/css-src",
  "blog/assets/css-src"
];

function filesBelow(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  if (fs.statSync(absolutePath).isFile()) return [relativePath];
  return fs.readdirSync(absolutePath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => filesBelow(root, path.join(relativePath, entry.name)));
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sourceHash(root, inputs = inputPaths) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of inputs.flatMap((input) => filesBelow(root, input))) {
    hash.update(relativePath).update("\0").update(fs.readFileSync(path.join(root, relativePath))).update("\0");
  }
  return hash.digest("hex");
}

function createManifest(root, outputs) {
  return { sourceHash: sourceHash(root), outputs: Object.fromEntries(outputs.map((file) => [file, fileHash(path.join(root, file))])) };
}

function validateManifest(root, outputs, manifestPath = manifestFile) {
  const missing = outputs.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length) return { ok: false, reason: `outputs missing: ${missing.join(", ")}` };
  const absoluteManifest = path.join(root, manifestPath);
  if (!fs.existsSync(absoluteManifest)) return { ok: false, reason: "build manifest missing" };
  const recorded = JSON.parse(fs.readFileSync(absoluteManifest, "utf8"));
  if (recorded.sourceHash !== sourceHash(root)) return { ok: false, reason: "sources changed" };
  const changed = outputs.filter((file) => recorded.outputs?.[file] !== fileHash(path.join(root, file)));
  return changed.length ? { ok: false, reason: `outputs changed: ${changed.join(", ")}` } : { ok: true };
}

module.exports = { createManifest, filesBelow, manifestFile, sourceHash, validateManifest };
