import { t } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { publishOverlayView } from "./27e-publish-overlay-view.js";

// --- Publish overlay -----------------------------------------------------
//
// Publishing now starts from wherever you were — usually the editor, right
// after Save. The progress lived only in the queue view, so the one moment you
// most want to watch happened on a screen you were not on. This card follows
// the publish instead.
//
// It shows two things and no more: how far along it is, and which step is
// running. The runner-wait / preparation / validation / deployment breakdown
// stays in the queue view, where it exists to diagnose a slow publish. Here it
// was four numbers moving at once for someone who just wants to see it land.
//
// It deliberately does not block. Nothing here needs an answer, and a modal
// would trap you in the editor for the two minutes it runs.

// r=34 in an 80×80 box; the ring is drawn from its own circumference, so the
// two numbers cannot drift apart.
const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// How long a finished publish stays before it clears itself. Long enough to
// read "Veröffentlicht", short enough not to need a dismiss button.
const SUCCESS_LINGER_MS = 4000;

let nodes = null;
let hideTimer = 0;
// The success status object already shown and timed out; see the guard in
// publishOverlayView(), which stops it from being announced a second time.
let dismissed = null;

// Built once and then only updated. Replacing innerHTML on every poll would
// hand the browser a new <circle> each time, and a brand-new element has
// nothing to transition from — the ring would jump between the 17 steps
// instead of gliding.
function ensureNodes(overlay) {
  if (nodes) return nodes;
  overlay.innerHTML = [
    '<div class="publish-ring-wrap">',
    '<svg class="publish-ring" viewBox="0 0 80 80" aria-hidden="true">',
    `<circle class="publish-ring-track" cx="40" cy="40" r="${RADIUS}"></circle>`,
    `<circle class="publish-ring-value" cx="40" cy="40" r="${RADIUS}" stroke-dasharray="${CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${CIRCUMFERENCE.toFixed(2)}"></circle>`,
    "</svg>",
    '<span class="publish-ring-label" aria-hidden="true"></span>',
    "</div>",
    '<div class="publish-overlay-text">',
    '<strong class="publish-overlay-headline"></strong>',
    '<span class="publish-overlay-phase" role="status" aria-live="polite"></span>',
    `<a class="publish-overlay-link" target="_blank" rel="noopener noreferrer" hidden>${t("queue.openInGithub")}</a>`,
    "</div>"
  ].join("");
  nodes = {
    ring: overlay.querySelector(".publish-ring-value"),
    ringLabel: overlay.querySelector(".publish-ring-label"),
    headline: overlay.querySelector(".publish-overlay-headline"),
    phase: overlay.querySelector(".publish-overlay-phase"),
    link: overlay.querySelector(".publish-overlay-link")
  };
  return nodes;
}

export function renderPublishOverlay() {
  const overlay = els.publishOverlay;
  if (!overlay) return;

  // Resolved here, not left for publishOverlayView() to read: that module stays
  // import-free on purpose (see 27e-publish-overlay-view.js), so it only wraps
  // an already-final message string, never a key. Mutated in place rather than
  // wrapped in a new object — the "success" dismissed check further down
  // compares this exact status object by reference, and a fresh copy on every
  // render would make that comparison never match, so the overlay would never
  // stop reappearing after being dismissed.
  if (state.publishStatus?.messageKey) {
    state.publishStatus.message = t(state.publishStatus.messageKey, state.publishStatus.messageVars);
  }

  const view = publishOverlayView({
    publishInFlight: state.publishInFlight,
    status: state.publishStatus,
    view: state.view,
    dismissed
  });

  if (!view.visible) {
    overlay.hidden = true;
    return;
  }

  const { ring, ringLabel, headline, phase, link } = ensureNodes(overlay);

  overlay.dataset.tone = view.tone;
  overlay.classList.toggle("is-indeterminate", view.indeterminate);
  overlay.hidden = false;

  ring.setAttribute("stroke-dashoffset", (view.progress == null ? CIRCUMFERENCE * 0.75 : CIRCUMFERENCE * (1 - view.progress)).toFixed(2));
  ringLabel.textContent = view.ringLabel;
  headline.textContent = t(view.headlineKey);
  phase.textContent = view.phaseKey ? t(view.phaseKey, view.phaseVars) : (view.phase || "");
  // Re-set every render, not just in ensureNodes(): the link text is otherwise
  // baked into the cached DOM at first build and would stay frozen in whatever
  // language was active then, the same bug class the rest of this round fixed.
  link.textContent = t("queue.openInGithub");
  link.hidden = !view.url;
  if (view.url) link.href = view.url;

  // A finished publish clears itself; a failed one stays, because it names
  // something that still has to be dealt with.
  window.clearTimeout(hideTimer);
  if (view.tone === "success") {
    const shown = state.publishStatus;
    hideTimer = window.setTimeout(() => {
      overlay.hidden = true;
      dismissed = shown;
    }, SUCCESS_LINGER_MS);
  }
}
