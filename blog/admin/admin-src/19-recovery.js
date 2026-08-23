import { buildDocument, splitDocument } from "./09-frontmatter.js";
import { editorRecovery } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { isSourcePagePath, publicMediaPath } from "./06-paths.js";
import { formatEditorDate } from "./08-encoding.js";
import { socialConfigDirty } from "./14a-social-controls.js";
import { syncEditorFromVisible } from "./17-editor.js";
import { editorSnapshot } from "./18-snapshots.js";
import { askDiscardAction } from "./19a-editor-dialogs.js";
import { fillEditor } from "./20-editor-fields.js";
import { collectEditorFields } from "./20a-editor-field-actions.js";
import { fillSourceEditor } from "./20b-source-pages.js";
import { queueCurrent } from "./25a-entry-actions.js";
import { preparedMediaChange } from "./26-media.js";
import { loadMediaManifest, mediaManifestKeyFor, pendingUploadPathFor } from "./26a1-media-manifest.js";
import { removeMediaReferences } from "./26c-media-cleanup.js";

// --- Autosave (crash-safe local recovery) --------------------------------

// Als Funktionen und nicht als Aliase: Ein `const x = editorRecovery.y` liest beim Auswerten des
// Moduls, und dieses Modul liegt mit 01-bootstrap.js in einem Importzyklus. Welche Seite zuerst
// ausgewertet wird, entscheidet der Bündler — die andere sähe editorRecovery dann noch
// uninitialisiert. Genau daran startete der Admin nach der Modul-Umstellung nicht mehr:
// "Cannot read properties of undefined (reading 'docKey')".
//
// Ein Funktionsaufruf verschiebt den Zugriff auf den Zeitpunkt, zu dem alles steht.
// editor-recovery.js gibt reine Closures zurück und benutzt kein `this`, der Umweg über den
// Methodenaufruf ändert also nichts am Verhalten.
export function docKeyFor(current) {
  return editorRecovery.docKey(current);
}

// A successfully R2-migrated image never gets a `drafts` blob at all (see
// normalizeUploadedImage / scripts/admin-normalize-image.js), so its completion signal
// is an automation/media-manifest.json entry rather than a git tree path. Reuses the
// media library's cached loader (blog/admin/admin-src/26a1-media-manifest.part) instead
// of reading the manifest blob a second way.
export async function mediaManifestKeys() {
  try {
    return new Set(Object.keys(await loadMediaManifest(false)));
  } catch {
    return new Set();
  }
}

export function clearAutosave() {
  state.autosaveSnapshot = "";
  if (state.autosaveTimer) {
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
  }
  editorRecovery.clear();
}

// Persist the live editor doc whenever it differs from the last copy. Cheap to
// call often: it bails out on an unchanged snapshot before assembling the
// document, and never throws into the typing path.
export function writeAutosave() {
  if (!editorIsLive() || !["posts", "pages"].includes(state.current.collection)) return;
  syncEditorFromVisible();
  const snapshot = editorSnapshot();
  if (snapshot === state.autosaveSnapshot) return;
  try {
    const collection = state.current.collection;
    const content = state.current.sourceMode
      ? state.bodyMarkdown
      : buildDocument(collectEditorFields(), state.current.preserved || [], state.bodyMarkdown, collection);
    editorRecovery.write({
      docKey: docKeyFor(state.current),
      collection,
      path: state.current.path || "",
      isNew: Boolean(state.current.isNew),
      sha: state.current.sha || "",
      publishedPath: state.current.publishedPath || "",
      content,
      snapshot,
      label: els.titleInput.value || "",
      pendingMedia: Array.from(state.pendingMediaUploads.values())
        .filter((item) => item.docKey === docKeyFor(state.current))
        .map((item) => ({ sourcePath: item.change.path, targetPath: preparedMediaChange(item.change).path }))
    });
    state.autosaveSnapshot = snapshot;
  } catch (error) {
    // A failed autosave must never interrupt editing; the periodic flush and
    // the next keystroke will try again.
  }
}

export function scheduleAutosave() {
  if (state.autosaveTimer) window.clearTimeout(state.autosaveTimer);
  state.autosaveTimer = window.setTimeout(() => {
    state.autosaveTimer = null;
    writeAutosave();
  }, 800);
}

function readAutosave() {
  return editorRecovery.read();
}

