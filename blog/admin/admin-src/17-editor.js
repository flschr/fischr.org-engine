import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { ICON } from "./02-toolbar.js";
import { showStatus } from "./03-status.js";
import { isMediaPath } from "./06-paths.js";
import { gpxMarkdown, imageMarkdown, videoMarkdown } from "./09-frontmatter.js";
import { bindPreviewImageFallbacks, renderPreview } from "./16a-alt-text-actions.js";
import { loadPreviewRuntime } from "./16b-runtime-loader.js";
import { scheduleAutosave } from "./19-recovery.js";
import { queueUploads } from "./26-media.js";

// --- Editor instance -----------------------------------------------------

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

function acceptsEditorMediaDrop() {
  return !state.isBusy && state.view === "editor" && state.current && !state.current.sourceMode && ["posts", "pages"].includes(state.current.collection);
}

function isDroppedMedia(file) {
  return Boolean(file) && (
    file.type.startsWith("image/") ||
    file.type.startsWith("video/") ||
    isMediaPath(file.name || "")
  );
}

export function transferHasMedia(dataTransfer) {
  if (!dataTransfer) return false;
  const files = Array.from(dataTransfer.files || []);
  if (files.some(isDroppedMedia)) return true;

  const items = Array.from(dataTransfer.items || []);
  if (items.length) {
    const hasMediaItem = items.some((item) => {
      if (item.kind !== "file") return false;
      if (item.type.startsWith("image/") || item.type.startsWith("video/")) return true;
      // Finder can omit the MIME type for QuickTime videos during drag-over.
      // Accept the unknown file provisionally; the drop handler validates its
      // filename once the browser exposes the actual File.
      return !item.type;
    });
    if (hasMediaItem) return true;
  }

  // WebKit can keep both collections empty while an external file is over
  // the page. "Files" is the only signal available until the drop event.
  return Array.from(dataTransfer.types || []).includes("Files");
}

function mediaFilesFromTransfer(dataTransfer) {
  if (!dataTransfer) return [];
  const files = Array.from(dataTransfer.files || []).filter(isDroppedMedia);
  const itemFiles = Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(isDroppedMedia);

  // Read both standard views defensively. Consume copies already present in
  // `files` so browsers exposing the same selection through both APIs do not
  // upload everything twice, while an engine-specific extra item is retained.
  const remainingFileCopies = new Map();
  for (const file of files) {
    const key = `${file.name}\n${file.size}\n${file.lastModified}\n${file.type}`;
    remainingFileCopies.set(key, (remainingFileCopies.get(key) || 0) + 1);
  }
  for (const file of itemFiles) {
    const key = `${file.name}\n${file.size}\n${file.lastModified}\n${file.type}`;
    const remaining = remainingFileCopies.get(key) || 0;
    if (remaining > 0) {
      remainingFileCopies.set(key, remaining - 1);
    } else {
      files.push(file);
    }
  }
  return files;
}

function setEditorDropActive(active) {
  els.editorForm.classList.toggle("is-dragging-upload", Boolean(active) && !els.editorForm.hidden);
}

export function resetEditorDrop() {
  state.editorDragDepth = 0;
  setEditorDropActive(false);
}

export function handleEditorDragEnter(event) {
  if (!acceptsEditorMediaDrop() || !transferHasMedia(event.dataTransfer)) return;
  event.preventDefault();
  state.editorDragDepth += 1;
  setEditorDropActive(true);
}

export function handleEditorDragOver(event) {
  if (!acceptsEditorMediaDrop() || !transferHasMedia(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setEditorDropActive(true);
}

export function handleEditorDragLeave(event) {
  if (!acceptsEditorMediaDrop() || !transferHasMedia(event.dataTransfer)) return;
  event.preventDefault();
  state.editorDragDepth = Math.max(0, state.editorDragDepth - 1);
  if (state.editorDragDepth === 0) setEditorDropActive(false);
}

export async function handleEditorDrop(event) {
  if (!acceptsEditorMediaDrop() || !transferHasMedia(event.dataTransfer)) return;
  event.preventDefault();
  const files = mediaFilesFromTransfer(event.dataTransfer);
  resetEditorDrop();
  if (!files.length) return;
  await queueUploads(files, true);
}
