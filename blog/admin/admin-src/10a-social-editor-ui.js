import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { SOCIAL_OFF, loadSocialConfig, socialDefaultRule, socialRuleById, socialRules, socialToken } from "./10-social-editor.js";
import { syncImageControls } from "./11-social-images.js";
import { updateSocialPanel } from "./13-publish-dialog.js";
import { captureEditorSnapshot, editorSnapshot } from "./18-snapshots.js";
import { collectEditorFields } from "./20a-editor-field-actions.js";

export function populateSocialCategoryOptions() {
  const select = els.categorySelect;
  if (!select) return;
  const explicit = state.current?.socialTemplate || "";
  const explicitRule = socialRuleById(explicit);
  select.innerHTML = "";
  // "Default" = no explicit category; the post follows the configured default
  // and nothing is written to its frontmatter.
  const standard = document.createElement("option");
  standard.value = "";
  const def = socialDefaultRule();
  const defId = def ? (def.id || socialToken(def.name)) : "";
  standard.textContent = def ? `Default (${def.name})` : "Default";
  select.appendChild(standard);
  const explicitTok = socialToken(explicit);
  socialRules().forEach((rule) => {
    const id = rule.id || socialToken(rule.name);
    // The default is already offered as "Default (…)" — don't list it twice.
    // Keep it only if this post is explicitly pinned to it (value round-trips).
    if (id === defId && explicitTok !== defId) return;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = rule.name || rule.id;
    select.appendChild(option);
  });
  // Opt-out entry at the foot of the list.
  const off = document.createElement("option");
  off.value = SOCIAL_OFF;
  off.textContent = "Don't share";
  select.appendChild(off);

  // syndicate:false → show "Don't share" regardless of any stored template.
  if (state.current?.socialSyndicate === false) {
    select.value = SOCIAL_OFF;
    return;
  }
  // Preserve an explicit category whose id was removed from the catalog,
  // rather than silently switching the post to something else.
  if (explicit && !explicitRule) {
    const orphan = document.createElement("option");
    orphan.value = explicit;
    orphan.textContent = `${explicit} (entfernt)`;
    select.appendChild(orphan);
    select.value = explicit;
    return;
  }
  // Explicit pick → its canonical id; otherwise "" (Standard).
  select.value = explicitRule ? (explicitRule.id || socialToken(explicitRule.name)) : "";
}

// Populate the publish dialog's controls for the current post. Called on fill
// (so collectEditorFields can read them even if the dialog is never opened)
// and refreshed once the catalog loads.
export function initSocialPanel() {
  if (!els.publishDialog || state.current?.collection !== "posts") return;
  populateSocialCategoryOptions();
  syncImageControls();
  updateSocialPanel();
  if (!state.socialConfig) {
    const entry = state.current;
    loadSocialConfig().then(() => {
      if (state.current !== entry || state.current?.collection !== "posts") return;
      const wasClean = state.savedSnapshot === editorSnapshot();
      populateSocialCategoryOptions();
      syncImageControls();
      updateSocialPanel();
      if (wasClean) captureEditorSnapshot();
    });
  }
}

export function onCategoryChange() {
  if (state.current) {
    const off = els.categorySelect.value === SOCIAL_OFF;
    state.current.socialSyndicate = !off;
    // Keep the last real template when toggling to "Don't share" so flipping
    // back doesn't lose the pick; the sentinel never becomes a template id.
    if (!off) state.current.socialTemplate = els.categorySelect.value;
  }
  // A different template can change the default image count, so the strip's
  // pre-selection (when the post still follows the template) must redraw.
  syncImageControls();
  updateSocialPanel();
}
