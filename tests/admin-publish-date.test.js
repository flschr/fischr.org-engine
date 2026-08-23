const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const readAdminSource = require("./helpers/admin-source");

function extractBlock(source, anchor) {
  const anchorIndex = source.indexOf(anchor);
  assert.notEqual(anchorIndex, -1, `Missing anchor: ${anchor}`);

  // Hinter dem Anker suchen, nicht ab seinem Anfang: bei einem destrukturierten Parameter
  // (`function f({ a, b })`) läge die erste Klammer sonst im Anker selbst, und der Test
  // prüfte die Parameterliste statt des Rumpfs — grün, aber ohne Aussage.
  const blockStart = source.indexOf("{", anchorIndex + anchor.length);
  assert.notEqual(blockStart, -1, `Missing block for anchor: ${anchor}`);

  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) return source.slice(blockStart + 1, index);
  }

  throw new Error(`Unclosed block for anchor: ${anchor}`);
}

function adminSource() {
  return readAdminSource();
}

test("admin publish preserves the selected post date", () => {
  const source = adminSource();
  const queueCurrent = extractBlock(source, "async function queueCurrent(mode)");
  const publishBlock = extractBlock(queueCurrent, 'if (mode === "publish")');

  assert.match(publishBlock, /fields\.draft\s*=\s*false/);
  assert.doesNotMatch(publishBlock, /\bfields\.date\s*=/);
  assert.doesNotMatch(publishBlock, /\bels\.dateInput\.value\s*=/);
});

test("admin publish and unpublish only toggle draft state", () => {
  const source = adminSource();
  const queueCurrent = extractBlock(source, "async function queueCurrent(mode)");
  const draftBlock = extractBlock(queueCurrent, 'if (mode === "draft")');
  const publishBlock = extractBlock(queueCurrent, 'if (mode === "publish")');

  for (const block of [draftBlock, publishBlock]) {
    assert.doesNotMatch(block, /\bfields\.(date|slug|tags|social_image|permalink)\s*=/);
    assert.doesNotMatch(block, /\bels\.(dateInput|slugInput|tagsInput|socialImageInput|permalinkInput)\.value\s*=/);
  }
});

test("saving a published article offers to sync the queued changes", () => {
  const source = adminSource();

  assert.match(source, /async function saveWithProgress\(mode,[\s\S]*?const wasPublished = state\.current\?\.collection === "posts" && Boolean\(state\.current\.published\)/);
  assert.match(source, /const shouldOfferSync = [^;]*mode === "save" && wasPublished/);
  assert.match(source, /if \(shouldOfferSync\)[\s\S]*?await maybeOfferSyncAfterSave/);
  assert.match(source, /savesUnpublish = mode !== "publish" && wasPublished && els\.draftInput\.checked/);
  assert.match(source, /savesUnpublish \? "unpublish"/);
  assert.match(source, /effectiveSyncAction === "unpublish"[\s\S]*state\.current\.unpublishQueued = true/);
});

test("unused media cleanup uses the loaded change set", () => {
  const source = adminSource();
  const cleanup = extractBlock(source, "async function discardUnusedMedia()");
  assert.match(cleanup, /const changes = await loadChanges\(\)/);
  assert.doesNotMatch(cleanup, /RWPublishPlan\.plan\(changes\)/);
});

test("a published post has a dedicated confirmed unpublish action", () => {
  const source = adminSource();
  const renderMeta = extractBlock(source, "function renderEditorMetaLine()");
  const unpublish = extractBlock(source, "async function unpublishCurrentPost()");

  assert.match(renderMeta, /const published = Boolean\(state\.current\.published\)/);
  assert.match(renderMeta, /unpublishAction \? ICON\.unpublish : ICON\.send/);
  assert.match(source, /icon\("eye-off"\)/);
  assert.match(source, /els\.publishButton\.addEventListener\("click", handleCurrentPublishAction\)/);
  assert.match(source, /if \(action === "unpublish"\)[\s\S]*await unpublishCurrentPost\(\)/);
  assert.match(source, /if \(action === "sync-unpublish"\)[\s\S]*await maybeOfferSyncAfterSave\("unpublish"\)/);
  assert.match(unpublish, /await askUnpublishAction\(\)/);
  assert.match(unpublish, /saveWithProgress\("draft", \{ offerSync: true, syncAction: "unpublish" \}\)/);
});

test("public state comes from the published main document, not the draft checkbox", () => {
  const source = adminSource();

  assert.match(source, /async function postPublicationOnMain[\s\S]*fetchMainTree\(false\)/);
  assert.match(source, /async function publishedMainPost[\s\S]*getBlobText\(mainSha\)/);
  assert.match(source, /if \(fields\.draft\) return null/);
  assert.match(source, /published: false/);
});

test("a queued rename retains its actual public origin", () => {
  const source = adminSource();

  assert.match(source, /prepareRenameOriginChange\(path, state\.current\.publishedPath \|\| previousPath, previousPath\)/);
  assert.match(source, /additionalEntries: renameOrigin \? \[renameOrigin\.entry\] : \[\]/);
  assert.match(source, /loadRenameOriginsFromDrafts\(\)/);
  assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem)\(renameOriginsKey/);
  assert.match(source, /change\.kind === "delete" && change\.collection === "posts"/);
  assert.match(source, /change\.path === originPath/);
  assert.doesNotMatch(source, /String\(item\.fields\.date \|\| ""\) === draftDate/);
  assert.match(source, /publishedPath: publication\.path/);
  assert.match(source, /publishedPath: state\.current\.publishedPath \|\| ""/);
  assert.match(source, /publishedPath: saved\.publishedPath \|\| current\.publishedPath \|\| ""/);
});

