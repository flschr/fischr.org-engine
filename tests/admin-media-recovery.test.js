const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const adminSource = require("./helpers/admin-source");

const source = adminSource();
const adminHtml = fs.readFileSync(path.join(__dirname, "../blog/admin/index.html"), "utf8");
const dialogsHtml = fs.readFileSync(path.join(__dirname, "../blog/_includes/admin/dialogs.njk"), "utf8");
const iconBundleSource = fs.readFileSync(path.join(__dirname, "../lib/eleventy/admin-icon-bundle.js"), "utf8");

test("media recovery retries unfinished raster uploads but not completed WebP files", () => {
  assert.match(
    source,
    /function needsGithubImageNormalization[\s\S]*!\["gif", "svg", "webp"\]\.includes\(extension\(change\.path\)\)/
  );
  assert.match(source, /filter\(needsGithubImageNormalization\)/);
});

test("a newly selected WebP is still normalized during its initial upload", () => {
  assert.match(source, /normalizeUploadedImage\(item\.change, state\.treeHeadSha, true\)/);
  assert.match(source, /async function normalizeUploadedImage\(change, draftSha, force = false\)/);
});

test("editor inserts the final media Markdown before reading or uploading the file", () => {
  const queueStart = source.indexOf("async function queueUploads(files, insertIntoEditor)");
  const queueEnd = source.indexOf("async function queueGpxUpload", queueStart);
  const queueUploads = source.slice(queueStart, queueEnd);

  const insertion = queueUploads.indexOf("insertMediaMarkdown(preparedMediaChange(change))");
  const startJobs = queueUploads.indexOf("startMediaJobs(pending)");
  assert.ok(insertion >= 0 && insertion < startJobs);
  assert.doesNotMatch(queueUploads, /setBusy\(true\)/);
});

