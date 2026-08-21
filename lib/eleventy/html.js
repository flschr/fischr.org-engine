function stripHtml(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlAttribute(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEmbedUrl(value = "") {
  const url = decodeHtmlAttribute(value).trim();
  return url.startsWith("//") ? `https:${url}` : url;
}

function parseUrl(value = "") {
  try {
    return new URL(normalizeEmbedUrl(value));
  } catch {
    return null;
  }
}

function getNormalizedHost(url) {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function getHtmlAttribute(html = "", name = "") {
  const match = String(html).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeHtmlAttribute(match[1] || match[2] || match[3] || "") : "";
}

function hasHtmlAttribute(html = "", name = "") {
  return new RegExp(`\\s${name}(?:\\s*=|\\s|>|/)`, "i").test(String(html));
}

function setHtmlAttribute(html = "", name = "", value = "") {
  const attribute = `${name}="${escapeHtml(value)}"`;
  const existingAttribute = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "i");

  if (existingAttribute.test(html)) {
    return html.replace(existingAttribute, ` ${attribute}`);
  }

  return html.replace(/\/?>$/, (end) => ` ${attribute}${end}`);
}

function addHtmlClassesToTag(html = "", classes = []) {
  const existing = getHtmlAttribute(html, "class").split(/\s+/).filter(Boolean);
  const next = [...new Set([...existing, ...classes])].join(" ");
  return setHtmlAttribute(html, "class", next);
}

function getNumberAttribute(html = "", name = "") {
  const value = getHtmlAttribute(html, name).match(/\d+(\.\d+)?/);
  return value ? Number(value[0]) : 0;
}

function getAspectRatioStyle(width = 0, height = 0) {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return "";
  return ` style="aspect-ratio: ${width} / ${height};"`;
}

function addIframeAspectRatio(iframe) {
  const width = Number((iframe.match(/\bwidth=["']?(\d+)/i) || [])[1]);
  const height = Number((iframe.match(/\bheight=["']?(\d+)/i) || [])[1]);

  if (!width || !height) return iframe;
  if (/aspect-ratio\s*:/i.test(iframe)) return iframe;

  const aspectRatio = `aspect-ratio: ${width} / ${height};`;
  if (/\bstyle=["']/i.test(iframe)) {
    return iframe.replace(/\bstyle=(["'])(.*?)\1/i, (match, quote, style) => {
      const separator = style.trim().endsWith(";") || style.trim() === "" ? "" : ";";
      return `style=${quote}${style}${separator} ${aspectRatio}${quote}`;
    });
  }

  return iframe.replace(/<iframe\b/i, `<iframe style="${aspectRatio}"`);
}

async function replaceAsync(content = "", regex, replacer) {
  const pieces = [];
  let lastIndex = 0;

  for (const match of String(content).matchAll(regex)) {
    pieces.push(content.slice(lastIndex, match.index));
    pieces.push(await replacer(...match));
    lastIndex = match.index + match[0].length;
  }

  pieces.push(content.slice(lastIndex));
  return pieces.join("");
}

module.exports = {
  addHtmlClassesToTag,
  addIframeAspectRatio,
  decodeHtmlAttribute,
  escapeHtml,
  getAspectRatioStyle,
  getHtmlAttribute,
  getNormalizedHost,
  getNumberAttribute,
  hasHtmlAttribute,
  normalizeEmbedUrl,
  parseUrl,
  replaceAsync,
  setHtmlAttribute,
  stripHtml
};
