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

test("media gallery avoids repeated lookup, eager video loading and redundant card creation", () => {
  const source = adminSource();
  assert.match(source, /function isVideoPosterPath\(path\)/);
  assert.match(source, /function isMediaLibraryPath\(path\)/);
  assert.match(source, /video-posters\//);
  assert.match(source, /isMediaLibraryPath\(item\.path\)/);
  assert.match(source, /isMediaLibraryPath\(change\.path\)/);
  assert.match(source, /!isVideoPosterPath\(change\.path\)/);
  assert.match(source, /function visibleQueueChanges\(changes\)/);
  assert.match(source, /label: "Technische Video-Reparatur"/);
  assert.match(source, /async function commitMediaDiscardPlan\(videoOperations, fileChanges, message\)/);
  // Queued uploads are deduped against the already-listed items through a Set, not a scan
  // per change.
  assert.match(source, /queuedMediaItems\(changes, new Set\(published\.keys\(\)\)\)/);
  assert.match(source, /!knownPaths\.has\(change\.path\)/);
  assert.doesNotMatch(source, /!remote\.some\(\(item\) => item\.path === change\.path\)/);
  assert.match(source, /video\.preload = "none"/);
  assert.match(source, /const fragment = document\.createDocumentFragment\(\)/);
  assert.match(source, /card\.dataset\.mediaPath = item\.path/);
  assert.match(source, /card\.dataset\.mediaReferences !== nextSignature/);
  assert.match(source, /card !== insertionPoint/);
  assert.match(source, /refreshRenderedMediaMetadata\(\)/);
});

test("admin uses one German UI language layer", () => {
  const html = fs.readFileSync(path.join(__dirname, "../blog/admin/index.html"), "utf8");
  assert.match(html, /<html lang="de"/);
  assert.doesNotMatch(html, /ui-language\.js|MutationObserver/);
  assert.match(html, />Veröffentlichen</);
});

test("heavy editor and preview runtimes are loaded on demand", () => {
  const html = fs.readFileSync(path.join(__dirname, "../blog/admin/index.html"), "utf8");
  const source = adminSource();
  assert.match(html, /data-editor-src=/);
  assert.match(html, /data-markdown-src=/);
  assert.doesNotMatch(html, /<script src="\{\{ '\/admin\/vendor\/editor\/editor\.js'/);
  assert.doesNotMatch(html, /<script src="\{\{ '\/admin\/vendor\/markdown-it/);
  assert.match(source, /function loadEditorRuntime\(\)/);
  assert.match(source, /function loadPreviewRuntime\(\)/);
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
