import { collections } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { syncAutoSlug } from "./06-paths.js";
import { slugify, slugifyLive } from "./08-encoding.js";
import { onCategoryChange } from "./10a-social-editor-ui.js";
import { addGalleryImage } from "./11-social-images.js";
import { onContentTypeChange } from "./12-content-type.js";
import { closePublishDialog, confirmPublishDialog, restoreDialogBackup, updateSocialPanel } from "./13-publish-dialog.js";
import { cancelSocialImagePick, startSocialImagePick } from "./15-media-references.js";
import { EDITOR_CHANGED, ensureEditor, renderEditorBody, setEditorMode, syncEditorFromVisible } from "./17-editor.js";
import { handleEditorDragEnter, handleEditorDragLeave, handleEditorDragOver, handleEditorDrop, resetEditorDrop } from "./17a-editor-drop.js";
import { confirmLeaveEditor } from "./19-recovery.js";
import { renderEditorMetaLine, resizeTitleInput, syncPublishButton } from "./20-editor-fields.js";
import { renderEntryList } from "./25-entries.js";
import { newEntry, queueEntryDelete } from "./25a-entry-actions.js";
import { handleCurrentPublishAction, saveWithProgress, unpublishCurrentPost } from "./25b-publish-actions.js";
import { queueGpxUpload, queueUploads } from "./26-media.js";
import { renderMedia } from "./26b-media-render.js";
import { syncOutbox } from "./27b-publish-actions.js";
import { discardAllChanges, discardUnusedMedia } from "./27d-discard-changes.js";
import { openQueue } from "./27c-queue-render.js";
import { refreshCurrent } from "./29-events.js";

export function wireEditorEvents() {
  // The list itself fetches the full text once a query needs it (renderEntryList
  // in 25-entries.js) — search here is the exception, not the rule, so nothing
  // downloads before the first real search term.
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

  // Typing into a published article is what brings its send button back. Both
  // listeners hand in the keystroke flag, which is what keeps a per-character
  // check from serialising the document — see syncPublishButton().
  const syncFromKeystroke = () => syncPublishButton({ fromKeystroke: true });
  document.addEventListener(EDITOR_CHANGED, syncFromKeystroke);
  els.titleInput.addEventListener("input", syncFromKeystroke);

  els.toggleMetaButton.addEventListener("click", () => {
    syncAutoSlug();
    els.metaPanel.showModal();
    // showModal()'s own "focus the first focusable descendant" step can land
    // on Slug (a text input) regardless of the heading's tabindex, and a
    // focused text field opens the keyboard immediately — not wanted for a
    // menu the user is opening to look at/adjust, not to start typing in.
    // Move focus explicitly, after the dialog's own focusing steps have run.
    els.metaPanel.querySelector("h2")?.focus();
  });

  // No back button: the platform's own back — the browser's, or the edge-swipe
  // in a home-screen app — already leads out, and it lands in handlePopState(),
  // which asks about unsaved changes exactly like this button did and re-pushes
  // the editor if the answer is no. A second way out only cost a slot in the
  // bar.
  els.saveButton.addEventListener("click", () => saveWithProgress("save"));
  els.publishButton.addEventListener("click", handleCurrentPublishAction);
  // Rare article actions live behind "⋯" so the bar keeps only what gets used
  // while writing. The menu itself decides nothing — each entry still runs its
  // own confirmation.
  els.docMenuButton?.addEventListener("click", () => {
    const published = state.current?.collection === "posts" && Boolean(state.current.published);
    if (els.docMenuUnpublish) els.docMenuUnpublish.hidden = !published;
    // A page is not an article. The delete confirmation next door already names
    // the kind it is about; the menu that leads to it has to agree.
    const label = collections[state.current?.collection]?.label || "Eintrag";
    const deleteLabel = els.docMenuDelete?.querySelector(".tb-sheet-label");
    if (deleteLabel) deleteLabel.textContent = `${label} löschen`;
    if (els.docMenuDialogTitle) els.docMenuDialogTitle.textContent = label;
    if (!els.docMenuDialog) return;
    // Reset before opening, like every other dialog here. WebKit — i.e. the
    // browser this admin is written on — leaves `returnValue` untouched when a
    // dialog is dismissed with Escape, so a previous "delete" would still be
    // sitting there and fire again on the next dismissal. Chromium clears it
    // to "", which hides the bug completely on desktop.
    els.docMenuDialog.returnValue = "cancel";
    els.docMenuDialog.showModal();
  });
  els.docMenuDialog?.addEventListener("close", () => {
    const choice = els.docMenuDialog.returnValue;
    if (choice === "delete") queueEntryDelete();
    else if (choice === "unpublish") unpublishCurrentPost();
  });
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

  // The single-line metadata fields (slug, permalink, image path) used to
  // submit the form on Enter for free. #editorForm is a <div> now, not a
  // <form> — see the comment on it in index.html — so this is wired
  // explicitly instead. The title's own Enter handling lives with the title.
  els.editorForm.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.target?.tagName !== "INPUT" || event.target.type !== "text") return;
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

  // A title is one line. <textarea> inserts a newline on Enter by default;
  // here Enter means "done with the title, on to the text" instead, matching
  // what every single-line field in this form already does on submit.
  els.titleInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (state.editorMode === "preview") setEditorMode("markdown");
    ensureEditor()?.focus();
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
}
