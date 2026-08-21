(function (root, factory) {
  const conventions = root?.RWMarkdownConventions || (typeof module === "object" && module.exports ? module.require("./markdown-conventions") : null);
  const api = factory(conventions, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWPreviewRenderer = api;
})(typeof window !== "undefined" ? window : globalThis, function (conventions, root) {
  const MarkdownIt = typeof root?.markdownit === "function"
    ? root.markdownit
    : (typeof module === "object" && module.exports ? module.require("markdown-it") : null);
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function decodeHtmlEntities(value) {
    const named = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
    return String(value || "").replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (match, entity) => {
      if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      } catch {
        return match;
      }
    });
  }

  function safeUrl(value, { allowRelative = true } = {}) {
    const raw = String(value || "").trim().replace(/^<|>$/g, "");
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return "";
    if (allowRelative && /^(?:\/|\.\/|\.\.\/|#)/.test(raw)) return raw;
    try {
      const url = new URL(raw);
      return /^(?:https?):$/.test(url.protocol) ? url.toString() : "";
    } catch {
      return allowRelative && !/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "";
    }
  }

  function inline(value) {
    const refs = [];
    const source = String(value || "").replace(
      /<sup class="footnote-ref" id="fnref-(\d+)"><a href="#fn-\1">\1<\/a><\/sup>/gi,
      (_match, number) => {
        const token = `@@RW_FOOTNOTE_REF_${refs.length}@@`;
        refs.push(`<sup class="footnote-ref" id="fnref-${number}"><a href="#fn-${number}">${number}</a></sup>`);
        return token;
      }
    );
    let html = escapeHtml(source);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => {
      const url = safeUrl(href);
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    });
    html = html.replace(/==([^=\n][\s\S]*?)==/g, "<mark>$1</mark>");
    html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return html.replace(/\n/g, "<br>").replace(
      /@@RW_FOOTNOTE_REF_(\d+)@@/g,
      (_match, index) => refs[Number(index)] || ""
    );
  }

  function renderFootnotes(raw) {
    const items = [];
    const itemPattern = /<li id="fn-(\d+)"><p>([\s\S]*?)<a class="footnote" href="#fnref-\1">[^<]*<\/a><\/p><\/li>/gi;
    let match;
    while ((match = itemPattern.exec(raw))) {
      const number = match[1];
      const tokens = [];
      let text = String(match[2]);
      const token = (html) => {
        const value = `@@RW_FOOTNOTE_INLINE_${tokens.length}@@`;
        tokens.push(html);
        return value;
      };
      text = text.replace(/<(\/)?(strong|em|code|del|mark)\s*>/gi, (_tag, closing, name) =>
        token(`<${closing ? "/" : ""}${name.toLowerCase()}>`)
      );
      text = text.replace(/<a\s+href=(["'])(.*?)\1\s*>/gi, (_tag, _quote, href) => {
        const url = safeUrl(decodeHtmlEntities(href));
        return url ? token(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">`) : "";
      });
      text = text.replace(/<\/a\s*>/gi, () => token("</a>"));
      text = text.replace(/<br\s*\/?>/gi, () => token("<br>"));
      text = decodeHtmlEntities(text.replace(/<[^>]*>/g, ""));
      let rendered = inline(text);
      rendered = rendered.replace(/@@RW_FOOTNOTE_INLINE_(\d+)@@/g, (_value, index) => tokens[Number(index)] || "");
      items.push(`<li id="fn-${number}"><p>${rendered}<a class="footnote" href="#fnref-${number}">↗︎</a></p></li>`);
    }
    return items.length ? `<section class="footnotes"><ol>${items.join("")}</ol></section>` : `<p>${escapeHtml(raw)}</p>`;
  }

  function render(markdown, options = {}) {
    if (!MarkdownIt) throw new Error("Markdown-it ist nicht geladen.");
    return renderWithMarkdownIt(markdown, options);
  }

  function renderWithMarkdownIt(markdown, options = {}) {
    const media = [];
    const footnotes = [];
    const footnoteRefs = [];
    let source = String(markdown || "").replace(/<section class="footnotes">[\s\S]*?<\/section>/gi, (block) => {
      const token = `RWFOOTNOTEBLOCK${footnotes.length}TOKEN`;
      footnotes.push(renderFootnotes(block));
      return token;
    });
    source = source.replace(
      /<sup class=["']footnote-ref["'] id=["']fnref-(\d+)["']><a href=["']#fn-\1["']>\1<\/a><\/sup>/gi,
      (_match, number) => {
        const token = `RWFOOTNOTEREF${footnoteRefs.length}TOKEN`;
        footnoteRefs.push(`<sup class="footnote-ref" id="fnref-${number}"><a href="#fn-${number}">${number}</a></sup>`);
        return token;
      }
    );
    source = source.split("\n").map((line) => {
      const parsed = conventions?.parseMediaShortcut(line.trim());
      if (!parsed) return line;
      const token = `RWMEDIABLOCK${media.length}TOKEN`;
      const src = safeUrl(parsed.source);
      if (!src) media.push("");
      else if (parsed.type === "video") media.push(`<video controls preload="metadata"><source src="${escapeHtml(src)}"></video>`);
      else if (parsed.type === "gpx") media.push(`<div class="preview-gpx"><span data-icon="route" aria-hidden="true"></span><strong>GPX-Tour${parsed.label ? ` · ${escapeHtml(parsed.label)}` : ""}</strong><small>${escapeHtml(src)}</small></div>`);
      else media.push(`<p class="preview-embed"><a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">${escapeHtml(parsed.label || src)}</a></p>`);
      return token;
    }).join("\n");

    const md = new MarkdownIt(conventions?.markdownItOptions?.() || { html: false, breaks: false, linkify: true, typographer: true });
    conventions?.markdownItMark(md);
    const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, index, renderOptions, env, renderer) => renderer.renderToken(tokens, index, renderOptions));
    md.renderer.rules.link_open = (tokens, index, renderOptions, env, renderer) => {
      const hrefIndex = tokens[index].attrIndex("href");
      const href = hrefIndex >= 0 ? safeUrl(tokens[index].attrs[hrefIndex][1]) : "";
      if (!href) tokens[index].attrs = (tokens[index].attrs || []).filter(([name]) => name !== "href");
      tokens[index].attrSet("target", "_blank");
      tokens[index].attrSet("rel", "noopener noreferrer");
      return defaultLinkOpen(tokens, index, renderOptions, env, renderer);
    };
    md.renderer.rules.image = (tokens, index) => {
      const token = tokens[index];
      const original = safeUrl(token.attrGet("src"));
      if (!original) return "";
      const preview = safeUrl((options.imagePreview || ((value) => value))(original));
      const fallback = safeUrl((options.imageFallback || (() => ""))(original));
      return `<img src="${escapeHtml(preview || original)}" alt="${escapeHtml(token.content)}"${fallback ? ` data-fallback-src="${escapeHtml(fallback)}"` : ""} loading="lazy" decoding="async">`;
    };
    let html = md.render(source);
    media.forEach((value, index) => { html = replaceBlockToken(html, `RWMEDIABLOCK${index}TOKEN`, value); });
    footnotes.forEach((value, index) => { html = replaceBlockToken(html, `RWFOOTNOTEBLOCK${index}TOKEN`, value); });
    footnoteRefs.forEach((value, index) => { html = html.replaceAll(`RWFOOTNOTEREF${index}TOKEN`, value); });
    return html;
  }

  function replaceBlockToken(html, token, replacement) {
    return html.replace(new RegExp(`<p>${token}<\\/p>\\s*`, "g"), replacement).replaceAll(token, replacement);
  }

  return { decodeHtmlEntities, escapeHtml, safeUrl, inline, render, renderFootnotes };
});
