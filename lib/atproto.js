"use strict";

// Shared helpers for the standard.site / AT Protocol integration.
// Used both by the Eleventy build (link tags) and the publishing scripts,
// so the deterministic record keys stay identical on both sides.

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

function documentRkey(input = {}) {
  const raw = input.slug || input.fileSlug || "";
  const key = String(raw)
    .replace(DATE_PREFIX, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 512);

  return key || "post";
}

function publicationUri(identity = {}) {
  if (!identity || !identity.did || !identity.publicationRkey) return "";
  return `at://${identity.did}/site.standard.publication/${identity.publicationRkey}`;
}

function documentUri(identity = {}, rkey = "") {
  if (!identity || !identity.did || !rkey) return "";
  return `at://${identity.did}/site.standard.document/${rkey}`;
}

module.exports = { documentRkey, publicationUri, documentUri };