test("the raw upload commit is passed to the media workflow", () => {
  assert.match(
    source,
    /const result = await draftRepository\.save\([\s\S]*await refreshChangedPaths\([\s\S]*return result\.commitSha;/
  );
  assert.match(source, /item\.change = await fileToChange\(item\.file, item\.change\);\s*await putChange\(item\.change\);\s*item\.committed = true/);
  assert.match(source, /state\.mediaCommitPromise = commit/);
  assert.match(source, /state\.mediaProcessingPromise = processing/);
  assert.match(source, /Promise\.all\(\[commit, previousProcessing\]\)/);
});

test("autosave records pending media and recovery removes references with no durable source", () => {
  assert.match(source, /pendingMedia: Array\.from\(state\.pendingMediaUploads\.values\(\)\)/);
  assert.match(source, /!treePaths\.has\(item\.sourcePath\) &&\s*\n\s*!treePaths\.has\(item\.targetPath\) &&\s*\n\s*!manifestKeys\.has\(mediaManifestKeyFor\(item\.targetPath\)\)/);
  assert.match(source, /removeMediaReferences\(saved\.content \|\| "", missingPendingPaths\)/);
});

test("R2-migrated image uploads are recognized as durable even without a drafts git blob", () => {
  assert.match(source, /async function mediaManifestKeys\(\)/);
  assert.match(source, /function mediaManifestKeyFor\(path\)/);
  assert.match(source, /const manifestKeys = await mediaManifestKeys\(\)/);
  // The keys come from the shared loader, which reads the manifest blob out of the drafts
  // tree — the previous local reader silently returned an empty set whenever the snapshot
  // had filtered the manifest out of that tree, which it always did.
  assert.match(source, /new Set\(Object\.keys\(await loadMediaManifest\(false\)\)\)/);
});

test("media failures offer retry or removal instead of permanently poisoning saves", () => {
  assert.match(dialogsHtml, /value="remove"[^>]*>Medium entfernen/);
  assert.match(dialogsHtml, /value="retry"[^>]*>Erneut versuchen/);
  assert.match(source, /if \(action === "retry"\) await startMediaJobs\(items\)/);
  assert.match(source, /if \(action === "remove"\) await discardFailedMediaUploads\(items\)/);
  assert.doesNotMatch(source, /mediaUploadError/);
  assert.match(source, /failedMediaUploads: new Map\(\)/);
  assert.doesNotMatch(source, /mediaFailureDialogPromise/);
  assert.match(source, /mediaFailureRecoveryPromise/);
  assert.match(source, /const previous = state\.mediaFailureRecoveryPromise \|\| Promise\.resolve\(true\)/);
  assert.match(source, /const candidatePaths = new Set\(items[\s\S]*item\.trackingPath[\s\S]*preparedMediaChange\(item\.change\)\.path/);
  assert.match(source, /appendRestoredMediaPaths\(candidatePaths, draftMap, mainMap, entries, expectedBlobs\)/);
  assert.match(source, /await commit;[\s\S]*shared recovery below owns retry\/removal/);
  assert.match(source, /function queueMediaCommit\(task\)/);
  assert.match(source, /await queueMediaCommit\(async \(\) =>/);
  assert.match(source, /Remove failed media and document references/);
  assert.match(source, /const documentBlob = await draftRepository\.createBlob\(content\)/);
  assert.match(source, /void handleMediaFailure\(items\.filter\(\(item\) => !item\.committed\), error\)/);
  assert.match(source, /items\.forEach\(\(item\) => state\.failedMediaUploads\.delete\(item\.change\.path\)\)/);
});

test("failed video cleanup restores its poster and metadata together with the upload", () => {
  assert.match(source, /async function appendFailedVideoCleanup\(items, draftMap, mainMap, entries, expectedBlobs\)/);
  assert.match(source, /throw new Error\(`\$\{label \|\| "Video-Metadaten"\} sind ungültig; die Bereinigung wurde zum Schutz bestehender Videos abgebrochen\.`\)/);
  assert.match(source, /if \(metadata\.poster && !repositoryPosterPath\(metadata\.poster\)\)/);
  assert.match(source, /repositoryPosterPath\(draftMetadata\[videoPath\]\?\.poster\)/);
  assert.doesNotMatch(source, /repositoryPosterPath\(videoPosterPath\(videoPath\)\)/);
  assert.match(source, /if \(Object\.hasOwn\(mainMetadata, videoPath\)\) nextMetadata\[videoPath\] = mainMetadata\[videoPath\]/);
  assert.match(source, /else delete nextMetadata\[videoPath\]/);
  assert.match(source, /appendRestoredMediaPaths\(posterPaths, draftMap, mainMap, entries, expectedBlobs\)/);
  assert.match(source, /await appendFailedVideoCleanup\(items, draftMap, mainMap, entries, expectedBlobs\)/);
  assert.match(source, /const draftMap = blobShaMap\(await fetchTree\(true\)\)/);
  assert.match(source, /const mainMap = blobShaMap\(await fetchMainTree\(true\)\)/);
  assert.match(source, /const mainPoster = repositoryPosterPath\(mainMetadata\[videoPath\]\?\.poster\)/);
  assert.match(source, /refreshChangedPaths\(entries\.map\(\(entry\) => entry\.path\)\)\.catch\(\(\) => \{\}\)/);
  assert.match(source, /state\.current\.sha = blobShaMap\(state\.tree\)\.get\(storedPath\) \|\| committedDocumentSha/);
  assert.match(source, /if \(!tree\) \{\s*state\.tree = null;\s*state\.treeHeadSha = "";\s*state\.treeParentHeadSha = "";/);
  assert.match(source, /change\.sha = result\.blobSha/);
  assert.match(source, /state\.current\.sha = blobShaMap\(state\.tree\)\.get\(path\) \|\| savedChange\.sha/);
});

test("foreground uploads and startup recovery share one derived processing state", () => {
  assert.match(source, /state\.mediaProcessing = state\.mediaActiveJobs \+ state\.mediaRecoveryJobs > 0/);
  assert.match(source, /if \(state\.mediaRecoveryPromise\) return state\.mediaRecoveryPromise/);
  assert.match(source, /state\.mediaRecoveryPromise = recovery/);
  assert.match(source, /if \(state\.mediaRecoveryPromise === recovery\) state\.mediaRecoveryPromise = null/);
  assert.match(source, /state\.mediaRecoveryJobs \+= 1;\s*updateMediaProcessingState\(\)/);
  assert.match(source, /state\.mediaRecoveryJobs = Math\.max\(0, state\.mediaRecoveryJobs - 1\);\s*updateMediaProcessingState\(\)/);
});

test("unfinished media blocks publishing and destructive queue actions", () => {
  // Der Weg in die Warteschlange gehört nicht zu den gesperrten Aktionen: #syncButton öffnet
  // nur die Ansicht. Gesperrt wird ausschliesslich, was schreibt.
  assert.match(source, /els\.syncButton\.disabled = false;/);
  assert.doesNotMatch(source, /els\.syncButton\.disabled = (?!false;)/);
  // Offen ist nur der Weg dorthin: Das Neuladen der Warteschlange verwirft die Baum-Caches und
  // hält sich deshalb aus einem laufenden Schreibvorgang heraus.
  assert.match(source, /async function refreshQueueFromGitHub\(\) \{[\s\S]{0,600}?if \(state\.isBusy\) return;/);
  assert.match(source, /function hasActiveMediaWork\(\) \{\s*return state\.mediaProcessing/);
  assert.match(
    source,
    /els\.pushButton\.disabled = changes\.length === 0 \|\| publishLocked \|\| mediaProcessing \|\| !hasGithubAccess\(\)/
  );
  assert.match(source, /els\.discardAllButton\.disabled = changes\.length === 0 \|\| publishLocked \|\| mediaProcessing/);
  assert.match(source, /els\.cleanupOrphansButton\.disabled = orphanCount === 0 \|\| publishLocked \|\| mediaProcessing/);
  assert.match(source, /discard\.disabled = publishLocked \|\| mediaProcessing/);
  assert.match(source, /deleteButton\.disabled = hasActiveMediaWork\(\)/);
  assert.match(source, /await waitForMediaCommits\(\);\s*if \(!guardMediaIdle\(t\("action\.deletingThis"\)\)\) return/);
  assert.match(source, /async function hasUnfinishedMediaProcessing\(changes = \[\]\)/);
  assert.match(source, /if \(hasActiveMediaWork\(\) \|\| hasPendingMediaProcessing\(changes\)\) return true/);
  assert.match(source, /if \(await videoNeedsPreparation\(change\)\) return true/);
  assert.match(source, /function guardMediaIdle\(action = t\("action\.thisAction"\)\) \{\s*if \(!hasActiveMediaWork\(\)\) return true/);
  assert.match(source, /async function guardMediaReadyForPublish\(changes\)/);
  assert.match(source, /if \(!await guardMediaReadyForPublish\(reisendeAenderungen\)\)/);
  assert.match(source, /if \(!guardMediaIdle\(t\("action\.discardingAllChanges"\)\)\) return/);
  assert.match(source, /async function loadFreshChanges\(\)[\s\S]*fetchTree\(true\)[\s\S]*fetchMainTree\(true\)/);
  assert.match(source, /state\.treeHeadSha !== confirmedDraftHead \|\| changeSetSignature\(confirmedChanges\) !== confirmedChangeSet/);
  assert.match(source, /state\.treeHeadSha !== confirmedDraftHead \|\| changeSetSignature\(confirmedOrphans\) !== confirmedOrphanSet/);
  assert.match(source, /const confirmedChanges = await loadFreshChanges\(\);\s*if \(!guardMediaIdle\(t\("action\.discardingThis"\)\)\) return/);
  assert.match(source, /changeSignature\(confirmedChange\) !== changeSignature\(change\)/);
  assert.match(source, /if \(els\.statusBar\.textContent === expectedRecoveryStatus\)/);
  assert.match(source, /if \(state\.view === "media"\) \{\s*renderMedia\(\);\s*try \{\s*await refreshMedia\(false\)/);
  assert.match(source, /Mediathek konnte nach der Verarbeitung nicht aktualisiert werden/);
});

test("GPX uploads use their own managed directory and insert Markdown", () => {
  assert.match(source, /gpxDir: "blog\/assets\/files\/gpx"/);
  assert.match(source, /function gpxMarkdown[\s\S]*!gpx\(\$\{values\.src/);
  assert.match(source, /await putChange\(change\);\s*insertGpxMarkdown\(change\.publicPath\);/);
  assert.match(source, /gpxUploadService\.prepare\(file\)/);
  assert.match(source, /const isGpx = path\.startsWith\(`\$\{collections\.media\.gpxDir\}\/`\) && isGpxPath\(path\)/);
});

test("the GPX toolbar icon is bundled and receives an automatic asset fingerprint", () => {
  assert.match(iconBundleSource, /"route"/);
  assert.match(adminHtml, /'\/admin\/vendor\/icons\/icons\.js' \| adminAssetUrl/);
});
