// --- Publish overlay: what to show ---------------------------------------
//
// No imports, on purpose — same reason as 00-konstanten.js. This is the whole
// decision the overlay makes, and keeping it free of the element map is what
// lets it be tested without a browser. 27f-publish-overlay.js does the writing.
//
// headlineKey/phaseKey are i18n keys, not resolved text — same "return a key,
// let the caller translate" contract as 20c-publish-affordance.js, for the
// same reason: no t() import here without giving up the browser-free test.
// status.message is the one exception: 27f-publish-overlay.js resolves it
// from state.publishStatus (which itself carries messageKey/messageVars, see
// 27a-publish-state.js) before calling in here, so by the time it arrives
// it's already plain, final text — this module only wraps it.

// What the card should say, derived from nothing but the publish status. Kept
// pure and exported so the shapes `publish-status.js` can hand us are covered
// by tests rather than by hoping.
//
// Phases are optional in three different situations, and all three have to end
// up somewhere sensible:
//   * no run accepted yet          → { state: "queued", message }
//   * a step is running            → phaseIndex + phaseCount
//   * the workflow declined to build (stale head) or was cancelled
//                                  → { state: "failed", message }, no run at all
// The last one is a *terminal* state without phases, which only became possible
// with the endpoint-started publish. Reading progress off it must not produce
// NaN, and must not leave the ring spinning as though work were still going on.
export function publishOverlayView({ publishInFlight, status, view, dismissed } = {}) {
  const tone = publishInFlight
    ? "running"
    : status?.state === "failed" ? "failed" : status?.state === "success" ? "success" : null;

  // The queue view already carries all of this in its own card; a second copy
  // floating over it would be the same sentence twice.
  if (!tone || view === "queue") return { visible: false };

  // A finished publish is announced once. Nothing ever clears
  // `state.publishStatus` back to null, and renderSyncState() runs on every
  // save, so without this the card would pop up again saying "Veröffentlicht"
  // hours later, for a publish that happened long ago. `dismissed` is the exact
  // status object already shown — a later publish is a new object and shows
  // again.
  if (tone === "success" && status && status === dismissed) return { visible: false };

  const { phaseIndex, phaseCount } = status || {};
  const measured = phaseIndex == null || !phaseCount
    ? null
    : Math.min(1, Math.max(0, phaseIndex / phaseCount));
  const progress = tone === "success" ? 1 : tone === "failed" ? null : measured;

  return {
    visible: true,
    tone,
    progress,
    // Only a running publish with no reported step spins. A failed one is over,
    // whether or not it ever produced a phase to report.
    indeterminate: tone === "running" && progress == null,
    ringLabel: tone === "failed" ? "!" : progress == null ? "" : `${Math.round(progress * 100)}%`,
    headlineKey: tone === "failed"
      ? "queue.publishFailedGeneric"
      : tone === "success" ? "queue.publishedHeadline" : "queue.publishingHeadline",
    // "failed"/"success" wrap a fixed sentence around (or replace) the status
    // message, so they need a key + var; "running" just shows the status
    // message as-is (already resolved by the caller), no key needed.
    phaseKey: tone === "failed" ? "queue.overlayFailedPhase" : tone === "success" ? "queue.siteUpToDate" : null,
    phaseVars: tone === "failed" ? { message: status?.message || "" } : undefined,
    phase: tone === "running" ? status?.message : undefined,
    // A failure with no Actions run has no page to link to, and an empty link
    // is worse than none.
    url: tone === "failed" ? status?.url || "" : ""
  };
}
