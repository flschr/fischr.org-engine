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

// The R2 object key an entry's bytes actually live under, which is no longer always the key
// the entry is filed under.
//
// Originally the two were the same: the manifest key was derived from the asset's path and was
// also the object key. That made the object key *mutable* — replacing an image PUT new bytes
// under an existing key — and the delivery domain serves with `max-age=31536000`, so the edge
// kept answering with the old bytes for up to a year. On 2026-08-23 that stopped every deploy.
//
// Entries written since carry an explicit `objectKey` derived from their content hash, so a
// replacement is a *new* object and can never contradict a cached one. An entry without the
// field is one of the originals: its bytes live at its manifest key and stay there for good.
// Nothing rewrites those, because the addresses are baked into published feed items, syndicated
// posts and roughly 1,400 absolute URLs across the post archive — all of which must keep
// resolving.
// Where an object's bytes go from now on: the address is the content. Deliberately built from
// string operations only, so this stays importable from anywhere — including a Workers runtime
// with no node:path.
//
// The two-hex shard keeps a ListObjectsV2 page from becoming one flat directory of thousands of
// entries, which is what the drift report walks. The extension is kept so a key stays
// recognisable when someone inspects the bucket by hand; Content-Type is set explicitly on
// upload either way.
//
// functions/api/admin/media/normalize.js mirrors this — it is ESM on Workers and cannot import
// this CommonJS module — and tests/media-manifest.test.js asserts the two agree.
function contentAddressedKey(sourceKey, sha256) {
  const lastDot = String(sourceKey).lastIndexOf(".");
  const lastSlash = String(sourceKey).lastIndexOf("/");
  const extension = lastDot > lastSlash && lastDot !== -1 ? String(sourceKey).slice(lastDot).toLowerCase() : "";
  return `cas/${sha256.slice(0, 2)}/${sha256}${extension}`;
}

// Heisst absichtlich nicht objectKeyFor: scripts/check-media-delivery.js führt eine eigene
// Funktion dieses Namens, die aus einem publicPath den *Manifest*-Schlüssel ableitet — also
// genau die andere Richtung. Zwei gleichnamige Funktionen mit unterschiedlicher Signatur wären
// eine Falle, die niemand bemerkt: hier mit einem Argument aufgerufen ergäbe sie stillschweigend
// undefined statt eines Fehlers.
function storedObjectKey(entry, manifestKey) {
  const explicit = entry && entry.objectKey;
  return typeof explicit === "string" && explicit ? explicit : manifestKey;
}

// Every object key an entry legitimately accounts for: the one it is served from now, plus any
// it was served from before. Only the drift report needs the second half — when an entry moves
// to a content-addressed key the old object stays in the bucket on purpose, and without this it
// would be reported as an orphan. False positives are that report's designed-against failure
// mode, so the supersession is recorded rather than inferred.
function objectKeysForEntry(entry, manifestKey) {
  const keys = [storedObjectKey(entry, manifestKey)];
  const superseded = entry && entry.supersededObjectKeys;
  if (Array.isArray(superseded)) {
    for (const key of superseded) {
      if (typeof key === "string" && key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

module.exports = {
  contentAddressedKey,
  manifestRelativePath,
  storedObjectKey,
  objectKeysForEntry,
  pendingUploadFileName,
  pendingUploadsRelativeDir,
  readBaseManifest,
  readMergedManifest,
  readPendingUploads
};
