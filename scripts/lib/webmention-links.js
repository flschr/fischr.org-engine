const { decodeHtmlAttribute, getHtmlAttribute } = require("../../lib/eleventy/html");

function extractTargetUrls(markdown = "", options = {}) {
  const siteUrl = options.siteUrl || "https://example.com";
  const excludeHosts = new Set([getComparableHost(siteUrl), ...normalizeHosts(options.excludeHosts || [])]);
  const content = stripIgnoredMarkdown(markdown);
  const targets = new Set();
  const addTarget = (value) => {
    const target = normalizeTargetUrl(value, { excludeHosts });
    if (target) targets.add(target);
  };

  for (const match of content.matchAll(/<a\b[^>]*>/gi)) {
    addTarget(getHtmlAttribute(match[0], "href"));
  }

  for (const match of content.matchAll(/(!?)\[[^\]]*]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g)) {
    if (match[1] === "!") continue;
    addTarget(match[2]);
  }

  for (const match of content.matchAll(/<((?:https?:)\/\/[^>\s]+)>/gi)) {
    addTarget(match[1]);
  }

  const bareUrlContent = content
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/!(?:yt|map)\([^)]*\)/gi, " ")
    .replace(/<[^>]+>/g, " ");

  for (const match of bareUrlContent.matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)) {
    addTarget(trimTrailingUrlPunctuation(match[0]));
  }

  return Array.from(targets);
}

function getEndpointFromLinkHeader(header = "", baseUrl = "") {
  for (const link of splitLinkHeader(header)) {
    const match = link.match(/^\s*<([^>]*)>\s*(?:;(.*))?$/);
    if (!match) continue;

    const href = match[1];
    const params = parseLinkParams(match[2] || "");
    if (!hasWebmentionRel(params.rel || "")) continue;

    const endpoint = resolveEndpoint(href, baseUrl);
    if (endpoint) return endpoint;
  }

  return "";
}

function getEndpointFromHtml(html = "", baseUrl = "") {
  for (const match of String(html).matchAll(/<(?:link|a)\b[^>]*>/gi)) {
    if (!hasWebmentionRel(getHtmlAttribute(match[0], "rel"))) continue;

    const endpoint = resolveEndpoint(getHtmlAttribute(match[0], "href"), baseUrl);
    if (endpoint) return endpoint;
  }

  return "";
}

function splitLinkHeader(header = "") {
  const links = [];
  let current = "";
  let inQuotes = false;

  for (const char of String(header)) {
    if (char === "\"") inQuotes = !inQuotes;

    if (char === "," && !inQuotes) {
      links.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) links.push(current.trim());
  return links;
}

function parseLinkParams(value = "") {
  const params = {};

  for (const part of value.split(";")) {
    const match = part.match(/^\s*([^=]+)\s*=\s*(?:"([^"]*)"|([^;]*))\s*$/);
    if (!match) continue;
    params[match[1].toLowerCase()] = decodeHtmlAttribute(match[2] || match[3] || "");
  }

  return params;
}

function hasWebmentionRel(value = "") {
  return String(value)
    .toLowerCase()
    .split(/\s+/)
    .some((token) => token === "webmention" || token === "http://webmention.org/");
}

function resolveEndpoint(value = "", baseUrl = "") {
  try {
    const endpoint = new URL(decodeHtmlAttribute(value).trim(), baseUrl);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") return "";
    endpoint.hash = "";
    return endpoint.toString();
  } catch {
    return "";
  }
}

function normalizeTargetUrl(value = "", options = {}) {
  const raw = decodeHtmlAttribute(String(value || ""))
    .trim()
    .replace(/^<|>$/g, "");
  if (!raw) return "";

  const urlValue = raw.startsWith("//") ? `https:${raw}` : raw;

  try {
    const url = new URL(urlValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (options.excludeHosts?.has(getComparableHost(url))) return "";

    url.username = "";
    url.password = "";
    return trimTrailingUrlPunctuation(url.toString());
  } catch {
    return "";
  }
}

function normalizeHosts(hosts = []) {
  return hosts.map(getComparableHost).filter(Boolean);
}

function getComparableHost(value = "") {
  try {
    const host = value instanceof URL ? value.hostname : new URL(String(value).includes("://") ? value : `https://${value}`).hostname;
    return host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function stripIgnoredMarkdown(markdown = "") {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

function stripUrlHash(value = "") {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function trimTrailingUrlPunctuation(value = "") {
  return String(value).replace(/[.,;:!?]+$/g, "");
}

module.exports = {
  extractTargetUrls,
  getEndpointFromHtml,
  getEndpointFromLinkHeader,
  hasWebmentionRel,
  normalizeTargetUrl,
  stripUrlHash
};
