const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  pendingUploadFileName,
  pendingUploadsRelativeDir,
  readBaseManifest,
  readMergedManifest,
  readPendingUploads
} = require("../lib/media-manifest");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-media-manifest-"));
  fs.mkdirSync(path.join(root, "automation"), { recursive: true });
  return root;
}

function writeManifest(root, manifest) {
  fs.writeFileSync(path.join(root, "automation/media-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeRecord(root, key, entry) {
  const dir = path.join(root, pendingUploadsRelativeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, pendingUploadFileName(key)), `${JSON.stringify({ key, entry }, null, 2)}\n`);
}

const entry = (sha256) => ({ sourcePath: "blog/assets/images/uploads/a.webp", sha256, size: 10, contentType: "image/webp" });

test("a missing manifest and a missing uploads directory are both empty, not an error", () => {
  const root = fixture();
  assert.deepEqual(readBaseManifest(root), {});
  assert.deepEqual(readPendingUploads(root), {});
  assert.deepEqual(readMergedManifest(root), {});
});

test("pending upload records merge into the committed manifest", () => {
  const root = fixture();
  writeManifest(root, { "images/uploads/old.webp": entry("aaa") });
  writeRecord(root, "images/uploads/new.webp", entry("bbb"));

  assert.deepEqual(Object.keys(readMergedManifest(root)).sort(), [
    "images/uploads/new.webp",
    "images/uploads/old.webp"
  ]);
  // The committed manifest on its own must not see the pending record — compaction relies on
  // that separation to know what still needs folding.
  assert.deepEqual(Object.keys(readBaseManifest(root)), ["images/uploads/old.webp"]);
});

test("a pending record wins over a committed entry for the same key", () => {
  const root = fixture();
  writeManifest(root, { "images/uploads/a.webp": entry("stale") });
  writeRecord(root, "images/uploads/a.webp", entry("fresh"));

  assert.equal(readMergedManifest(root)["images/uploads/a.webp"].sha256, "fresh");
});

test("the object key survives the filename round trip through sanitizing", () => {
  const root = fixture();
  const key = "images/uploads/2026-08-22-a_b.c-1.webp";
  writeRecord(root, key, entry("ccc"));

  assert.equal(pendingUploadFileName(key), "images__uploads__2026-08-22-a_b.c-1.webp.json");
  assert.deepEqual(Object.keys(readPendingUploads(root)), [key]);
});

test("non-JSON files in the uploads directory are ignored", () => {
  const root = fixture();
  const dir = path.join(root, pendingUploadsRelativeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# not a record\n");
  writeRecord(root, "images/uploads/a.webp", entry("aaa"));

  assert.deepEqual(Object.keys(readPendingUploads(root)), ["images/uploads/a.webp"]);
});

// A silently dropped record means the reference falls back to a /assets/... path that no
// longer exists in Git since DB-1129 — the image 404s and loses its responsive variants.
// Both readers must fail loudly instead.
test("a malformed upload record fails the read instead of being skipped", () => {
  const root = fixture();
  const dir = path.join(root, pendingUploadsRelativeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");

  assert.throws(() => readPendingUploads(root), /broken\.json is not valid JSON/);
});

test("an upload record without a key or entry fails the read", () => {
  const root = fixture();
  const dir = path.join(root, pendingUploadsRelativeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "shapeless.json"), JSON.stringify({ sha256: "aaa" }));

  assert.throws(() => readPendingUploads(root), /is not a \{ key, entry \} upload record/);
});

test("a corrupt committed manifest fails the read instead of resolving to no media", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "automation/media-manifest.json"), "{ truncated");

  assert.throws(() => readBaseManifest(root), /media-manifest\.json is not valid JSON/);
});

// The fold is "write the merged manifest, then delete the records". Both halves have to
// happen, and in that order: deleting first loses the uploads, folding without deleting
// resurrects them on the next build.
test("compaction folds every record into the manifest and removes only the records", () => {
  const root = fixture();
  writeManifest(root, { "images/uploads/old.webp": entry("aaa") });
  writeRecord(root, "images/uploads/new-a.webp", entry("bbb"));
  writeRecord(root, "images/uploads/new-b.webp", entry("ccc"));
  fs.writeFileSync(path.join(root, pendingUploadsRelativeDir, "README.md"), "# keeps the directory\n");

  const script = `
    const { loadManifest, removePendingUploads, saveManifest } = require(${JSON.stringify(path.join(__dirname, "../scripts/lib/r2-media"))});
    saveManifest(loadManifest());
    process.stdout.write(JSON.stringify(removePendingUploads()));
  `;
  const removed = JSON.parse(require("node:child_process").execFileSync(
    process.execPath, ["-e", script], { cwd: root, encoding: "utf8" }
  ));

  assert.deepEqual(Object.keys(readBaseManifest(root)).sort(), [
    "images/uploads/new-a.webp",
    "images/uploads/new-b.webp",
    "images/uploads/old.webp"
  ]);
  assert.deepEqual(readPendingUploads(root), {});
  assert.deepEqual(removed.sort(), [
    `${pendingUploadsRelativeDir}/images__uploads__new-a.webp.json`,
    `${pendingUploadsRelativeDir}/images__uploads__new-b.webp.json`
  ]);
  // The directory itself must survive, or the workflows' `git add -A` loses its pathspec.
  assert.ok(fs.existsSync(path.join(root, pendingUploadsRelativeDir, "README.md")));
});

test("compaction is a no-op when there is nothing pending", () => {
  const root = fixture();
  writeManifest(root, { "images/uploads/old.webp": entry("aaa") });

  const script = `
    const { loadManifest, removePendingUploads, saveManifest } = require(${JSON.stringify(path.join(__dirname, "../scripts/lib/r2-media"))});
    saveManifest(loadManifest());
    process.stdout.write(JSON.stringify(removePendingUploads()));
  `;
  const removed = JSON.parse(require("node:child_process").execFileSync(
    process.execPath, ["-e", script], { cwd: root, encoding: "utf8" }
  ));

  assert.deepEqual(removed, []);
  assert.deepEqual(Object.keys(readBaseManifest(root)), ["images/uploads/old.webp"]);
});
