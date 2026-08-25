import { t } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { hasGithubAccess, requireGithubAccess } from "./05-github-auth.js";
import { loadSocialConfig } from "./10-social-editor.js";
import { normalizeSocialConfigDraft } from "./14-social-settings.js";
import { commitSocialConfig } from "./14a-social-controls.js";

// --- Pause social syndication from the Sync view --------------------------
//
// Deliberately separate from automation/social-config.json's Settings form
// (14-social-settings.js): this is a single, standalone switch you reach for
// right before a planned bulk operation — e.g. renaming a batch of post
// slugs, which automation/social-posts.json can't follow (it's keyed by
// URL, see docs/social.md) — not a field in a longer draft/save/reset form.
// It commits straight away, like every other write to that file.
//
// A button, not a checkbox: it has to say what it's doing right now (Active/
// Paused), not just whether it's ticked — aria-pressed carries the on/off
// state for assistive tech, the icon shows the action a click takes (pause
// while active, play while paused), and the visible label always names the
// current state.

function applySocialSyncButtonState(active) {
  const button = els.socialSyncToggleButton;
  if (!button) return;
  button.classList.toggle("is-paused", !active);
  button.setAttribute("aria-pressed", String(active));
  const label = t(active ? "queue.socialSyncActiveLabel" : "queue.socialSyncPausedLabel");
  const aria = t(active ? "queue.socialSyncActiveAria" : "queue.socialSyncPausedAria");
  if (els.socialSyncToggleLabel) els.socialSyncToggleLabel.textContent = label;
  if (els.socialSyncToggleIcon) {
    els.socialSyncToggleIcon.dataset.icon = active ? "pause" : "play";
    window.RWIcons?.setIcon(els.socialSyncToggleIcon, active ? "pause" : "play");
  }
  button.setAttribute("aria-label", aria);
  button.title = aria;
}

export async function refreshSocialSyncToggle() {
  const button = els.socialSyncToggleButton;
  if (!button) return;
  // loadSocialConfig() never throws — on a failed fetch it quietly falls back
  // to {} instead. state.socialConfigSha is only ever set by a genuinely
  // successful load, so it's what tells the two functions here apart from a
  // stub: without it, state.socialConfig may not be the real file at all, and
  // writing it back (toggleSocialSync) would silently wipe the whole config.
  //
  // Forced whenever that hasn't happened yet (`!state.socialConfigSha`): a
  // plain unforced call is a cache hit against loadSocialConfig()'s {}
  // fallback forever after a single transient failure — the button would stay
  // disabled for the rest of the session instead of retrying on the next
  // Sync-view visit. Once a load has genuinely succeeded, later opens stay
  // cheap (no repeat fetch) exactly as before.
  if (hasGithubAccess()) await loadSocialConfig(!state.socialConfigSha);
  applySocialSyncButtonState(state.socialConfig?.social?.enabled !== false);
  button.disabled = !state.socialConfigSha || !hasGithubAccess();
}

export async function toggleSocialSync() {
  const button = els.socialSyncToggleButton;
  if (!button) return;
  const wasActive = button.getAttribute("aria-pressed") !== "false";
  const wantEnabled = !wasActive;
  if (!requireGithubAccess(t("action.savingSettings"))) return;
  if (!state.socialConfigSha) {
    showStatus(t("queue.socialSyncLoadFailed"), "error");
    return;
  }
  button.disabled = true;
  try {
    // normalizeSocialConfigDraft (not a plain clone): the same cleanup every
    // other write to this file goes through, so a stray legacy field sitting
    // in state.socialConfig can't round-trip back out through this shorter path.
    const next = normalizeSocialConfigDraft(state.socialConfig || {});
    next.social ||= {};
    if (wantEnabled) delete next.social.enabled;
    else next.social.enabled = false;
    await commitSocialConfig(next);
    applySocialSyncButtonState(wantEnabled);
    showStatus(t(wantEnabled ? "queue.socialSyncResumed" : "queue.socialSyncPaused"));
    button.disabled = false;
  } catch (error) {
    // A conflict means someone else's commit already changed this file after
    // state.socialConfigSha was captured — that sha is now provably stale, but
    // commitSocialConfig() only ever updates it on success, so it's still
    // sitting at the old value. Clear it before re-syncing: refreshSocialSyncToggle()
    // only force-reloads when the sha is falsy, and a cache hit against the
    // same stale config here would just fail the same way again on retry.
    state.socialConfigSha = "";
    showStatus(t("settings.saveFailed", { error: error.message }), "error");
    await refreshSocialSyncToggle();
  }
}
