(function (root, factory) {
  const media = root?.RWMarkdownMedia || (typeof module === "object" && module.exports ? module.require("./markdown-media") : null);
  const admonitions = root?.RWAdmonitions || (typeof module === "object" && module.exports ? module.require("./admonitions") : null);
  const api = factory(media, admonitions);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWMarkdownConventions = api;
})(typeof window !== "undefined" ? window : globalThis, function (media, admonitions) {

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

  function markdownItAdmonitions(md) {
    md.renderer.rules.admonition_icon = (tokens, index) => {
      const type = admonitions.findType(tokens[index].meta.type);
      return `<svg class="admonition-icon" aria-hidden="true" focusable="false" viewBox="0 0 16 16"><path d="${type.icon}"></path></svg>`;
    };

    md.core.ruler.after("block", "admonitions", (state) => {
      const tokens = state.tokens;
      for (let index = 0; index < tokens.length; index += 1) {
        if (tokens[index].type !== "blockquote_open") continue;

        const paragraph = tokens[index + 1];
        const inline = tokens[index + 2];
        if (paragraph?.type !== "paragraph_open" || inline?.type !== "inline") continue;

        const match = inline.content.match(/^\[!([A-Z][A-Z0-9_-]*)\]\n\*\*(.+)\*\*$/s);
        if (!match || match[2].includes("\n")) continue;

        const type = admonitions.findType(match[1]);
        if (!type) continue;

        let depth = 1;
        let closeIndex = index + 1;
        while (closeIndex < tokens.length && depth > 0) {
          if (tokens[closeIndex].type === "blockquote_open") depth += 1;
          if (tokens[closeIndex].type === "blockquote_close") depth -= 1;
          closeIndex += 1;
        }
        if (depth !== 0) continue;

        const titleChildren = state.md.parseInline(match[2], state.env)[0]?.children || [];
        tokens[index].tag = "aside";
        tokens[index].attrJoin("class", `admonition admonition-${type.className}`);
        tokens[index].attrSet("role", "note");
        tokens[index].attrSet("aria-label", admonitions.labelFor(type, state.env?.lang));
        tokens[closeIndex - 1].tag = "aside";
        paragraph.attrJoin("class", "admonition-title");
        const icon = new state.Token("admonition_icon", "svg", 0);
        icon.meta = { type: match[1] };
        inline.children = [icon, ...titleChildren];
        inline.content = "";
      }
    });
  }

  function markdownItOptions(overrides = {}) {
    return { html: false, breaks: false, linkify: true, typographer: true, ...overrides };
  }

  return {
    markdownItAdmonitions,
    markdownItMark,
    markdownItOptions,
    normalizeMediaShortcutSource: media.normalizeMediaShortcutSource,
    parseMediaShortcut: media.parseMediaShortcut
  };
});
