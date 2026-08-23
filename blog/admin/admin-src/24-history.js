import { state } from "./01c-state.js";
import { openSocialConfig } from "./14-social-settings.js";
import { socialConfigDirty } from "./14a-social-controls.js";
import { cancelSocialImagePick } from "./15-media-references.js";
import { confirmLeaveEditor, editorIsDirty } from "./19-recovery.js";
import { openStats } from "./21-stats.js";
import { setCollection } from "./23-routing.js";
import { newEntry } from "./25a-entry-actions.js";
import { openEntry } from "./25c-entry-opening.js";
import { openQueue } from "./27c-queue-render.js";

// --- History (browser/gesture back & forward) ----------------------------

function currentNavState() {
  if (state.view === "editor") {
    return { rw: "editor", collection: state.current?.collection || state.collection, path: state.current?.path || "", isNew: Boolean(state.current?.isNew) };
  }
  if (state.view === "media") return { rw: "media" };
  if (state.view === "queue") return { rw: "queue" };
  if (state.view === "stats") return { rw: "stats" };
  if (state.view === "social") return { rw: "social" };
  return { rw: "library", collection: state.collection };
}

export function pushNav() {
  if (state.navigating) return;
  try {
    history.pushState(currentNavState(), "");
  } catch (error) {
    // history may be unavailable in some embedded contexts — ignore
  }
}

export function replaceNav() {
  try {
    history.replaceState(currentNavState(), "");
  } catch (error) {
    // ignore
  }
}

export async function routeTo(target) {
  const view = target && target.rw ? target.rw : "library";
  if (view === "editor") {
    if (target.path) await openEntry(target.path);
    // Pass the collection on: a restored draft has no path to derive it from,
    // and without it a new *page* would come back as a new *post* and save to
    // blog/posts/. openEntry reads it off the entry itself.
    else await newEntry(target.collection === "pages" ? "pages" : "posts");
    return;
  }
  if (view === "media") {
    setCollection("media");
    return;
  }
  if (view === "queue") {
    await openQueue();
    return;
  }
  if (view === "stats") {
    openStats();
    return;
  }
  if (view === "social") {
    openSocialConfig();
    return;
  }
  setCollection(target.collection || "posts");
}

export async function handlePopState(event) {
  // A back press during a social-image pick cancels the pick and returns to
  // the editor (reopening the publish sheet) instead of tearing down the
  // still-open, unsaved editor underneath the gallery. Re-push so the history
  // stack stays balanced where we landed.
  if (state.socialImagePick) {
    cancelSocialImagePick();
    state.navigating = true;
    try { history.pushState(currentNavState(), ""); } catch (error) { /* ignore */ }
    state.navigating = false;
    return;
  }

  const target = event.state || { rw: "library", collection: "posts" };

  if ((state.view === "editor" && editorIsDirty()) || (state.view === "social" && socialConfigDirty())) {
    const ok = await confirmLeaveEditor();
    if (!ok) {
      // Stay put: re-push the editor state we just navigated away from.
      state.navigating = true;
      try {
        history.pushState(currentNavState(), "");
      } catch (error) {
        /* ignore */
      }
      state.navigating = false;
      return;
    }
  }

  state.navigating = true;
  try {
    await routeTo(target);
  } finally {
    state.navigating = false;
  }
}
