import { repo } from "./00-konstanten.js";
import { t } from "./00a-i18n.js";
import { draftRepository, socialConfigPath } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { hasGithubAccess, requireGithubAccess } from "./05-github-auth.js";
import { isoFromDateInputValue } from "./08-encoding.js";
import { normalizeRule, normalizeSocialConfigDraft, refreshDefaultCategoryOptions, renderSocialConfig, resolveDefaultTemplate, socialDeepClone } from "./14-social-settings.js";
import { markSocialCategoryOpen, renderSocialCategoryCards } from "./14b-social-cards.js";

export function textControl(value, onInput, placeholder) {
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

export function iconGhostButton(icon, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `<span data-icon="${icon}" aria-hidden="true"></span>`;
  window.RWIcons?.inject(button);
  return button;
}

export function removeSocialCategory(index) {
  state.socialConfigDraft.social.rules.splice(index, 1);
  renderSocialCategoryCards();
  refreshDefaultCategoryOptions();
  updateSocialConfigDirty();
}

export function addSocialCategory() {
  const rule = { id: "", name: "Neuer Beitragstyp", template: "{title}" };
  state.socialConfigDraft.social.rules.push(rule);
  // Open by default: every other card starts collapsed, but this one was
  // just created and has nothing to hide yet — collapsing it immediately
  // would hide the very fields you're about to fill in.
  markSocialCategoryOpen(rule);
  renderSocialCategoryCards();
  refreshDefaultCategoryOptions();
  updateSocialConfigDirty();
  // Focus + reveal the new (last) card's name field.
  const names = els.socialCategoryList.querySelectorAll(".social-category-name");
  const last = names[names.length - 1];
  last?.scrollIntoView?.({ block: "nearest" });
  last?.focus?.();
}

// Build the canonical config from the live draft + current inputs WITHOUT
// mutating state (safe to call from the dirty predicate / on every keystroke).
export function collectSocialConfigDraft() {
  return window.RWSocialConfig.collect(state.socialConfigDraft, {
    gotosocialInstance: els.cfgGotosocialInstance.value,
    maxAgeDays: els.cfgMaxAgeDays.value,
    startAfter: els.cfgStartAfter.value.trim() ? isoFromDateInputValue(els.cfgStartAfter.value.trim()) : "",
    defaultTemplate: els.cfgDefaultCategory?.value || ""
  }, {
    clone: socialDeepClone,
    normalizeRule,
    resolveDefaultTemplate
  });
}

export function socialConfigDirty() {
  if (!state.socialConfigDraft) return false;
  return JSON.stringify(collectSocialConfigDraft()) !== state.socialConfigLoaded;
}

export function updateSocialConfigDirty() {
  const dirty = socialConfigDirty();
  const canSave = dirty && hasGithubAccess() && !state.isBusy;
  els.socialConfigSave.disabled = !canSave;
  els.socialConfigReset.disabled = !dirty || state.isBusy;
  if (dirty) setSocialConfigStatus(t("dialog.unsavedChanges"), "pending");
  else if (hasGithubAccess()) setSocialConfigStatus(t("settings.saved"), "ok");
}

export function setSocialConfigStatus(text, tone) {
  if (!els.socialConfigStatus) return;
  els.socialConfigStatus.textContent = text || "";
  els.socialConfigStatus.dataset.tone = tone || "";
}

export function resetSocialConfig() {
  if (!state.socialConfigDraft) return;
  state.socialConfigDraft = normalizeSocialConfigDraft(JSON.parse(state.socialConfigLoaded));
  renderSocialConfig();
  setSocialConfigStatus(t("settings.reset"), "muted");
}

// Commit a single text file straight onto the published branch, retrying if the branch
// head moved (mirrors commitToDrafts, but targets main and leaves the cached drafts tree
// alone — nothing on main belongs to it). Returns the new blob's sha so the caller can
// track what it just wrote.
async function commitFileToPublished(path, content, message, expectedBlobs) {
  const blob = await draftRepository.createBlob(content);
  const entry = { path, mode: "100644", type: "blob", sha: blob.sha };
  await draftRepository.commit([entry], message, { branch: repo.publishBranch, expectedBlobs });
  return blob.sha;
}

// Shared by the Settings form's Save button and the Sync view's standalone
// social-sync toggle (27f-social-sync-toggle.js) — both commit the whole
// config file straight to main, just built from a different source (the
// Settings draft vs. state.socialConfig with only `enabled` flipped).
//
// Two independent, uncoordinated writers of the same file need the same
// compare-and-swap every other writer of shared state already gets
// (04a-draft-writes.js, 25a-entry-actions.js, ...): expectedBlobs makes a
// commit built from a config one of them already knows is stale fail loudly
// (DRAFT_CONFLICT) instead of silently overwriting what the other just wrote.
export async function commitSocialConfig(config, message = "Update social config [skip ci]") {
  const content = `${JSON.stringify(config, null, 2)}\n`;
  const expectedBlobs = state.socialConfigSha ? { [socialConfigPath]: state.socialConfigSha } : null;
  state.socialConfigSha = await commitFileToPublished(socialConfigPath, content, message, expectedBlobs);
  state.socialConfig = JSON.parse(content);
  return state.socialConfig;
}

export async function saveSocialConfig() {
  if (!requireGithubAccess(t("action.savingSettings"))) return;
  if (!socialConfigDirty()) return;
  // Without a confirmed successful load, the draft this would serialize could
  // be built on loadSocialConfig()'s {} fallback (it never throws — see
  // openSocialConfig()) rather than the real file: committing it would wipe
  // automation/social-config.json instead of updating it. Same guard as the
  // Sync view's standalone toggle (27f-social-sync-toggle.js).
  if (!state.socialConfigSha) {
    showStatus(t("queue.socialSyncLoadFailed"), "error");
    setSocialConfigStatus(t("settings.errorSaving"), "off");
    return;
  }
  setBusy(true);
  setSocialConfigStatus(t("settings.saving"), "muted");
  try {
    await commitSocialConfig(collectSocialConfigDraft());
    // Adopt the saved config as the new baseline + refresh the per-post catalog.
    state.socialConfigDraft = normalizeSocialConfigDraft(state.socialConfig);
    renderSocialConfig();
    // Use the same canonical representation as socialConfigDirty(): the
    // normalized draft may carry optional keys that collectSocialConfigDraft()
    // intentionally omits.
    state.socialConfigLoaded = JSON.stringify(collectSocialConfigDraft());
    // Settings can change fields stats rendering reads (e.g. siteUrl, used for
    // outbound links in 21a-stats-details.js) — the toggle in 27f never can,
    // it only flips `enabled`, so this stays here rather than in the shared
    // commitSocialConfig().
    state.statsCache.clear();
    showStatus(t("settings.savedToast"));
    setSocialConfigStatus(t("settings.saved"), "ok");
  } catch (error) {
    showStatus(t("settings.saveFailed", { error: error.message }), "error");
    setSocialConfigStatus(t("settings.errorSaving"), "off");
  } finally {
    setBusy(false);
    updateSocialConfigDirty();
  }
}

export async function copyText(value) {
  const text = String(value || "");
  if (!text) throw new Error("Nichts zu kopieren.");

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      // Fall back to a temporary textarea for browsers that block Clipboard.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) throw new Error("Clipboard not available.");
  } finally {
    textarea.remove();
  }
}
