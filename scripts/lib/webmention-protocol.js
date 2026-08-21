const fs = require("fs");
const matter = require("gray-matter");
const { mf2 } = require("microformats-parser");
const { getHtmlAttribute } = require("../../lib/eleventy/html");
const { fetchWithTimeout, HttpResponseError, responseText } = require("./http-utils");
const {
  extractTargetUrls,
  getEndpointFromHtml,
  getEndpointFromLinkHeader,
  hasWebmentionRel,
  normalizeTargetUrl,
  stripUrlHash
} = require("./webmention-links");

const defaultUserAgent = "mysite.example static blog webmention submitter";

async function getPublishedMf2Targets(sourceUrl, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const response = await fetchWithTimeout(fetchImpl, sourceUrl, {
    method: "GET",
    headers: {
      Accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.8",
      "User-Agent": options.userAgent || defaultUserAgent
    },
    timeoutMs: Number(options.timeoutMs ?? 15000)
  });

  if (!response.ok) return new Set();

  const contentType = response.headers?.get("content-type") || "";
  if (contentType && !/\bhtml\b/i.test(contentType)) return new Set();

  const parsed = mf2(await response.text(), { baseUrl: response.url || sourceUrl });
  const targets = new Set();

  for (const entry of parsed.items.filter((item) => item.type?.includes("h-entry"))) {
    for (const content of entry.properties?.content || []) {
      const html = typeof content === "string" ? content : content?.html || "";
      for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
        const target = normalizeTargetUrl(getHtmlAttribute(match[0], "href"));
        if (target) targets.add(target);
      }
    }
  }

  return targets;
}

function readPostMarkdown(file) {
  return matter(fs.readFileSync(file, "utf8")).content;
}

async function discoverWebmentionEndpoint(targetUrl, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const target = stripUrlHash(targetUrl);
  const response = await fetchWithTimeout(fetchImpl, target, {
    method: "GET",
    headers: {
      Accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.8",
      "User-Agent": options.userAgent || defaultUserAgent
    },
    timeoutMs: Number(options.timeoutMs ?? 15000)
  });

  const responseUrl = response.url || target;
  const linkEndpoint = getEndpointFromLinkHeader(response.headers?.get("link") || "", responseUrl);
  if (linkEndpoint) return linkEndpoint;

  if (!response.ok) return "";

  const contentType = response.headers?.get("content-type") || "";
  if (contentType && !/\bhtml\b/i.test(contentType)) return "";

  return getEndpointFromHtml(await response.text(), responseUrl);
}

async function sendWebmention(endpoint, source, target, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const response = await fetchWithTimeout(fetchImpl, endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": options.userAgent || defaultUserAgent
    },
    body: new URLSearchParams({ source, target }).toString(),
    timeoutMs: Number(options.timeoutMs ?? 15000)
  });

  if (!response.ok) {
    throw new HttpResponseError(
      response.status,
      `endpoint returned ${response.status}: ${await responseText(response)}`
    );
  }

  return {
    status: response.status
  };
}

module.exports = {
  discoverWebmentionEndpoint,
  extractTargetUrls,
  getPublishedMf2Targets,
  getEndpointFromHtml,
  getEndpointFromLinkHeader,
  hasWebmentionRel,
  normalizeTargetUrl,
  readPostMarkdown,
  sendWebmention
};
