import { t } from "./00a-i18n.js";
import { collections } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { replaceNav } from "./24-history.js";
import { refreshEntries } from "./25-entries.js";
import { refreshMedia } from "./26a-media-library.js";

// --- View routing --------------------------------------------------------

export function showView(name) {
  state.view = name;
  document.body.classList.toggle("is-editor-view", name === "editor");
  els.libraryView.hidden = name !== "library";
  els.editorForm.hidden = name !== "editor";
  els.mediaView.hidden = name !== "media";
  els.queueView.hidden = name !== "queue";
  if (els.statsView) els.statsView.hidden = name !== "stats";
  if (els.socialConfigView) els.socialConfigView.hidden = name !== "social";
  if (els.statsNav) els.statsNav.classList.toggle("is-active", name === "stats");
  els.syncButton.classList.toggle("is-active", name === "queue");
  if (name === "queue") els.syncButton.setAttribute("aria-current", "page");
  else els.syncButton.removeAttribute("aria-current");
  // Social and Stats aren't tied to a content collection — leaving the
  // previous collection's tab marked active would misrepresent "you are
  // here" once its own tab bar row doesn't get a marker of its own. Queue
  // gets its own marker above instead of falling into this same bucket.
  if (name === "social" || name === "stats" || name === "queue") els.navButtons.forEach((button) => button.classList.remove("is-active"));
  else updateNav();
}

export function updateNav() {
  els.navButtons.forEach((button) => {
    // The "posts" tab also covers "pages" — the type switcher inside the
    // library view picks between them, so the sidebar/tab bar only needs one
    // entry point for both.
    const collection = button.dataset.collection;
    const active = collection === state.collection || (collection === "posts" && state.collection === "pages");
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

// Tabs are siblings, not depth: every destination reachable from the bottom
// bar replaces the current history entry, and only opening an entry pushes a
// new one. So a back swipe leads out of the editor and does nothing on a tab
// page, where the bar already shows every way on.
export function setCollection(collection) {
  // Navigating via the sidebar cancels an in-progress social-image pick.
  if (state.socialImagePick) {
    state.socialImagePick = null;
    if (els.mediaPickBar) els.mediaPickBar.hidden = true;
  }
  state.collection = collection;
  updateNav();

  // "New" creates a page only on the Pages view; everywhere else an article.
  const newLabel = t(collection === "pages" ? "viewTitle.newPage" : "viewTitle.newArticle");
  if (els.newEntryButtonLabel) els.newEntryButtonLabel.textContent = newLabel;

  if (collection === "media") {
    showView("media");
    replaceNav();
    // Use the cached tree (invalidated on every save/upload/publish), so
    // switching to the gallery is instant instead of refetching the whole tree.
    refreshMedia(false).catch((error) => showStatus(t("media.mediaLoadFailed", { error: error.message }), "error"));
    return;
  }

  state.libraryCollection = collection;
  els.libraryTitle.textContent = t(collections[collection].titleKey);
  els.searchInput.placeholder = t(collection === "pages" ? "entry.searchPages" : "entry.searchArticles");
  if (els.entryTypeSelect) els.entryTypeSelect.value = collection;
  if (els.newEntryButtonLib) {
    els.newEntryButtonLib.setAttribute("aria-label", newLabel);
    els.newEntryButtonLib.title = newLabel;
  }
  showView("library");
  replaceNav();
  refreshEntries(false).catch((error) => showStatus(t("queue.listLoadFailed", { error: error.message }), "error"));
}

export function backToLibrary() {
  if (state.collection === "media") showView("media");
  else showView("library");
}
