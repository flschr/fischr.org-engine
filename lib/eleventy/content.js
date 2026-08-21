const { stripHtml } = require("./html");

function normalizeText(value = "") {
  return stripHtml(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[“”„]/g, "\"")
    .replace(/[’]/g, "'")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDescriptionText(value = "") {
  return stripHtml(value)
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateDescription(value = "", length = 155) {
  const text = normalizeDescriptionText(value);
  if (!text || text.length <= length) return text;

  const limit = Math.max(1, length - 3);
  const truncated = text.slice(0, limit + 1).replace(/\s+\S*$/, "").trim();
  const candidate = truncated.length >= Math.floor(limit * 0.65) ? truncated : text.slice(0, limit).trim();

  return `${candidate.replace(/[,:;.-]+$/, "")}...`;
}

function buildMetaDescription(content = "", explicit = "", imageAlt = "", fallback = "", length = 155) {
  return (
    truncateDescription(explicit, length) ||
    truncateDescription(content, length) ||
    truncateDescription(imageAlt, length) ||
    truncateDescription(fallback, length)
  );
}

function removeDuplicateTitleParagraph(content = "", title = "") {
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) return content;

  let cleaned = String(content).replace(/<p>([\s\S]*?)<\/p>/gi, (match, inner) => {
    return normalizeText(inner) === normalizedTitle ? "" : match;
  });

  if (normalizeText(cleaned) === normalizedTitle && !/<(img|picture|video|source|iframe)\b/i.test(cleaned)) {
    cleaned = "";
  }

  return cleaned.trim();
}

// Classifies a stream entry by its already-cleaned body content, so short
// "title-only" thoughts and pure quotes can be styled as a passing thought
// rather than a bold section heading.
//   "thought" — the body is empty (the title is the whole post)
//   "quote"   — the body is nothing but a single blockquote
//   "full"    — anything else (a regular post)
function streamEntryKind(content = "") {
  const trimmed = String(content).trim();
  if (!trimmed) return "thought";

  const isSingleBlockquote =
    /^<blockquote[\s\S]*<\/blockquote>$/i.test(trimmed) &&
    (trimmed.match(/<blockquote\b/gi) || []).length === 1 &&
    !/<(p|h[1-6]|ul|ol|figure|img|picture|video|iframe|pre|table)\b/i.test(
      trimmed.replace(/<blockquote[\s\S]*<\/blockquote>/i, "")
    );

  return isSingleBlockquote ? "quote" : "full";
}

function renderFigureCaptions(content = "") {
  return String(content)
    // Image followed by an italic line — caption may contain Markdown (links).
    .replace(
      /<p>\s*(<img\b[^>]*>)\s*(?:<br\s*\/?>\s*)?<em>([\s\S]*?)<\/em>\s*<\/p>/gi,
      (match, image, caption) => `<figure>\n  ${image}\n  <figcaption>${caption}</figcaption>\n</figure>`
    )
    // Image with a Markdown title (![alt](src "caption")) — plain-text caption.
    .replace(
      /<p>\s*<img\b([^>]*)>\s*<\/p>/gi,
      (match, attrs) => {
        const title = /\stitle="([^"]*)"/i.exec(attrs);
        if (!title || !title[1]) return match;
        const image = `<img${attrs.replace(/\stitle="[^"]*"/i, "")}>`;
        return `<figure>\n  ${image}\n  <figcaption>${title[1]}</figcaption>\n</figure>`;
      }
    );
}

function slugifyTag(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

module.exports = {
  buildMetaDescription,
  removeDuplicateTitleParagraph,
  renderFigureCaptions,
  slugifyTag,
  streamEntryKind
};
