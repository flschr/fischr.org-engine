import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";

// --- Status & busy -------------------------------------------------------

export function showStatus(message, tone) {
  window.clearTimeout(state.statusTimer);
  els.statusBar.textContent = message;
  els.statusBar.dataset.tone = tone || "info";
  els.statusBar.classList.add("is-visible");
  state.statusTimer = window.setTimeout(() => {
    els.statusBar.classList.remove("is-visible");
  }, 3200);
}

export function setBusy(isBusy) {
  state.isBusy = Boolean(isBusy);
  [
    els.saveTokenButton,
    els.clearTokenButton,
    ...els.newButtons,
    els.refreshButton,
    els.refreshMediaButton,
    els.socialImageSelectButton,
    els.saveButton,
    els.publishButton,
    els.docMenuButton,
    els.previewModeButton,
    els.toggleMetaButton,
    els.undoButton,
    els.redoButton,
    els.pushButton,
    els.discardAllButton
  ].filter(Boolean).forEach((button) => {
    button.disabled = Boolean(isBusy);
  });

  Array.from(els.formatToolbar.querySelectorAll("button")).forEach((button) => {
    button.disabled = Boolean(isBusy);
  });

  // #syncButton fehlt hier bewusst: Er öffnet nur die Warteschlange und bleibt deshalb auch
  // während einer busy-Phase klickbar — sonst wäre der Fortschritt genau dann nicht einsehbar.
  if (!isBusy && els.clearTokenButton) els.clearTokenButton.disabled = !state.token;

  setEditorLocked(isBusy);
}

function setEditorLocked(isLocked) {
  const locked = Boolean(isLocked);
  els.editorForm.classList.toggle("is-editor-locked", locked);
  [
    els.titleInput,
    els.slugInput,
    els.permalinkInput,
    els.dateInput,
    els.socialImageInput,
    els.socialImageSelectButton,
    els.langInput,
    els.draftInput
  ].filter(Boolean).forEach((field) => {
    field.disabled = locked;
  });
  if (state.editor?.setEditable) state.editor.setEditable(!locked);
}
