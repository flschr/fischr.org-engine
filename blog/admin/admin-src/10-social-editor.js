import { repo } from "./00-konstanten.js";
import { github, socialConfigPath } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { encodePath } from "./05-github-auth.js";
import { decodeBase64, slugify } from "./08-encoding.js";

// --- Social panel --------------------------------------------------------
// The category catalog lives in automation/social-config.json. We read it from
// the published branch so the editor shows the same defaults the syndication
// cron will use. It loads best-effort: without it the panel still lets you set
// a custom text, it just can't preview the category default.

export async function loadSocialConfig(force) {
  if (!force && state.socialConfig) return state.socialConfig;
  if (state.socialConfigPromise) return state.socialConfigPromise;
  state.socialConfigPromise = (async () => {
    try {
      const payload = await github(`contents/${encodePath(socialConfigPath)}?ref=${encodeURIComponent(repo.publishBranch)}`);
      const json = JSON.parse(decodeBase64(payload.content || ""));
      state.socialConfig = json && typeof json === "object" ? json : {};
      state.socialConfigSha = payload.sha || "";
    } catch {
      if (!state.socialConfig) state.socialConfig = {};
    } finally {
      state.socialConfigPromise = null;
    }
    return state.socialConfig;
  })();
  return state.socialConfigPromise;
}

export function socialRules() {
  return Array.isArray(state.socialConfig?.social?.rules) ? state.socialConfig.social.rules : [];
}

// Stable id from a name (mirrors publish-utils' normalizeToken) so the editor
// and the cron resolve a category to the same id.
export function socialToken(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function socialRuleById(id) {
  if (!id) return null;
  return socialRules().find((rule) => socialToken(rule.id || rule.name) === socialToken(id)) || null;
}

// Default image count for a category (mirrors publish-utils' ruleImageCount).
export function ruleImageCount(rule) {
  if (rule && Number.isFinite(rule.images)) return Math.max(0, Math.min(4, rule.images));
  return rule && rule.includeImage ? 1 : 0;
}

// The Beitragsart that applies to this post \u2014 the picker always holds a
// concrete id, so this is just a lookup.
// The Beitragsart whose template/images actually apply: the explicitly chosen
// one, else the configured default (the picker's "" = Standard).
export function socialEffectiveRule() {
  return socialRuleById(els.categorySelect.value) || socialDefaultRule();
}

// The configured default Beitragsart, used when a post hasn't chosen one.
export function socialDefaultRule() {
  return socialRuleById(state.socialConfig?.social?.defaultTemplate || state.socialConfig?.social?.defaultCategory) || socialRules()[0] || null;
}

export function socialFillTemplate(template, content) {
  const slug = els.slugInput.value || slugify(els.titleInput.value || "");
  const url = `${(state.socialConfig?.siteUrl || "https://mysite.example").replace(/\/$/, "")}/${slug}/`;
  return String(template || "")
    .replaceAll("{title}", els.titleInput.value || "")
    .replaceAll("{link}", url)
    .replaceAll("{content}", content || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A light clean of the post body for the {content} preview — mirrors the
// engine's cleanContent intent (strip markdown), enough to be representative.
export function socialBodyExcerpt() {
  return socialPlainText(state.bodyMarkdown || "")
    .replace(/\s+/g, " ")
    .trim();
}

// Keep link destinations while removing Markdown syntax, just like the
// publisher. Plain URLs remain clickable on GoToSocial.
function socialPlainText(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_match, label, url) =>
      label === url ? url : `${label} (${url})`
    )
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`>]+/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Mirror publish-utils ruleWantsLink/applyLinkToggle: a template links back by
// default; `link: false` makes a native, linkless post.
export function socialRuleWantsLink(rule) {
  return !(rule && rule.link === false);
}
export function socialApplyLinkToggle(template, wantsLink) {
  const text = String(template || "");
  if (!wantsLink) return text.replace(/\{link\}/g, "");
  if (/\{link\}/.test(text)) return text;
  // Append inline (a space, not a blank line) so it reads "…text. <link>".
  return text.trim() ? `${text.trimEnd()} {link}` : "{link}";
}

// Mirror renderPostText: a plain custom text becomes "{content} {link}" (or
// just "{content}" for a linkless template); a custom text with placeholders is
// treated as a full template; otherwise the category template is used (with the
// link toggle applied). {content} is filled with the post body so the preview
// matches what the engine actually posts.
export function socialEffectiveText(rule) {
  const wantsLink = socialRuleWantsLink(rule);
  const custom = els.socialTextInput.value.trim();
  if (custom) {
    const plainCustom = socialPlainText(custom);
    if (/\{link\}/.test(plainCustom)) return socialFillTemplate(plainCustom, socialBodyExcerpt());
    return socialFillTemplate(wantsLink ? "{content} {link}" : "{content}", plainCustom);
  }
  return rule ? socialFillTemplate(socialApplyLinkToggle(rule.template, wantsLink), socialBodyExcerpt()) : "";
}

// Sentinel value for the "Don't share" entry in the share <select>. Picking it
// is how a post opts out of syndication (replaces the old separate checkbox).
export const SOCIAL_OFF = "__off__";
