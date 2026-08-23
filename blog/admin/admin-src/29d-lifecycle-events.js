import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { insertLinkFromDialog } from "./02b-toolbar-dialogs.js";
import { showStatus } from "./03-status.js";
import { socialConfigDirty } from "./14a-social-controls.js";
import { ensureEditor, setEditorMode, syncEditorFromVisible } from "./17-editor.js";
import { editorIsDirty, writeAutosave } from "./19-recovery.js";
import { handlePopState } from "./24-history.js";
import { saveWithProgress } from "./25b-publish-actions.js";

export function wireLifecycleEvents() {
  window.addEventListener("keydown", async (event) => {
    const key = event.key.toLowerCase();
    const isCommand = event.metaKey || event.ctrlKey;

    if (isCommand && key === "k" && state.view === "editor" && !state.isBusy && els.editorMount.contains(document.activeElement)) {
      event.preventDefault();
      if (state.editorMode === "preview") setEditorMode("markdown");
      const editor = ensureEditor();
      if (!editor) return;
      try {
        await insertLinkFromDialog(editor);
        syncEditorFromVisible();
      } catch (error) {
        showStatus(`Link fehlgeschlagen: ${error.message}`, "error");
      }
      return;
    }

    if (isCommand && key === "s" && state.view === "editor") {
      event.preventDefault();
      saveWithProgress("save");
      return;
    }
  }, { capture: true });

  window.addEventListener("beforeunload", (event) => {
    writeAutosave();
    if (!editorIsDirty() && !(state.view === "social" && socialConfigDirty())) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // `beforeunload` is unreliable on mobile (tab discards, app switch); pagehide
  // is the dependable last chance to flush the recovery copy.
  window.addEventListener("pagehide", () => writeAutosave());

  // Backstop for edits the debounced onChange can't see — title/meta fields,
  // and any change that lands while the editor is hidden behind the gallery.
  window.setInterval(writeAutosave, 5000);

  window.addEventListener("popstate", handlePopState);
}
