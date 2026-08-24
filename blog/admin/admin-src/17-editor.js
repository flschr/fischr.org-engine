import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { ICON } from "./02-toolbar.js";
import { showStatus } from "./03-status.js";
import { gpxMarkdown, imageMarkdown, videoMarkdown } from "./09-frontmatter.js";
import { bindPreviewImageFallbacks, renderPreview } from "./16a-alt-text-actions.js";
import { loadPreviewRuntime } from "./16b-runtime-loader.js";
import { scheduleAutosave } from "./19-recovery.js";

// --- Editor instance -----------------------------------------------------

// Fires on every edit to the article body. Announced on `document` rather than
// handed to a caller, so nothing has to import this module back — see the
// dispatch below.
export const EDITOR_CHANGED = "rw:editor-changed";

export function ensureEditor() {
  if (state.editor) return state.editor;
  if (!window.RWEditor) {
    showStatus("Editor konnte nicht geladen werden.", "error");
    return null;
  }
  state.editor = window.RWEditor.create(els.editorMount, {
    value: state.bodyMarkdown,
    lang: els.langInput.value || "de",
    placeholder: "Write your text here",
    onChange: (value) => {
      state.bodyMarkdown = value;
      scheduleAutosave();
      // Announced rather than called: 20-editor-fields.js already imports this
      // module, so importing it back would close a cycle — the kind this
      // project has been bitten by before (see 00-konstanten.js). The listener
      // is wired in 29b-editor-events.js, which imports both anyway.
      document.dispatchEvent(new CustomEvent(EDITOR_CHANGED));
    }
  });
  return state.editor;
}

export function syncEditorFromVisible() {
  if (state.editor && state.editorMode !== "preview") {
    state.bodyMarkdown = state.editor.getValue();
  }
}

export async function setEditorMode(mode) {
  if (!state.current) return;
  if (state.current.sourceMode && mode === "preview") return;
  if (mode === "preview") syncEditorFromVisible();
  if (mode === "preview") {
    els.previewPanel.hidden = false;
    els.previewPanel.innerHTML = '<p class="preview-empty">Vorschau wird geladen …</p>';
    try {
      await loadPreviewRuntime();
    } catch (error) {
      showStatus(error.message, "error");
      return;
    }
  }
  state.editorMode = mode;
  renderEditorBody();
}

export function renderEditorBody() {
  const isPreview = state.editorMode === "preview";
  if (els.previewModeButton) {
    els.previewModeButton.innerHTML = isPreview ? ICON.edit : ICON.eye;
    els.previewModeButton.setAttribute("aria-pressed", isPreview ? "true" : "false");
    const label = isPreview ? "Bearbeiten" : "Vorschau";
    els.previewModeButton.setAttribute("aria-label", label);
    els.previewModeButton.title = label;
  }

  if (isPreview) {
    els.editorMount.hidden = true;
    els.previewPanel.hidden = false;
    els.previewPanel.innerHTML = renderPreview(state.bodyMarkdown) || '<p class="preview-empty">Noch kein Inhalt.</p>';
    bindPreviewImageFallbacks();
    return;
  }

  els.previewPanel.hidden = true;
  els.editorMount.hidden = false;
  const editor = ensureEditor();
  if (editor) editor.focus();
}

function insertImageMarkdown(values = {}) {
  if (state.editorMode === "preview") setEditorMode("markdown");
  const editor = ensureEditor();
  if (!editor) return;
  editor.insertText(imageMarkdown(values), { block: true });
  syncEditorFromVisible();
}

export function insertMediaMarkdown(change) {
  if (!change) return;
  if (change.mediaKind === "video") {
    if (state.editorMode === "preview") setEditorMode("markdown");
    const editor = ensureEditor();
    if (!editor) return;
    editor.insertText(videoMarkdown({ src: change.publicPath }), { block: true });
    syncEditorFromVisible();
    return;
  }
  insertImageMarkdown({ src: change.publicPath, alt: "", caption: "" });
}

export function insertGpxMarkdown(publicPath) {
  if (state.editorMode === "preview") setEditorMode("markdown");
  const editor = ensureEditor();
  if (!editor) return;
  editor.insertText(gpxMarkdown({ src: publicPath }), { block: true });
  syncEditorFromVisible();
}
