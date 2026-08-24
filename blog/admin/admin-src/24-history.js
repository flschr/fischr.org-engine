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
  // A fresh nav entry starts clean — any guard tracked for whatever was open
  // before belongs to a document that's no longer on top of the stack.
  state.dirtyGuardPushed = false;
  try {
    history.pushState(currentNavState(), "");
  } catch (error) {
    // history may be unavailable in some embedded contexts — ignore
  }
}

// A native back-swipe gesture commits and fires `popstate` only after its own
// animation has already settled — by then, `handlePopState`'s "stay put" push
// races a transition WebKit has decided is done, so it doesn't reliably take
// (this is what broke when the dedicated back button — which went through a
// synchronous click handler instead — was removed for the gesture in favor of
// popstate alone). Pre-empting a real edit with a throwaway duplicate history
// entry sidesteps the race entirely: the gesture only ever gets to consume the
// harmless duplicate, which lands back on an unchanged view, giving our own
// confirm dialog time to run before anything is actually left behind.
export function ensureDirtyGuard() {
  if (state.dirtyGuardPushed || state.navigating) return;
  if (!((state.view === "editor" && editorIsDirty()) || (state.view === "social" && socialConfigDirty()))) return;
  state.navigating = true;
  try {
    history.pushState(currentNavState(), "");
    state.dirtyGuardPushed = true;
  } catch (error) {
    // ignore
  } finally {
    state.navigating = false;
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

  // A pop consumes at most one entry. If a guard duplicate was on top, this
  // pop only landed back on the real (still dirty) editor entry underneath
  // it — not on whatever actually comes before it in the stack.
  const guardConsumed = state.dirtyGuardPushed;
  state.dirtyGuardPushed = false;

  if (state.skipNextDirtyCheck) {
    state.skipNextDirtyCheck = false;
  } else if ((state.view === "editor" && editorIsDirty()) || (state.view === "social" && socialConfigDirty())) {
    const ok = await confirmLeaveEditor();
    if (!ok) {
      // Stay put: re-arm the guard so the next swipe re-triggers this check.
      state.navigating = true;
      try {
        history.pushState(currentNavState(), "");
        state.dirtyGuardPushed = true;
      } catch (error) {
        /* ignore */
      }
      state.navigating = false;
      return;
    }
    if (guardConsumed) {
      // Still sitting on the real editor entry, not the target the user
      // actually swiped toward — one more back() reaches it. The dirty check
      // is skipped there since leaving was just confirmed.
      state.skipNextDirtyCheck = true;
      try {
        history.back();
      } catch (error) {
        /* ignore */
      }
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
