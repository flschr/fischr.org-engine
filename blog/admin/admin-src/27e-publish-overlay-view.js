// --- Publish overlay: what to show ---------------------------------------
//
// No imports, on purpose — same reason as 00-konstanten.js. This is the whole
// decision the overlay makes, and keeping it free of the element map is what
// lets it be tested without a browser. 27f-publish-overlay.js does the writing.

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
    headline: tone === "failed"
      ? "Veröffentlichung fehlgeschlagen"
      : tone === "success" ? "Veröffentlicht" : "Wird veröffentlicht",
    phase: tone === "failed"
      ? `${status?.message || "Veröffentlichung fehlgeschlagen"}. Die Änderungen bleiben in der Warteschlange.`
      : tone === "success" ? "Die Website ist auf dem neuen Stand."
        : (status?.message || "Wird bei GitHub vorgemerkt"),
    // A failure with no Actions run has no page to link to, and an empty link
    // reading "Details in GitHub öffnen" is worse than none.
    url: tone === "failed" ? status?.url || "" : ""
  };
}
