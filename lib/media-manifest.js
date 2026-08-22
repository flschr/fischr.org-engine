// Read side of the R2 media manifest, shared by everything that resolves a media reference:
// the Eleventy delivery mapping (lib/eleventy/media-assets.js), the social-image check, and
// the upload/publish scripts via scripts/lib/r2-media.js.
//
// Two files make up the effective manifest:
//
//   automation/media-manifest.json   the committed manifest (~2.7 MB, 6000+ entries)
//   automation/media-uploads/*.json  one small record per upload not yet folded in
//
// The split exists so a writer can record an upload by creating a few hundred bytes instead
// of reading and rewriting megabytes. The next production build folds the records in and
// deletes them (compactPendingUploads in scripts/lib/r2-media.js).
//
// Deliberately dependency-free (no sharp, no aws4fetch) so the Eleventy build and any
// request-time caller can require it without pulling in the upload machinery.

const fs = require("fs");
const path = require("path");

const manifestRelativePath = "automation/media-manifest.json";
const pendingUploadsRelativeDir = "automation/media-uploads";

function pendingUploadFileName(key) {
  return `${String(key).replace(/[^a-zA-Z0-9._-]+/g, "__")}.json`;
}

// A missing manifest is normal (a fresh checkout before the first upload); a malformed one
// is not. Failing loudly matters more since DB-1129 removed media from Git: a silently empty
// manifest no longer means "serve the local copy", it means every image 404s.
function readBaseManifest(root) {
  const file = path.join(root, manifestRelativePath);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${manifestRelativePath} is not valid JSON: ${error.message}`);
  }
}

// Records are `{ key, entry }` rather than bare entries, so the R2 object key survives the
// filename sanitizing in pendingUploadFileName and stays readable during review.
function readPendingUploads(root) {
  const dir = path.join(root, pendingUploadsRelativeDir);
  if (!fs.existsSync(dir)) return {};
  const pending = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    let record;
    try {
      record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch (error) {
      throw new Error(`${pendingUploadsRelativeDir}/${name} is not valid JSON: ${error.message}`);
    }
    if (!record || typeof record.key !== "string" || !record.key || !record.entry) {
      throw new Error(`${pendingUploadsRelativeDir}/${name} is not a { key, entry } upload record.`);
    }
    pending[record.key] = record.entry;
  }
  return pending;
}

// A pending record wins: it is by definition the newer upload for that key, and compaction
// folds in the same direction.
function readMergedManifest(root) {
  return { ...readBaseManifest(root), ...readPendingUploads(root) };
}

module.exports = {
  manifestRelativePath,
  pendingUploadFileName,
  pendingUploadsRelativeDir,
  readBaseManifest,
  readMergedManifest,
  readPendingUploads
};
