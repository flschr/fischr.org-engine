(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWMarkdownMedia = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function parseMediaShortcut(value = "") {
    const match = String(value).trim().match(/^!(video|yt|youtube|map|embed|gpx)(?:\[([^\]]*)\])?\(([\s\S]+)\)$/i);
    if (!match) return null;
    return { type: match[1].toLowerCase(), label: match[2] || "", source: match[3].trim() };
  }

  function normalizeMediaShortcutSource(value = "") {
    const trimmed = String(value).trim();
    const angleMatch = trimmed.match(/^<([\s\S]+)>$/);
    return (angleMatch ? angleMatch[1] : trimmed).trim();
  }

  function create({ stripMarkdownUrl, extension }) {
  function visibleMarkdownSource(markdown) {
    const mask = (value) => String(value).replace(/[^\n]/g, " ");
    const codeMaskedLines = [];
    let fence = null;

    for (const line of String(markdown || "").split("\n")) {
      if (fence) {
        const closingMarker = line.match(/^ {0,3}(`{3,}|~{3,})[ \t\r]*$/)?.[1] || "";
        if (closingMarker.startsWith(fence.character) && closingMarker.length >= fence.length) fence = null;
        codeMaskedLines.push(mask(line));
        continue;
      }

      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1] || "";
      if (marker) {
        fence = { character: marker[0], length: marker.length };
        codeMaskedLines.push(mask(line));
        continue;
      }

      codeMaskedLines.push(line);
    }

    const withoutCode = codeMaskedLines.join("\n").replace(/(`+)[\s\S]*?\1/g, mask);
    const withoutComments = withoutCode.replace(/<!--[\s\S]*?(?:-->|$)/g, mask);
    const visibleLines = [];
    let videoHtml = false;

    for (const line of withoutComments.split("\n")) {
      if (/<video\b/i.test(line)) videoHtml = !/<\/video\s*>/i.test(line);
      visibleLines.push(!videoHtml && (/^ {4}/.test(line) || line.startsWith("\t")) ? mask(line) : line);
      if (videoHtml && /<\/video\s*>/i.test(line)) videoHtml = false;
    }

    return visibleLines.join("\n");
  }

  function findMarkdownImages(markdown) {
    const text = String(markdown || "");
    const images = [];
    let index = 0;

    while (index < text.length) {
      const start = text.indexOf("![", index);
      if (start === -1) break;

      const altStart = start + 2;
      const altEnd = findClosingBracket(text, altStart);
      const targetStart = altEnd + 2;
      if (altEnd === -1 || text[altEnd + 1] !== "(") {
        index = start + 2;
        continue;
      }

      const targetEnd = findClosingParen(text, targetStart);
      if (targetEnd === -1) {
        index = altEnd + 1;
        continue;
      }

      const target = text.slice(targetStart, targetEnd);
      images.push({
        from: start,
        to: targetEnd + 1,
        alt: text.slice(altStart, altEnd),
        target,
        src: stripMarkdownUrl(target)
      });
      index = targetEnd + 1;
    }

    return images;
  }

  function findMediaShortcuts(markdown) {
    const text = String(markdown || "");
    const shortcuts = [];
    let offset = 0;

    for (const segment of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
      if (!segment[0]) continue;
      const line = segment[0].replace(/[\r\n]+$/, "");
      const parsed = parseMediaShortcut(line);
      if (parsed) shortcuts.push({
        ...parsed,
        source: normalizeMediaShortcutSource(parsed.source),
        from: offset
      });
      offset += segment[0].length;
    }

    return shortcuts;
  }

  function findHtmlMedia(markdown) {
    const media = [];
    const decode = (value) => String(value)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    for (const match of String(markdown || "").matchAll(/<(img|video|source)\b[^>]*>/gi)) {
      const attribute = match[0].match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const src = decode(attribute?.[1] || attribute?.[2] || attribute?.[3] || "");
      const altAttribute = match[0].match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const alt = decode(altAttribute?.[1] || altAttribute?.[2] || altAttribute?.[3] || "");
      if (src) media.push({ type: match[1].toLowerCase(), src, alt, from: match.index });
    }

    return media;
  }

  function findClosingBracket(text, start) {
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "]") return index;
    }
    return -1;
  }

  function findClosingParen(text, start) {
    let escaped = false;
    let inAngle = false;
    let depth = 0;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "<") inAngle = true;
      if (char === ">" && inAngle) {
        inAngle = false;
        continue;
      }
      if (inAngle) continue;
      if (char === "(") {
        depth += 1;
        continue;
      }
      if (char !== ")") continue;
      if (depth === 0) return index;
      depth -= 1;
    }

    return -1;
  }

  function markdownAltHasText(value) {
    return String(value || "").replace(/\\([\\\]])/g, "$1").trim().length > 0;
  }

  function escapeMarkdownAlt(value) {
    return String(value || "")
      .replace(/\s*\n+\s*/g, " ")
      .replace(/\]/g, "\\]")
      .trim();
  }

  function imageMimeType(path) {
    const ext = extension(path);
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    if (ext === "avif") return "image/avif";
    if (ext === "svg") return "image/svg+xml";
    return "image/jpeg";
  }


    return { findHtmlMedia, findMarkdownImages, findMediaShortcuts, visibleMarkdownSource, markdownAltHasText, escapeMarkdownAlt, imageMimeType };
  }

  return { create, normalizeMediaShortcutSource, parseMediaShortcut };
});
