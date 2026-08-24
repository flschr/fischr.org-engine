// --- What the send button offers -----------------------------------------
//
// No imports, on purpose — same reason as 00-konstanten.js and
// 27e-publish-overlay-view.js. The whole decision lives here so it can be
// tested without a browser, and so the bar and the label can never disagree
// about what the button is for.
//
// Since saving only ever writes to `drafts`, sending is the single deliberate
// act that changes the public site. That makes its absence meaningful too: on
// an article that is already public and has nothing waiting, there is nothing
// to send, and a button that would do nothing is worse than no button — it
// invites a click and then has to explain itself.

export function publishAffordance({
  collection = "posts",
  published = false,
  draftIntent = false,
  hasQueuedChange = false,
  editorDirty = false,
  sourceMode = false
} = {}) {
  // Raw templates are saved, never published as their own act.
  if (sourceMode) return { visible: false, action: null, label: "" };

  // Pages have no draft/published distinction to speak of; their send button
  // behaves like it always did.
  if (collection !== "posts") {
    return { visible: true, action: draftIntent ? "publish" : "sync-publish", label: "Veröffentlichen" };
  }

  if (!published) {
    // Nothing is live yet, so the button is the only way anything becomes live
    // — it stays offered even on an untouched draft.
    return {
      visible: true,
      action: draftIntent ? "publish" : "sync-publish",
      label: "Veröffentlichen"
    };
  }

  // Already public. Only an actual difference is worth sending: an edit sitting
  // in the queue, or one still in the editor. Sending covers both — it saves
  // first and publishes after.
  if (!hasQueuedChange && !editorDirty) {
    return { visible: false, action: null, label: "" };
  }

  return { visible: true, action: "sync-publish", label: "Änderung veröffentlichen" };
}
