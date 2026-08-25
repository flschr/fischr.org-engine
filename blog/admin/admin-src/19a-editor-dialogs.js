import { t } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";

// --- Editor confirmation dialogs ---------------------------------------

export function askDeleteAction() {
  const isPage = state.current?.collection === "pages";
  els.deleteDialogTitle.textContent = t(isPage ? "dialog.deletePage" : "dialog.deleteArticle");
  els.deleteDialogText.textContent = t("dialog.deleteEntryBody");
  // Vor dem Öffnen zurücksetzen, sonst antwortet der Dialog mit der letzten Wahl.
  //
  // WebKit lässt returnValue beim Schliessen per Escape stehen, Chromium leert es. Gemessen:
  // nach Klick "delete", nach Escape → chromium "", webkit "delete". Wer hier einmal gelöscht
  // hat und den Dialog später wegwischt, legt also eine zweite Löschung in die Warteschlange,
  // ohne sie bestätigt zu haben — auf dem Gerät, auf dem geschrieben wird, und auf Chromium
  // unsichtbar. Das `|| "cancel"` unten hilft nicht: Es greift nur bei leerem Wert.
  els.deleteDialog.returnValue = "cancel";
  return new Promise((resolve) => {
    const resolveWithValue = () => resolve(els.deleteDialog.returnValue || "cancel");
    els.deleteDialog.addEventListener("close", resolveWithValue, { once: true });
    els.deleteDialog.showModal();
  });
}

export function askDiscardAction({ title, text, actionLabel = t("action.discard") }) {
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

// Die Rückfrage vor dem Verlassen eines Editors mit ungespeicherter Arbeit.
//
// Stand bis hierher in 19-recovery.js, obwohl sie dieselbe Form hat wie ihre Nachbarn hier und
// dieselbe Falle teilt — was auch der Grund war, warum sie die Rücksetzung nicht hatte: Neben
// den anderen Dialogen wäre sie aufgefallen.
export function askUnsavedAction() {
  // Dieselbe Konvention wie bei den übrigen Dialogen: zurücksetzen, bevor gezeigt wird. Ohne das
  // wiederholt WebKit nach einem Escape die vorige Wahl — hier „verwerfen", also den Verlust
  // ungespeicherter Arbeit ohne Rückfrage.
  els.unsavedDialog.returnValue = "cancel";
  return new Promise((resolve) => {
    const resolveWithValue = () => resolve(els.unsavedDialog.returnValue || "cancel");
    els.unsavedDialog.addEventListener("close", resolveWithValue, { once: true });
    els.unsavedDialog.showModal();
  });
}
