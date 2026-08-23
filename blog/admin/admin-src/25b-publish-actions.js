import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { loadChanges } from "./04a-draft-writes.js";
import { hasGithubAccess } from "./05-github-auth.js";
import { openPublishDialog } from "./13-publish-dialog.js";
import { editorIsDirty } from "./19-recovery.js";
import { askSyncNowAction, askUnpublishAction } from "./19a-editor-dialogs.js";
import { renderEditorMetaLine } from "./20-editor-fields.js";
import { queueCurrent } from "./25a-entry-actions.js";
import { syncOutbox } from "./27b-publish-actions.js";

// --- Editor publish actions --------------------------------------------

function toggleCurrentPublishState() {
  return saveWithProgress(els.draftInput.checked ? "publish" : "draft");
}

export async function saveWithProgress(mode, { offerSync = false, syncAction = "update" } = {}) {
  const wasPublished = state.current?.collection === "posts" && Boolean(state.current.published);
  const savesUnpublish = mode !== "publish" && wasPublished && els.draftInput.checked;
  const savesPublish = mode !== "draft" && !wasPublished && !els.draftInput.checked;
  const effectiveSyncAction = syncAction === "update"
    ? (savesUnpublish ? "unpublish" : savesPublish ? "publish" : "update")
    : syncAction;
  const shouldOfferSync = offerSync || mode === "publish" || savesPublish || (mode === "save" && wasPublished);
  els.saveDialog.classList.remove("is-done", "is-error");
  els.saveDialogText.textContent = mode === "publish" ? "Veröffentlichung wird vorgemerkt …" : "Wird gespeichert …";
  if (!els.saveDialog.open) els.saveDialog.showModal();
  try {
    const ok = await queueCurrent(mode);
    if (ok) {
      if (effectiveSyncAction === "unpublish") {
        state.current.unpublishQueued = true;
        renderEditorMetaLine();
      }
      els.saveDialog.classList.add("is-done");
      els.saveDialogText.textContent = "In GitHub gespeichert";
      if (shouldOfferSync) {
        if (els.saveDialog.open) els.saveDialog.close();
        await maybeOfferSyncAfterSave(mode === "publish" ? "publish" : effectiveSyncAction);
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

async function maybeOfferSyncAfterSave(action = "update") {
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
  const syncNow = await askSyncNowAction(changes.length, action);
  if (syncNow) await syncOutbox();
}

export async function handleCurrentPublishAction() {
  if (state.current?.collection !== "posts") {
    await toggleCurrentPublishState();
    return;
  }
  const action = currentPublishAction();
  if (action === "sync-unpublish") {
    await maybeOfferSyncAfterSave("unpublish");
    return;
  }
  if (action === "unpublish") {
    await unpublishCurrentPost();
    return;
  }
  if (action === "publish") {
    openPublishDialog();
    return;
  }
  if (editorIsDirty()) await saveWithProgress("publish");
  else await maybeOfferSyncAfterSave("publish");
}

export function currentPublishAction() {
  const published = state.current?.collection === "posts" && Boolean(state.current.published);
  const draftIntent = els.draftInput.checked;
  const draftWasTouched = Boolean(state.current?.draftTouched);
  if (published) return draftIntent && state.current.unpublishQueued && !draftWasTouched ? "sync-unpublish" : "unpublish";
  return draftIntent ? "publish" : "sync-publish";
}

async function unpublishCurrentPost() {
  if (state.current?.collection !== "posts" || !state.current.published) return;
  const confirmed = await askUnpublishAction();
  if (!confirmed) return;
  await saveWithProgress("draft", { offerSync: true, syncAction: "unpublish" });
}
