import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { loadChanges } from "./04a-draft-writes.js";
import { hasGithubAccess } from "./05-github-auth.js";
import { openPublishDialog } from "./13-publish-dialog.js";
import { editorIsDirty } from "./19-recovery.js";
import { askUnpublishAction } from "./19a-editor-dialogs.js";
import { renderEditorMetaLine } from "./20-editor-fields.js";
import { publishAffordance } from "./20c-publish-affordance.js";
import { queueCurrent } from "./25a-entry-actions.js";
import { syncOutbox } from "./27b-publish-actions.js";

// --- Editor publish actions --------------------------------------------

function toggleCurrentPublishState() {
  return saveWithProgress(els.draftInput.checked ? "publish" : "draft");
}

export async function saveWithProgress(mode, { offerSync = false } = {}) {
  // Only sending publishes. Saving always just writes to `drafts`, whatever the
  // article's public state is.
  //
  // The alternative — publishing on every save of an already-public article —
  // was tried and rejected: since the publish runs as a real Actions build,
  // and all production deploys share one non-cancelling concurrency group,
  // five saves while writing become five builds queued behind each other, the
  // last landing minutes later. The intent to update the public site is worth
  // one deliberate button, and that button is Senden.
  //
  // `offerSync` carries the one non-send case: unpublishing, which is already
  // its own confirmed action behind the "⋯" menu.
  const shouldSync = offerSync || mode === "publish";
  els.saveDialog.classList.remove("is-done", "is-error");
  els.saveDialogText.textContent = mode === "publish" ? "Veröffentlichung wird vorgemerkt …" : "Wird gespeichert …";
  if (!els.saveDialog.open) els.saveDialog.showModal();
  try {
    const ok = await queueCurrent(mode);
    if (ok) {
      renderEditorMetaLine();
      els.saveDialog.classList.add("is-done");
      els.saveDialogText.textContent = "In GitHub gespeichert";
      if (shouldSync) {
        if (els.saveDialog.open) els.saveDialog.close();
        await syncAfterSave();
      } else {
        window.setTimeout(() => { if (els.saveDialog.open) els.saveDialog.close(); }, 650);
      }
    } else if (els.saveDialog.open) {
      els.saveDialog.close();
    }
    return ok;
  } catch (error) {
    els.saveDialog.classList.add("is-error");
    els.saveDialogText.textContent = `Fehlgeschlagen: ${error.message}`;
    window.setTimeout(() => { if (els.saveDialog.open) els.saveDialog.close(); }, 2600);
    return false;
  }
}

// Publishes straight away. There used to be a dialog here asking whether to
// sync now — it stood between "I saved" and "it is live" on every single save,
// and the answer was always yes. Editing several posts and publishing them
// together is still possible: that is what the queue view is for.
async function syncAfterSave() {
  if (state.publishInFlight || !hasGithubAccess()) return;
  let changes = Array.from(state.changes.values());
  try {
    changes = await loadChanges();
  } catch (error) {
    if (!changes.length) {
      showStatus(`Synchronisierungsprüfung fehlgeschlagen: ${error.message}`, "error");
      return;
    }
  }
  if (!changes.length) return;
  await syncOutbox();
}

export async function handleCurrentPublishAction() {
  if (state.current?.collection !== "posts") {
    await toggleCurrentPublishState();
    return;
  }
  const action = currentPublishAction();
  if (action === "publish") {
    openPublishDialog();
    return;
  }
  if (editorIsDirty()) await saveWithProgress("publish");
  else await syncAfterSave();
}

// The send button only ever sends. Taking an article back off the site is a
// rare, opposite intent and lives behind the top bar's "⋯" — a single button
// that silently turned into its own inverse was the reason the bar needed a
// four-way label lookup to explain itself.
//
// Both what the button does and whether it is there at all come out of the same
// call, so the bar cannot show a button whose action is null.
export function currentPublishState() {
  const published = Boolean(state.current?.published);
  const hasQueuedChange = currentEntryHasQueuedChange();
  // editorIsDirty() serialises the whole document and every field to compare
  // snapshots. It is only ever asked when its answer can change the outcome —
  // an unpublished article offers the button regardless, and a published one
  // with a change already queued does too.
  const editorDirty = published && !hasQueuedChange ? editorIsDirty() : false;
  return publishAffordance({
    collection: state.current?.collection,
    published,
    draftIntent: els.draftInput.checked,
    hasQueuedChange,
    editorDirty,
    sourceMode: Boolean(state.current?.sourceMode)
  });
}

// A queued change can sit under either name: renaming an article writes the new
// path and removes the old one, and the article on screen may be either side of
// that. Both count as "there is something to send".
export function currentEntryHasQueuedChange() {
  const paths = [state.current?.path, state.current?.publishedPath].filter(Boolean);
  return paths.some((path) => state.changes.has(path));
}

export function currentPublishAction() {
  return currentPublishState().action;
}

export async function unpublishCurrentPost() {
  if (state.current?.collection !== "posts" || !state.current.published) return;
  const confirmed = await askUnpublishAction();
  if (!confirmed) return;
  await saveWithProgress("draft", { offerSync: true });
}
