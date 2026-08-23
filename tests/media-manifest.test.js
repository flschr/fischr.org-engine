const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  contentAddressedKey,
  storedObjectKey,
  objectKeysForEntry,
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

// --- content-addressed object keys ---------------------------------------------------------

test("an entry without an objectKey is served from its manifest key, for good", () => {
  // Every upload from before the scheme changed. Their addresses are baked into published feed
  // items, syndicated posts and roughly 1,400 absolute URLs across the archive, so the fallback
  // is not a transition state — it is the permanent answer for those entries.
  assert.equal(storedObjectKey({ sha256: "abc" }, "images/uploads/old.webp"), "images/uploads/old.webp");
  assert.equal(storedObjectKey(undefined, "images/uploads/old.webp"), "images/uploads/old.webp");
  assert.equal(storedObjectKey({ objectKey: "" }, "images/uploads/old.webp"), "images/uploads/old.webp");
});

test("an entry with an objectKey is served from it, not from its manifest key", () => {
  const entry = { objectKey: "cas/ab/abc.webp" };
  assert.equal(storedObjectKey(entry, "images/uploads/new.webp"), "cas/ab/abc.webp");
});

test("a content address is derived from the content, keeping the extension and sharding by prefix", () => {
  const sha = "3ec14d4973d88a527811817f8bd64ae9ee4d5e6e10a39220cc551dc1a5fe0464";
  assert.equal(contentAddressedKey("images/uploads/photo.webp", sha), `cas/3e/${sha}.webp`);
  // Case is normalized, so the same bytes never land under two addresses.
  assert.equal(contentAddressedKey("images/uploads/PHOTO.WEBP", sha), `cas/3e/${sha}.webp`);
  // A dot in a directory name is not an extension.
  assert.equal(contentAddressedKey("images/v1.2/photo", sha), `cas/3e/${sha}`);
  assert.equal(contentAddressedKey("noextension", sha), `cas/3e/${sha}`);
});

test("an entry accounts for the object it superseded, so the old one is not an orphan", () => {
  const entry = { objectKey: "cas/ab/abc.webp", supersededObjectKeys: ["images/uploads/old.webp"] };
  assert.deepEqual(objectKeysForEntry(entry, "images/uploads/old.webp"), [
    "cas/ab/abc.webp",
    "images/uploads/old.webp"
  ]);
  // A legacy entry accounts for exactly one object, and never lists it twice.
  assert.deepEqual(objectKeysForEntry({}, "images/uploads/old.webp"), ["images/uploads/old.webp"]);
});

// functions/api/admin/media/normalize.js cannot import lib/media-manifest.js — it is ESM on
// Workers, this is CommonJS — so the derivation is written out twice. That is precisely the
// situation the project rule asks for a parity test rather than trust: a change to either copy
// has to fail here instead of drifting until two upload paths disagree about an address.
test("the Workers endpoint derives the same content address as the shared module", async () => {
  const endpoint = await import("../functions/api/admin/media/normalize.js");
  const cases = [
    ["images/uploads/photo.webp", "3ec14d4973d88a527811817f8bd64ae9ee4d5e6e10a39220cc551dc1a5fe0464"],
    ["images/uploads/PHOTO.WEBP", "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"],
    ["videos/uploads/clip.mp4", "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100"],
    ["images/v1.2/photo", "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"],
    ["noextension", "1111111111111111111111111111111111111111111111111111111111111111"]
  ];

  for (const [key, sha] of cases) {
    assert.equal(endpoint.contentAddressedKey(key, sha), contentAddressedKey(key, sha), key);
  }
});
