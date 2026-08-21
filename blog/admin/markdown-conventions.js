(function (root, factory) {
  const media = root?.RWMarkdownMedia || (typeof module === "object" && module.exports ? module.require("./markdown-media") : null);
  const api = factory(media);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWMarkdownConventions = api;
})(typeof window !== "undefined" ? window : globalThis, function (media) {

  function markdownItMark(md) {
    md.inline.ruler.before("emphasis", "mark", (state, silent) => {
      const start = state.pos;
      if (state.src.charCodeAt(start) !== 0x3d || state.src.charCodeAt(start + 1) !== 0x3d) return false;
      const contentStart = start + 2;
      const end = state.src.indexOf("==", contentStart);
      if (contentStart >= state.posMax || end < 0 || end >= state.posMax || end === contentStart) return false;
      if (silent) return true;
      const open = state.push("mark_open", "mark", 1);
      open.markup = "==";
      state.pos = contentStart;
      const oldMax = state.posMax;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = oldMax;
      state.pos = end + 2;
      const close = state.push("mark_close", "mark", -1);
      close.markup = "==";
      return true;
    });
  }

  function markdownItOptions(overrides = {}) {
    return { html: false, breaks: false, linkify: true, typographer: true, ...overrides };
  }

  return {
    markdownItMark,
    markdownItOptions,
    normalizeMediaShortcutSource: media.normalizeMediaShortcutSource,
    parseMediaShortcut: media.parseMediaShortcut
  };
});
