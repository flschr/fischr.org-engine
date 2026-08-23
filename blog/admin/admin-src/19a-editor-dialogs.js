import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";

// --- Editor confirmation dialogs ---------------------------------------

export function askDeleteAction() {
  const label = state.current?.collection === "pages" ? "Page" : "Article";
  els.deleteDialogTitle.textContent = `Delete ${label.toLowerCase()}?`;
  els.deleteDialogText.textContent = "The deletion is queued and only carried out when you publish.";
  return new Promise((resolve) => {
    const resolveWithValue = () => resolve(els.deleteDialog.returnValue || "cancel");
    els.deleteDialog.addEventListener("close", resolveWithValue, { once: true });
    els.deleteDialog.showModal();
  });
}

export function askDiscardAction({ title, text, actionLabel = "Verwerfen" }) {
  els.discardDialogTitle.textContent = title;
  els.discardDialogText.textContent = text;
  els.discardDialogAction.textContent = actionLabel;
  els.discardDialog.returnValue = "cancel";
  return new Promise((resolve) => {
    const resolveWithValue = () => resolve(els.discardDialog.returnValue === "discard");
    els.discardDialog.addEventListener("close", resolveWithValue, { once: true });
    els.discardDialog.showModal();
  });
}

export function askUnpublishAction() {
  if (!els.unpublishDialog) return Promise.resolve(false);
  els.unpublishDialog.returnValue = "cancel";
  return new Promise((resolve) => {
    const resolveWithValue = () => resolve(els.unpublishDialog.returnValue === "unpublish");
    els.unpublishDialog.addEventListener("close", resolveWithValue, { once: true });
    els.unpublishDialog.showModal();
  });
}
