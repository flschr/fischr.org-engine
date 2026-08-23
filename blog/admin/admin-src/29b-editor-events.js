import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { syncAutoSlug } from "./06-paths.js";
import { slugify, slugifyLive } from "./08-encoding.js";
import { onCategoryChange } from "./10a-social-editor-ui.js";
import { addGalleryImage } from "./11-social-images.js";
import { onContentTypeChange } from "./12-content-type.js";
import { closePublishDialog, confirmPublishDialog, restoreDialogBackup, updateSocialPanel } from "./13-publish-dialog.js";
import { cancelSocialImagePick, startSocialImagePick } from "./15-media-references.js";
import { ensureEditor, handleEditorDragEnter, handleEditorDragLeave, handleEditorDragOver, handleEditorDrop, renderEditorBody, resetEditorDrop, setEditorMode, syncEditorFromVisible, transferHasMedia } from "./17-editor.js";
import { confirmLeaveEditor } from "./19-recovery.js";
import { renderEditorMetaLine, resizeTitleInput } from "./20-editor-fields.js";
import { backToLibrary } from "./23-routing.js";
import { replaceNav } from "./24-history.js";
import { renderEntryList } from "./25-entries.js";
import { newEntry, queueEntryDelete } from "./25a-entry-actions.js";
import { handleCurrentPublishAction, saveWithProgress } from "./25b-publish-actions.js";
import { queueGpxUpload, queueUploads } from "./26-media.js";
import { renderMedia } from "./26b-media-render.js";
import { syncOutbox } from "./27b-publish-actions.js";
import { discardAllChanges, discardUnusedMedia } from "./27d-discard-changes.js";
import { openQueue } from "./27c-queue-render.js";
import { refreshCurrent } from "./29-events.js";

export function wireEditorEvents() {
  els.searchInput.addEventListener("input", renderEntryList);
  els.refreshButton.addEventListener("click", refreshCurrent);
  els.refreshMediaButton.addEventListener("click", refreshCurrent);
  els.socialImageSelectButton?.addEventListener("click", startSocialImagePick);
  els.socialImageInput?.addEventListener("input", updateSocialPanel);
  els.contentTypeSelect?.addEventListener("change", onContentTypeChange);
  els.publishDialogConfirm?.addEventListener("click", confirmPublishDialog);
  els.publishDialogCancel?.addEventListener("click", () => closePublishDialog(true));
  // Esc closes the modal (fires "cancel") — revert the controls like Abbrechen.
  els.publishDialog?.addEventListener("cancel", restoreDialogBackup);
  els.categorySelect?.addEventListener("change", onCategoryChange);
  els.socialTextInput?.addEventListener("input", updateSocialPanel);
  els.socialImageGalleryAdd?.addEventListener("click", addGalleryImage);
  els.mediaPickCancel?.addEventListener("click", cancelSocialImagePick);
  els.mediaSearchInput.addEventListener("input", renderMedia);
  els.mediaFilterInput.addEventListener("change", renderMedia);

  els.newButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      if (await confirmLeaveEditor()) newEntry();
    });
  });

  els.previewModeButton.addEventListener("click", () => {
    setEditorMode(state.editorMode === "preview" ? "markdown" : "preview");
  });

  els.toggleMetaButton.addEventListener("click", () => {
    const expanded = els.toggleMetaButton.getAttribute("aria-expanded") === "true";
    els.toggleMetaButton.setAttribute("aria-expanded", expanded ? "false" : "true");
    els.metaPanel.hidden = expanded;
    if (!expanded) syncAutoSlug();
  });

  // Leaving the editor without saving — the phone's only exit now that the
  // bottom bar hides here. Routes like any other navigation so the history
  // stack keeps matching the view.
  els.editorBackButton?.addEventListener("click", async () => {
    if (state.view !== "editor") return;
    if (!(await confirmLeaveEditor())) return;
    backToLibrary();
    replaceNav();
  });
  els.saveButton.addEventListener("click", () => saveWithProgress("save"));
  els.publishButton.addEventListener("click", handleCurrentPublishAction);
  els.deleteButton.addEventListener("click", queueEntryDelete);
  els.undoButton.addEventListener("click", () => {
    if (state.editorMode === "preview") setEditorMode("markdown");
    const editor = ensureEditor();
    if (editor) editor.undo();
    syncEditorFromVisible();
  });
  els.redoButton.addEventListener("click", () => {
    if (state.editorMode === "preview") setEditorMode("markdown");
    const editor = ensureEditor();
    if (editor) editor.redo();
    syncEditorFromVisible();
  });

  els.editorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveWithProgress("save");
  });

  els.imageUploadInput.addEventListener("change", () => queueUploads(els.imageUploadInput.files, true));
  els.gpxUploadInput.addEventListener("change", () => queueGpxUpload(els.gpxUploadInput.files));
  els.mediaUploadInput.addEventListener("change", () => queueUploads(els.mediaUploadInput.files, false));
  // Capture phase: the CodeMirror editor mounted inside the form swallows
  // dragover/drop in the bubble phase (it stopPropagation()s but never
  // preventDefault()s a file drop), so a file dropped on the text area fell
  // through to the browser and opened in a new tab. Handling these on the way
  // *down* lets us claim media-file drops before the editor sees them; non-file
  // drags fail the transferHasMedia() guard and pass through to the editor.
  els.editorForm.addEventListener("dragenter", handleEditorDragEnter, true);
  els.editorForm.addEventListener("dragover", handleEditorDragOver, true);
  els.editorForm.addEventListener("dragleave", handleEditorDragLeave, true);
  els.editorForm.addEventListener("drop", handleEditorDrop, true);
  els.editorForm.addEventListener("dragend", resetEditorDrop, true);

  els.syncButton.addEventListener("click", async () => {
    if (await confirmLeaveEditor()) await openQueue();
  });
  els.pushButton.addEventListener("click", syncOutbox);
  els.discardAllButton.addEventListener("click", discardAllChanges);
  els.cleanupOrphansButton?.addEventListener("click", discardUnusedMedia);
  els.titleInput.addEventListener("input", () => {
    syncAutoSlug();
    if (state.current?.collection === "pages" && (!els.permalinkInput.value || state.current.isNew)) {
      els.permalinkInput.value = `/${slugify(els.titleInput.value)}/`;
    }
    resizeTitleInput();
    updateSocialPanel();
  });

  els.slugInput.addEventListener("input", () => {
    state.autoSlug = false;
    const before = els.slugInput.value;
    const cleaned = slugifyLive(before);
    if (cleaned !== before) {
      const caret = els.slugInput.selectionStart ?? cleaned.length;
      els.slugInput.value = cleaned;
      const next = Math.max(0, caret - (before.length - cleaned.length));
      els.slugInput.setSelectionRange(next, next);
    }
    updateSocialPanel();
  });

  els.langInput.addEventListener("change", () => {
    const lang = els.langInput.value || "de";
    els.titleInput.lang = lang === "en" ? "en" : "de";
    if (state.editor?.setLanguage) state.editor.setLanguage(lang);
    if (state.editorMode === "preview") renderEditorBody();
  });

  [els.dateInput, els.draftInput].forEach((input) => {
    input.addEventListener("input", renderEditorMetaLine);
    input.addEventListener("change", renderEditorMetaLine);
    input.addEventListener("change", updateSocialPanel);
  });
  els.draftInput.addEventListener("change", () => {
    if (state.current) state.current.draftTouched = true;
    renderEditorMetaLine();
  });
}
