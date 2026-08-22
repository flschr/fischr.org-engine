const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const adminSource = require("./helpers/admin-source");

test("draft saves update only affected queue paths", () => {
  const source = adminSource();
  assert.match(source, /async function refreshChangedPaths\(paths\)/);
  assert.match(source, /await refreshChangedPaths\(result\.entries\.map/);
  assert.doesNotMatch(source, /draftRepository\.save\([\s\S]{0,1000}await loadChanges\(/);
});

test("every draft mutation carries an expected blob precondition", () => {
  const source = adminSource();
  assert.match(source, /expectedBlobs: change\.expectedBlobs \|\| \{ \[change\.path\]: change\.sha \|\| null \}/);
  assert.match(source, /commitToDrafts\([\s\S]{0,300}\{ \[change\.path\]: change\.expectedSha \|\| change\.sha \|\| null \}/);
  assert.match(source, /async function deleteChange\(path, expectedSha\)/);
});

test("media references start from the precomputed production index", () => {
  const source = adminSource();
  assert.match(source, /const indexData = await loadPublishedPostsIndex\(\)/);
  assert.match(source, /if \(state\.mediaReferenceSignature === signature\) return state\.mediaReferenceIndex/);
});

test("the media gallery dedupes queued uploads by lookup, not by scanning", () => {
  // Rendering — two cards instead of three, preload="none", stable card identity — is proven for
  // real in tests/browser/admin-media.spec.js. What no behavioural test can show is the shape of
  // the lookup: with a handful of files an O(n2) scan passes every assertion the browser can make.
  const source = adminSource();
  assert.match(source, /queuedMediaItems\(changes, new Set\(published\.keys\(\)\)\)/);
  assert.match(source, /!knownPaths\.has\(change\.path\)/);
  assert.doesNotMatch(source, /!remote\.some\(\(item\) => item\.path === change\.path\)/);
});

test("admin uses one German UI language layer", () => {
  const html = fs.readFileSync(path.join(__dirname, "../blog/admin/index.html"), "utf8");
  assert.match(html, /<html lang="de"/);
  assert.doesNotMatch(html, /ui-language\.js|MutationObserver/);
  assert.match(html, />Veröffentlichen</);
});

test("startup and resume reuse in-flight data work", () => {
  const source = adminSource();
  assert.match(source, /await loadAdminSnapshot\(\)/);
  assert.match(source, /ADMIN_SNAPSHOT_TIMEOUT_MS = 8000/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /if \(state\.refreshPromise\) return state\.refreshPromise/);
  assert.match(source, /if \(state\.statsPromises\.has\(days\)\) return state\.statsPromises\.get\(days\)/);
});

test("runtime retries and immutable blob caches stay bounded", () => {
  const source = adminSource();
  assert.match(source, /existing\?\.remove\(\)/);
  assert.match(source, /script\.remove\(\)/);
  assert.match(source, /BLOB_TEXT_CACHE_LIMIT = 500/);
  assert.match(source, /while \(blobTextCache\.size > BLOB_TEXT_CACHE_LIMIT\)/);
});
