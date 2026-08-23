import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { refreshEntries } from "./25-entries.js";
import { refreshMedia } from "./26a-media-library.js";
import { wirePullToRefresh } from "./28a-pull-refresh.js";
import { wireNavigationEvents } from "./29a-navigation-events.js";
import { wireEditorEvents } from "./29b-editor-events.js";
import { wireAdminViewEvents } from "./29c-admin-view-events.js";
import { wireLifecycleEvents } from "./29d-lifecycle-events.js";

// --- Events --------------------------------------------------------------

export function wireEvents() {
  wireNavigationEvents();
  wireEditorEvents();
  wireAdminViewEvents();
  wireLifecycleEvents();
  wirePullToRefresh();
}

export async function refreshCurrent() {
  setBusy(true);
  try {
    state.tree = null;
    state.mainTree = null;
    state.changeCache = null;
    state.postsIndex = null;
    if (state.collection === "media") await refreshMedia(true);
    else await refreshEntries(true);
    showStatus("Aktualisiert.");
  } catch (error) {
    showStatus(`Aktualisierung fehlgeschlagen: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}
