import { buildDocument, splitDocument } from "./09-frontmatter.js";
import { tn } from "./00a-i18n.js";
import { draftRepository } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { blobShaMap, cacheBlobText, fetchMainTree, getBlobText } from "./04-drafts.js";
import { commitToDrafts, putChange, refreshChangedPaths } from "./04a-draft-writes.js";
import { fetchTree } from "./05-github-auth.js";
import { syncEditorFromVisible } from "./17-editor.js";
import { captureEditorSnapshot } from "./18-snapshots.js";
import { clearAutosave, docKeyFor, writeAutosave } from "./19-recovery.js";
import { rememberEditorInputs } from "./20-editor-fields.js";
import { collectEditorFields } from "./20a-editor-field-actions.js";
import { fileToChange, normalizeUploadedImage, prepareUploadedVideo, preparedMediaChange } from "./26-media.js";
import { refreshMedia } from "./26a-media-library.js";
import { appendFailedVideoCleanup, appendRestoredMediaPaths, removeMediaReferences, syncEditorAfterMediaRemoval } from "./26c-media-cleanup.js";
import { finishMediaJob, updateMediaProcessingState } from "./26e-media-recovery-state.js";
import { renderQueue } from "./27c-queue-render.js";

// --- Background media jobs and failure recovery ------------------------

function mediaFailureAction(items, error) {
  items.forEach((item) => state.failedMediaUploads.set(item.change.path, item));
  if (!els.mediaFailureDialog || !els.mediaFailureDialogText) return Promise.resolve("later");
  const count = items.length;
  els.mediaFailureDialogText.textContent = tn("dialog.mediaFailureBody", count, { error: error.message });
  els.mediaFailureDialog.returnValue = "later";
  return new Promise((resolve) => {
    const done = () => resolve(els.mediaFailureDialog.returnValue || "later");
    els.mediaFailureDialog.addEventListener("close", done, { once: true });
    els.mediaFailureDialog.showModal();
  });
}

function queueMediaCommit(task) {
  const previous = state.mediaCommitPromise || Promise.resolve();
  const commit = previous.catch(() => undefined).then(task);
  state.mediaCommitPromise = commit;
  const clearCommit = () => {
    if (state.mediaCommitPromise === commit) state.mediaCommitPromise = null;
  };
  commit.then(clearCommit, clearCommit);
  return commit;
}

async function discardFailedMediaUploads(items) {
  const paths = items.map((item) => preparedMediaChange(item.change).publicPath);
  const docKey = items[0]?.docKey || "";
  const currentMatches = Boolean(state.current && docKeyFor(state.current) === docKey);
  const previousBusy = state.isBusy;
  let cleanedCurrentMarkdown = null;
  let committedDocumentSha = "";
  const storedPath = docKey.split(":").slice(1).join(":");
  const candidatePaths = new Set(items
    .filter((item) => item.committed)
    .flatMap((item) => [item.trackingPath, item.change.path, preparedMediaChange(item.change).path])
    .filter(Boolean));
  setBusy(true);
  try {
    await queueMediaCommit(async () => {
      const mainMap = blobShaMap(await fetchMainTree(true));
      const draftMap = blobShaMap(await fetchTree(true));
      const entries = [];
      const expectedBlobs = {};

      appendRestoredMediaPaths(candidatePaths, draftMap, mainMap, entries, expectedBlobs);
      await appendFailedVideoCleanup(items, draftMap, mainMap, entries, expectedBlobs);

      if (storedPath && storedPath !== "__new__") {
        const documentSha = draftMap.get(storedPath) || null;
        if (documentSha) {
          let content;
          if (currentMatches) {
            syncEditorFromVisible();
            cleanedCurrentMarkdown = removeMediaReferences(state.bodyMarkdown, paths);
            content = buildDocument(
              collectEditorFields(),
              state.current.preserved || [],
              cleanedCurrentMarkdown,
              state.current.collection
            );
          } else {
            content = removeMediaReferences(await getBlobText(documentSha), paths);
          }
          const documentBlob = await draftRepository.createBlob(content);
          committedDocumentSha = documentBlob.sha;
          cacheBlobText(documentBlob.sha, {
            content,
            title: String(splitDocument(content).fields?.title || "").trim()
          });
          entries.push({ path: storedPath, mode: "100644", type: "blob", sha: documentBlob.sha });
          expectedBlobs[storedPath] = documentSha;
        }
      }

      if (entries.length) {
        await commitToDrafts(entries, "Remove failed media and document references", expectedBlobs);
        await refreshChangedPaths(entries.map((entry) => entry.path)).catch(() => {});
        if (currentMatches && state.current.path === storedPath) {
          state.current.sha = blobShaMap(state.tree).get(storedPath) || committedDocumentSha;
        }
      }
    });
  } finally {
    setBusy(previousBusy);
  }
  if (currentMatches && cleanedCurrentMarkdown !== null) {
    state.bodyMarkdown = cleanedCurrentMarkdown;
    state.editor?.setValue(cleanedCurrentMarkdown);
    captureEditorSnapshot();
    rememberEditorInputs();
    clearAutosave();
    state.autosaveSnapshot = state.savedSnapshot;
  } else if (currentMatches) {
    syncEditorAfterMediaRemoval(paths);
  }
  items.forEach((item) => {
    state.pendingMediaUploads.delete(item.trackingPath || item.change.path);
    state.pendingMediaUploads.delete(item.change.path);
    state.failedMediaUploads.delete(item.trackingPath || item.change.path);
    state.failedMediaUploads.delete(item.change.path);
    state.mediaUploadItems.delete(item.trackingPath || item.change.path);
  });
  if (currentMatches && !state.current.path) writeAutosave();
  showStatus("Fehlgeschlagene Medien wurden entfernt.");
}

