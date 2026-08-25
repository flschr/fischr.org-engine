import { currentLang, t } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { hasGithubAccess } from "./05-github-auth.js";
import { dateInputValueFromIso } from "./08-encoding.js";
import { loadSocialConfig, ruleImageCount, socialToken } from "./10-social-editor.js";
import { collectSocialConfigDraft, setSocialConfigStatus, updateSocialConfigDirty } from "./14a-social-controls.js";
import { renderSocialCategoryCards } from "./14b-social-cards.js";
import { showView } from "./23-routing.js";
import { replaceNav } from "./24-history.js";
import { updateConnectionState } from "./28-connection.js";

// --- Central social configuration ----------------------------------------
// A visual editor for automation/social-config.json. The categories here are
// the defaults the per-post panel reads and the syndication cron applies. It
// commits straight to the published branch (the config is infrastructure, not
// part of the content drafts/queue flow that publishing fast-forwards).

export function socialDeepClone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

// Canonical shape of one Beitragsart/Vorlage: id (from name), name, template,
// image count. All legacy matching fields are dropped. Pure (returns a clone).
export function normalizeRule(rule) {
  const next = { ...rule };
  next.id = next.id && next.id.trim() ? socialToken(next.id) : socialToken(next.name);
  next.name = (next.name || next.id || "").trim();
  next.template = String(next.template || "");
  const count = ruleImageCount(next);
  if (count > 0) next.images = count; else delete next.images;
  // Link on is the default — only persist the toggle when it is off.
  if (next.link === false) next.link = false; else delete next.link;
  ["includeImage", "include", "exclude", "tags", "default", "targets"].forEach((key) => delete next[key]);
  return next;
}

// The default template id, validated against the rules (else the first rule).
export function resolveDefaultTemplate(rules, chosen) {
  const id = socialToken(chosen || "");
  const valid = rules.find((rule) => rule.id === id);
  if (valid) return valid.id;
  return rules[0] ? rules[0].id : "";
}

export function normalizeSocialConfigDraft(config) {
  return window.RWSocialConfig.normalize(config, {
    clone: socialDeepClone,
    token: socialToken,
    normalizeRule,
    resolveDefaultTemplate
  });
}

export async function openSocialConfig() {
  showView("social");
  replaceNav();
  // The GitHub connection section now lives in this view — refresh its state.
  updateConnectionState();
  if (els.adminLangSelect) els.adminLangSelect.value = currentLang();
  setSocialConfigStatus(t("settings.socialLoading"), "muted");
  try {
    await loadSocialConfig(true);
  } catch {
    // loadSocialConfig already falls back to an empty config.
  }
  state.socialConfigDraft = normalizeSocialConfigDraft(state.socialConfig);
  renderSocialConfig();
  // Baseline = the canonical serialized form (from the now-populated inputs),
  // so a freshly opened config is never "dirty" until the user changes it.
  state.socialConfigLoaded = JSON.stringify(collectSocialConfigDraft());
  updateSocialConfigDirty();
  setSocialConfigStatus(hasGithubAccess() ? "" : t("settings.readOnlyNoGithub"), hasGithubAccess() ? "" : "muted");
}

export function renderSocialConfig() {
  const draft = state.socialConfigDraft;
  if (!draft) return;
  els.cfgGotosocialInstance.value = draft.social.gotosocialInstance || "";
  els.cfgMaxPostsPerRun.value = draft.maxPostsPerRun ?? "";
  els.cfgMaxAgeDays.value = draft.maxAgeDays ?? "";
  els.cfgStartAfter.value = draft.startAfter ? dateInputValueFromIso(draft.startAfter) : "";
  renderSocialCategoryCards();
  refreshDefaultCategoryOptions();
  updateSocialConfigDirty();
}

// The "Default post type" dropdown lists the current categories; its value
// is the id used when a post hasn't chosen one.
export function refreshDefaultCategoryOptions() {
  const select = els.cfgDefaultCategory;
  if (!select) return;
  const rules = state.socialConfigDraft?.social?.rules || [];
  const current = state.socialConfigDraft?.social?.defaultTemplate || "";
  select.innerHTML = "";
  rules.forEach((rule) => {
    const option = document.createElement("option");
    option.value = rule.id || socialToken(rule.name);
    option.textContent = rule.name || rule.id;
    select.appendChild(option);
  });
  const ids = rules.map((rule) => rule.id || socialToken(rule.name));
  select.value = ids.includes(current) ? current : (ids[0] || "");
}
