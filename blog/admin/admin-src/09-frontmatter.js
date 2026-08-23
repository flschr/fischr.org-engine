import { editableFrontmatterKeys } from "./00-konstanten.js";

import { publicImagePath, publicMediaPath } from "./06-paths.js";
import { localIsoWithOffset, slugify } from "./08-encoding.js";

// --- Frontmatter ---------------------------------------------------------

// Decode the escapes a double-quoted YAML scalar can contain — notably the
// \U0001F44B / \uXXXX forms imported titles use for emoji, which a real YAML
// parser (the build) decodes but our simple reader otherwise shows literally.
export const { splitDocument, buildDocument } = RWContentService.create({
  editableFrontmatterKeys,
  localIsoWithOffset,
  slugify
});
export function stripMarkdownUrl(value) {
  const text = String(value || "").trim();
  if (text.startsWith("<") && text.endsWith(">")) return text.slice(1, -1);
  return text.replace(/\s+["'][^"']+["']$/, "");
}

export function localRenderedPath(value) {
  const text = stripMarkdownUrl(value);
  if (!text) return "";
  try {
    const url = new URL(text, window.location.href);
    if (url.origin === window.location.origin) return url.pathname;
  } catch (error) {
    return text;
  }
  return text;
}

function markdownImagePath(value) {
  const text = localRenderedPath(value);
  if (!text || /^data:/i.test(text) || /^https?:\/\//i.test(text)) return text;
  if (text.startsWith("/assets/images/")) return text;
  if (text.startsWith("assets/images/")) return publicImagePath(text);
  if (text.startsWith("blog/assets/images/")) return publicImagePath(text);
  return text;
}

function markdownUrl(value) {
  const text = String(value || "").trim();
  return /[\s()]/.test(text) ? `<${text}>` : text;
}

export function imageMarkdown(values = {}) {
  const alt = String(values.alt || "").replace(/\]/g, "\\]");
  const publicSrc = markdownImagePath(values.src || "");
  const src = markdownUrl(publicSrc);
  const caption = String(values.caption || "").replace(/\s*\n+\s*/g, " ").trim();
  const image = `![${alt}](${src})`;
  return caption ? `${image}\n*${caption}*` : image;
}

export function videoMarkdown(values = {}) {
  const src = markdownUrl(values.src || "");
  return `!video(${src})`;
}

export function gpxMarkdown(values = {}) {
  return `!gpx(${values.src || ""})`;
}

export function mediaMarkdown(item = {}) {
  const src = item.publicPath || publicMediaPath(item.path || "");
  if (item.mediaKind === "gpx") return gpxMarkdown({ src });
  if (item.mediaKind === "video") return videoMarkdown({ src });
  return imageMarkdown({ src, alt: "", caption: "" });
}

export function decodeBasicHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function stripMarkdownForCharacterCount(markdown) {
  let text = String(markdown || "").replace(/\r\n/g, "\n");

  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/!\[[^\]]*]\([^)]*\)/g, " ");
  text = text.replace(/!video\([^)]*\)/gi, " ");
  text = text.replace(/\[([^\]]+)]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)]\[[^\]]*]/g, "$1");
  text = text.replace(/^\s{0,3}\[[^\]]+]:\s+\S+.*$/gm, " ");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, " ");
  text = text.replace(/`([^`\n]+)`/g, "$1");
  text = text.replace(/==([^=]+)==/g, "$1");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\\([\\`*{}\[\]()#+\-.!_>~|=])/g, "$1");
  text = text.replace(/[*_~]+/g, "");

  return decodeBasicHtmlEntities(text)
    .replace(/\s+/g, " ")
    .trim();
}

// One shared Segmenter — constructing it per call is costly and this runs on
// every keystroke (char counter + social preview).
const graphemeSegmenter = window.Intl?.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

export function countTextCharacters(value) {
  const text = String(value || "");
  if (!text) return 0;
  if (graphemeSegmenter) {
    let count = 0;
    for (const _ of graphemeSegmenter.segment(text)) count += 1;
    return count;
  }
  return Array.from(text).length;
}
