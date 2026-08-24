import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { isMediaPath } from "./06-paths.js";
import { queueUploads } from "./26-media.js";

// --- Dropping media into the editor --------------------------------------
//
// Split out of 17-editor.js, which had grown past its 200-line budget carrying
// two jobs at once. This is the second one and stands on its own: it decides
// whether a drag carries media this editor accepts, digs the files out of a
// DataTransfer across the shapes the browsers hand us, and drives the drop
// highlight. Nothing here knows how the editor renders.

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

function transferHasMedia(dataTransfer) {
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