// After loading a doc, offer to restore a newer local copy if one exists for
// the same doc and actually diverges from what we just loaded. The restore
// re-runs `fillEditor`, so a re-entrancy guard keeps it from looping.
export async function maybeOfferRestore(current) {
  if (state.suppressRestore) return;
  const saved = readAutosave();
  if (!saved || saved.docKey !== docKeyFor(current)) return;
  // `savedSnapshot` was just captured from the freshly loaded doc; if the
  // autosave matches it, there's nothing unsaved to recover.
  if (saved.snapshot === state.savedSnapshot) {
    clearAutosave();
    return;
  }
  const when = formatEditorDate(saved.savedAt);
  const restore = await askDiscardAction({
    title: "Restore unsaved draft?",
    text: `An unsaved version${when ? ` from ${when}` : ""} was found${saved.label ? ` — “${saved.label}”` : ""}. Restore it, or keep the saved version?`,
    actionLabel: "Restore"
  });
  if (!restore) {
    clearAutosave();
    return;
  }
  // Baseline of the version actually committed (drafts/repo). The restored
  // copy diverges from it, so we keep this as `savedSnapshot` to leave the
  // editor marked dirty — the recovered work still needs a real Save.
  const committedSnapshot = state.savedSnapshot;
  state.suppressRestore = true;
  try {
    if (current.sourceMode || isSourcePagePath(saved.path)) {
      fillSourceEditor(saved.content || "", {
        path: saved.path || current.path,
        collection: "pages",
        local: true,
        sha: saved.sha || "",
        sourceMode: true
      });
    } else {
      const treePaths = new Set((state.tree?.tree || []).map((item) => item.path));
      const manifestKeys = await mediaManifestKeys();
      const missingPendingPaths = (saved.pendingMedia || [])
        .filter((item) => (
          !treePaths.has(item.sourcePath) &&
          !treePaths.has(item.targetPath) &&
          !manifestKeys.has(mediaManifestKeyFor(item.targetPath)) &&
          !treePaths.has(pendingUploadPathFor(mediaManifestKeyFor(item.targetPath)))
        ))
        .map((item) => publicMediaPath(item.targetPath));
      const doc = splitDocument(removeMediaReferences(saved.content || "", missingPendingPaths));
      fillEditor(doc.fields, doc.preserved, doc.body, {
        path: saved.path || "",
        collection: saved.collection || current.collection,
        local: true,
        isNew: Boolean(saved.isNew),
        sha: saved.sha || "",
        published: Boolean(current.published),
        publishedPath: saved.publishedPath || current.publishedPath || ""
      }, doc.fieldBlocks);
    }
  } finally {
    state.suppressRestore = false;
  }
  state.savedSnapshot = committedSnapshot;
  showStatus("Unsaved draft restored — remember to save.");
}

// The editor is "live" whenever a doc is open — including while it's hidden
// behind the gallery during a social-image pick. The old `editorForm.hidden`
// guard silently reported "clean" mid-pick, which disarmed the unsaved-changes
// warning exactly when a stray navigation could discard the article.
function editorIsLive() {
  return Boolean(state.current && (state.view === "editor" || state.socialImagePick));
}

export function editorIsDirty() {
  if (!editorIsLive()) return false;
  syncEditorFromVisible();
  return state.savedSnapshot !== editorSnapshot();
}

function askUnsavedAction() {
  return new Promise((resolve) => {
    const resolveWithValue = () => resolve(els.unsavedDialog.returnValue || "cancel");
    els.unsavedDialog.addEventListener("close", resolveWithValue, { once: true });
    els.unsavedDialog.showModal();
  });
}

export async function confirmLeaveEditor() {
  if (state.view === "social") {
    if (!socialConfigDirty()) return true;
    return askDiscardAction({
      title: "Discard changes?",
      text: "The social configuration has unsaved changes.",
      actionLabel: "Verwerfen"
    });
  }
  if (!editorIsDirty()) return true;
  const action = await askUnsavedAction();
  if (action === "discard") {
    // Discarding the in-memory edits must also drop the recovery copy, or it
    // would resurface as a stale "restore?" prompt the next time this doc (or
    // a fresh "new post", which shares the __new__ slot) is opened.
    clearAutosave();
    return true;
  }
  if (action === "save") {
    try {
      return await queueCurrent("save");
    } catch (error) {
      showStatus(`Speichern fehlgeschlagen: ${error.message}`, "error");
      return false;
    }
  }
  return false;
}
