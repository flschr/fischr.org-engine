(function initSocialConfig(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RWSocialConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function socialConfigFactory() {
  "use strict";

  function normalize(config, helpers) {
    const draft = helpers.clone(config && typeof config === "object" ? config : {});
    if (!draft.social || typeof draft.social !== "object") draft.social = {};
    if (!Array.isArray(draft.social.rules)) draft.social.rules = [];
    delete draft.social.targets;
    draft.social.gotosocialInstance = draft.social.gotosocialInstance || draft.social.mastodonInstance || "";
    delete draft.social.mastodonInstance;

    let chosen = draft.social.defaultTemplate || draft.social.defaultCategory || "";
    if (!chosen) {
      const legacy = draft.social.rules.find((rule) => rule.default);
      if (legacy) chosen = helpers.token(legacy.id || legacy.name);
    }
    draft.social.rules = draft.social.rules.map(helpers.normalizeRule);
    delete draft.social.defaultCategory;
    const defaultTemplate = helpers.resolveDefaultTemplate(draft.social.rules, chosen);
    if (defaultTemplate) draft.social.defaultTemplate = defaultTemplate;
    else delete draft.social.defaultTemplate;

    if (!draft.stats || typeof draft.stats !== "object") draft.stats = {};
    draft.stats.enabled = draft.stats.enabled !== false;
    draft.stats.url = typeof draft.stats.url === "string" ? draft.stats.url : "";
    return draft;
  }

  function collect(base, fields, helpers) {
    const draft = helpers.clone(base || {});
    draft.social ||= {};
    draft.social.gotosocialInstance = fields.gotosocialInstance.trim();
    delete draft.social.mastodonInstance;
    delete draft.social.targets;

    setOptionalNumber(draft, "maxPostsPerRun", fields.maxPostsPerRun);
    setOptionalNumber(draft, "maxAgeDays", fields.maxAgeDays);
    if (fields.startAfter) draft.startAfter = fields.startAfter;
    else delete draft.startAfter;

    draft.social.rules = (draft.social.rules || []).map(helpers.normalizeRule);
    delete draft.social.defaultCategory;
    const defaultTemplate = helpers.resolveDefaultTemplate(draft.social.rules, fields.defaultTemplate);
    if (defaultTemplate) draft.social.defaultTemplate = defaultTemplate;
    else delete draft.social.defaultTemplate;

    draft.stats ||= {};
    draft.stats.enabled = fields.statsEnabled;
    if (fields.statsUrl) draft.stats.url = fields.statsUrl;
    else delete draft.stats.url;
    return draft;
  }

  function setOptionalNumber(target, key, value) {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed)) target[key] = parsed;
    else delete target[key];
  }

  return { normalize, collect };
});
