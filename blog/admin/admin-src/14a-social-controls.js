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
    maxPostsPerRun: els.cfgMaxPostsPerRun.value,
    maxAgeDays: els.cfgMaxAgeDays.value,
    startAfter: els.cfgStartAfter.value.trim() ? isoFromDateInputValue(els.cfgStartAfter.value.trim()) : "",
    defaultTemplate: els.cfgDefaultCategory?.value || ""
  }, {
    clone: socialDeepClone,
    normalizeRule,
    resolveDefaultTemplate
  });
}

function socialConfigSerialized() {
  return `${JSON.stringify(collectSocialConfigDraft(), null, 2)}\n`;
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
// alone — nothing on main belongs to it).
async function commitFileToPublished(path, content, message) {
  const blob = await draftRepository.createBlob(content);
  const entry = { path, mode: "100644", type: "blob", sha: blob.sha };
  const result = await draftRepository.commit([entry], message, { branch: repo.publishBranch });
  return result.commitSha;
}

export async function saveSocialConfig() {
  if (!requireGithubAccess(t("action.savingSettings"))) return;
  if (!socialConfigDirty()) return;
  const content = socialConfigSerialized();
  setBusy(true);
  setSocialConfigStatus(t("settings.saving"), "muted");
  try {
    await commitFileToPublished(socialConfigPath, content, "Update social config [skip ci]");
    // Adopt the saved config as the new baseline + refresh the per-post catalog.
    state.socialConfig = JSON.parse(content);
    state.socialConfigDraft = normalizeSocialConfigDraft(state.socialConfig);
    renderSocialConfig();
    // Use the same canonical representation as socialConfigDirty(): the
    // normalized draft may carry optional keys that collectSocialConfigDraft()
    // intentionally omits.
    state.socialConfigLoaded = JSON.stringify(collectSocialConfigDraft());
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