function handleMediaFailure(items, error) {
  items.forEach((item) => state.failedMediaUploads.set(item.change.path, item));
  showStatus(`Upload fehlgeschlagen: ${error.message}`, "error");
  const previous = state.mediaFailureRecoveryPromise || Promise.resolve(true);
  const recovery = previous.catch(() => false).then(async () => {
    try {
      const action = await mediaFailureAction(items, error);
      if (action === "retry") await startMediaJobs(items);
      if (action === "remove") await discardFailedMediaUploads(items);
      return action !== "later";
    } catch (recoveryError) {
      showStatus(`Medium konnte nicht bereinigt werden: ${recoveryError.message}`, "error");
      return false;
    }
  });
  state.mediaFailureRecoveryPromise = recovery;
  recovery.finally(() => {
    if (state.mediaFailureRecoveryPromise === recovery) state.mediaFailureRecoveryPromise = null;
  });
  return recovery;
}

export async function resolveFailedMediaForDocument(docKey) {
  let recovered = true;
  while (state.mediaFailureRecoveryPromise) {
    const activeRecovery = state.mediaFailureRecoveryPromise;
    recovered = await activeRecovery;
    if (!recovered) return false;
    if (state.mediaFailureRecoveryPromise === activeRecovery) break;
  }
  const failed = Array.from(state.failedMediaUploads.values()).filter((item) => item.docKey === docKey);
  if (!failed.length) return true;
  return handleMediaFailure(failed, new Error("Bitte erneut versuchen oder das Medium aus dem Artikel entfernen."));
}

export function startMediaJobs(items) {
  if (!items.length) return;
  items.forEach((item) => state.failedMediaUploads.delete(item.change.path));
  state.mediaActiveJobs += 1;
  updateMediaProcessingState();
  renderQueue();

  const commit = queueMediaCommit(async () => {
    for (const item of items) {
      if (item.committed) continue;
      item.change = await fileToChange(item.file, item.change);
      await putChange(item.change);
      item.committed = true;
      state.pendingMediaUploads.delete(item.change.path);
    }
  }).catch((error) => {
    void handleMediaFailure(items.filter((item) => !item.committed), error);
  });

  const previousProcessing = state.mediaProcessingPromise || Promise.resolve();
  const processing = Promise.all([commit, previousProcessing]).then(async () => {
    const committed = items.filter((item) => item.committed);
    for (const item of committed) {
      let change = await normalizeUploadedImage(item.change, state.treeHeadSha, true);
      change = await prepareUploadedVideo(change, state.treeHeadSha);
      item.change = change;
    }
    if (committed.length) await refreshMedia(false);
    if (committed.length) showStatus(`${committed.length} Upload${committed.length === 1 ? "" : "s"} fertig.`);
    items.forEach((item) => state.mediaUploadItems.delete(item.trackingPath || item.change.path));
  }).catch((error) => {
    void handleMediaFailure(items.filter((item) => item.committed), error);
  })
    .finally(finishMediaJob);
  state.mediaProcessingPromise = processing;
  processing.finally(() => {
    if (state.mediaProcessingPromise === processing) state.mediaProcessingPromise = null;
  });
  return commit;
}