test("rename metadata stays internal and publish intent stays out of the DOM", () => {
  const source = adminSource();

  assert.doesNotMatch(extractBlock(source, "function isManagedPath(path)"), /renameOriginsPath/);
  assert.match(extractBlock(source, "async function refreshChangedPaths(paths)"), /if \(!isManagedPath\(path\)\)/);
  assert.match(source, /async function preparePrunedRenameOriginsChange/);
  assert.match(source, /draftMap\.has\(targetPath\) && !draftMap\.has\(originPath\) && mainMap\.has\(originPath\)/);
  assert.match(extractBlock(source, "async function deleteChange(path, expectedSha)"), /preparePrunedRenameOriginsChange\(\[entry\]\)/);
  assert.match(source, /draftTouched: false/);
  assert.match(source, /state\.current\.draftTouched = true/);
  assert.match(source, /const draftWasTouched = Boolean\(state\.current\?\.draftTouched\)/);
  assert.doesNotMatch(source, /dataset\.draftTouched/);
});

test("admin publish offers alt-text generation without making it mandatory", () => {
  const source = adminSource();
  const confirmPublish = extractBlock(source, "async function confirmPublishDialog()");

  assert.match(confirmPublish, /findMarkdownImages\(state\.bodyMarkdown\)/);
  assert.match(confirmPublish, /!markdownAltHasText\(image\.alt\)/);
  assert.match(confirmPublish, /await askMissingAltTextAction\(missingAltTexts\.length\)/);
  assert.match(confirmPublish, /if \(generate\)\s*\{\s*await generateMissingAltTexts\(\);\s*return;/);
  assert.match(confirmPublish, /await saveWithProgress\("publish"\)/);
});

test("admin field collection does not mutate auto-generated slug", () => {
  const source = adminSource();
  const collectEditorFields = extractBlock(source, "function collectEditorFields()");

  assert.doesNotMatch(collectEditorFields, /syncAutoSlug\(\)/);
  // Editing the slug turns off auto-slug; it may also sanitize the input live.
  assert.match(source, /els\.slugInput\.addEventListener\("input", \(\) => \{\s*state\.autoSlug = false;/);
});

// Was gesendet wird, muss der Stand sein, den jemand geprüft hat — nicht einer, der beim Senden
// gerade aktuell ist. Die Form hat sich geändert (der Admin startet über den eigenen Endpunkt
// statt selbst zu dispatchen), die Bedingung nicht.
test("immediate admin sync sends the exact reviewed commits, not whatever is current", () => {
  const source = adminSource();
  const syncOutbox = extractBlock(source, "async function syncOutbox()");

  assert.match(syncOutbox, /const draftsHead = state\.tree && state\.treeHeadSha\s*\? state\.treeHeadSha/);
  assert.match(syncOutbox, /const mainHead = state\.mainTree && state\.mainTreeHeadSha\s*\? state\.mainTreeHeadSha/);
  assert.match(syncOutbox, /starteVeroeffentlichung\(\{ requestId, mainHead, draftsHead, changeCount: changes\.length \}\)/);

  // Und der Start geht an den eigenen Endpunkt, nicht mehr per Dispatch aus dem Browser.
  const starter = extractBlock(source, "async function starteVeroeffentlichung({ requestId, mainHead, draftsHead, changeCount })");
  assert.match(starter, /fetch\("\/api\/admin\/publish"/);
  assert.match(starter, /mainSha: mainHead/);
  assert.match(starter, /draftSha: draftsHead/);
  assert.doesNotMatch(source, /actions\/workflows\/admin-publish\.yml\/dispatches/);
});

test("admin restores an in-flight publish after reload", () => {
  const source = adminSource();
  assert.match(source, /RWPublishService\.persistRequest\(localStorage, publishRequestKey/);
  assert.match(source, /async function resumePublish\(\)/);
  assert.match(source, /discoverActiveRequest\(github, repo\.publishBranch\)/);
  assert.match(source, /RWPublishService\.fetchStatus/);
  assert.match(source, /RWPublishService\.poll/);
});

test("admin forgets a completed failed publish after showing it", () => {
  const source = adminSource();
  const refreshRequest = extractBlock(source, "async function refreshPublishRequest(request, signal)");
  const failedBlock = extractBlock(refreshRequest, 'if (status.state === "failed")');

  assert.match(failedBlock, /RWPublishService\.clearRequest\(localStorage, publishRequestKey\)/);
  assert.match(failedBlock, /state\.publishRequest\s*=\s*null/);
  assert.match(failedBlock, /showStatus\(status\.message, "error"\)/);
});
