import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { blobShaMap } from "./04-drafts.js";
import { putChange } from "./04a-draft-writes.js";
import { baseName, entryInfoFromPath } from "./06-paths.js";
import { ensureEditor, renderEditorBody, syncEditorFromVisible } from "./17-editor.js";
import { captureEditorSnapshot } from "./18-snapshots.js";
import { clearAutosave, maybeOfferRestore } from "./19-recovery.js";
import { renderEditorMetaLine } from "./20-editor-fields.js";
import { showView, updateNav } from "./23-routing.js";
import { pushNav } from "./24-history.js";
import { refreshEntries, renderEntryList } from "./25-entries.js";

// --- Explicitly editable Nunjucks source pages --------------------------

export function setSourceModeUi(enabled) {
  const sourceMode = Boolean(enabled);
  els.editorForm.classList.toggle("is-source-mode", sourceMode);
  els.titleInput.hidden = sourceMode;
  els.publishButton.hidden = sourceMode;
  els.docMenuButton.hidden = sourceMode;
  els.previewModeButton.hidden = sourceMode;
  els.toggleMetaButton.hidden = sourceMode;
  // altTextButton now lives inside the writing bar (next to inserting an
  // image), so hiding that bar already takes it with it.
  if (els.writingBar) els.writingBar.hidden = sourceMode;
  if (sourceMode) els.metaPanel.close();
}

export function fillSourceEditor(content, current) {
  const info = entryInfoFromPath(current.path) || {};
  state.current = {
    ...current,
    collection: "pages",
    sourceMode: true,
    sourceTitle: info.title || baseName(current.path),
    originalInputs: {}
  };
  state.autoSlug = false;
  state.bodyMarkdown = String(content || "");
  state.editorMode = "markdown";
  setSourceModeUi(true);
  els.editorViewTitle.textContent = `${state.current.sourceTitle} bearbeiten`;

  const editor = ensureEditor();
  if (editor) {
    editor.setMode("source");
    editor.setValue(state.bodyMarkdown);
  }

  renderEditorBody();
  renderEditorMetaLine();
  captureEditorSnapshot();
  state.autosaveSnapshot = state.savedSnapshot;
  showView("editor");
  pushNav();
  maybeOfferRestore(state.current);
}

export function openSourceEditor(content, current, status) {
  state.collection = "pages";
  updateNav();
  fillSourceEditor(content, { ...current, collection: "pages", sourceMode: true });
  renderEntryList();
  showStatus(status);
}

export async function queueSourcePage() {
  syncEditorFromVisible();
  const path = state.current.path;
  const savedChange = {
    path,
    kind: "upsert",
    type: "text",
    encoding: "utf-8",
    collection: "pages",
    label: state.current.sourceTitle || baseName(path),
    content: state.bodyMarkdown,
    sha: state.current.sha || "",
    updatedAt: new Date().toISOString(),
    summary: "Save source",
    previousPath: path,
    expectedBlobs: { [path]: state.current.sha || null }
  };
  await putChange(savedChange);
  state.current.sha = blobShaMap(state.tree).get(path) || savedChange.sha;
  state.current.local = true;
  captureEditorSnapshot();
  clearAutosave();
  state.autosaveSnapshot = state.savedSnapshot;
  try {
    await refreshEntries(false);
  } catch {
    // The source save already landed on drafts; the list can catch up later.
  }
  showStatus("Quelltext in GitHub gespeichert.");
  return true;
}
