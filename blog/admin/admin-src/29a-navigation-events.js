import { tokenKey } from "./00-konstanten.js";

import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { ensureDraftsBranch } from "./04-drafts.js";
import { validateTokenAccess } from "./05-github-auth.js";
import { confirmLeaveEditor } from "./19-recovery.js";
import { resizeTitleInput } from "./20-editor-fields.js";
import { setCollection } from "./23-routing.js";
import { refreshEntries } from "./25-entries.js";
import { refreshMedia } from "./26a-media-library.js";
import { updateConnectionState } from "./28-connection.js";

export function wireNavigationEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const base = button.dataset.collection;
      // The "posts" tab covers both posts and pages: returning to it goes
      // back to whichever of the two was open last, instead of resetting to
      // posts every time (e.g. after a detour to Media).
      const next = base === "posts" ? state.libraryCollection : base;
      // Only a no-op when that collection's list is already on screen — not
      // when we are on another view (e.g. the Sync queue) with the same
      // collection still selected.
      const targetView = next === "media" ? "media" : "library";
      if (next === state.collection && state.view === targetView) return;
      if (await confirmLeaveEditor()) setCollection(next);
    });
  });

  if (els.entryTypeSelect) {
    els.entryTypeSelect.addEventListener("change", async () => {
      const next = els.entryTypeSelect.value;
      if (next === state.collection) return;
      if (await confirmLeaveEditor()) setCollection(next);
      else els.entryTypeSelect.value = state.collection;
    });
  }

  if (els.saveTokenButton) {
    els.saveTokenButton.addEventListener("click", async () => {
      const nextToken = els.tokenInput.value.trim();
      if (!nextToken) {
        showStatus("GitHub token missing.", "error");
        return;
      }

      setBusy(true);
      try {
        await validateTokenAccess(nextToken);
        state.token = nextToken;
        state.tokenAuthorizationError = "";
        sessionStorage.setItem(tokenKey, state.token);
        state.tree = null;
        state.mainTree = null;
        state.changeCache = null;
        state.postsIndex = null;
        updateConnectionState();
        showStatus("Verbunden.");
        await ensureDraftsBranch();
        if (state.collection === "media") await refreshMedia(true);
        else await refreshEntries(true);
      } catch (error) {
        state.token = "";
        state.tokenAuthorizationError = error.message;
        sessionStorage.removeItem(tokenKey);
        updateConnectionState();
        showStatus(`GitHub-Autorisierung fehlgeschlagen: ${error.message}`, "error");
      } finally {
        setBusy(false);
      }
    });
  }

  if (els.clearTokenButton) {
    els.clearTokenButton.addEventListener("click", () => {
      state.token = "";
      state.tokenAuthorizationError = "";
      sessionStorage.removeItem(tokenKey);
      if (els.tokenInput) els.tokenInput.value = "";
      state.tree = null;
      state.mainTree = null;
      state.changeCache = null;
      updateConnectionState();
      showStatus("Disconnected.");
    });
  }
  window.addEventListener("resize", resizeTitleInput);
}
