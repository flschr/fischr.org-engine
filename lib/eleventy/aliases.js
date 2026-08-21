function normalizePath(value = "") {
  if (!value) return "";

  let pathname = String(value).trim();

  try {
    pathname = new URL(pathname).pathname;
  } catch {
    // Keep relative site paths as-is.
  }

  pathname = pathname.replace(/^\/+|\/+$/g, "");
  if (!pathname) return "/";

  return `/${pathname}/`;
}

function buildAlias(from, to, title = "") {
  const aliasFrom = normalizePath(from);
  const aliasTo = normalizePath(to);

  if (!aliasFrom || !aliasTo || aliasFrom === aliasTo) return null;
  return { from: aliasFrom, to: aliasTo, title };
}

function isSiteOriginalUrl(value = "") {
  if (!value) return false;

  try {
    const url = new URL(String(value));
    return ["mysite.example", "www.mysite.example"].includes(url.hostname);
  } catch {
    return String(value).startsWith("/");
  }
}

function getAliasSources(data = {}) {
  const sources = Array.isArray(data.old_alias) ? data.old_alias : [data.old_alias];

  if (isSiteOriginalUrl(data.original_url)) {
    sources.push(data.original_url);
  }

  return sources.filter(Boolean);
}

function getLegacyPostSource(fileSlug = "") {
  const slug = String(fileSlug).trim();
  if (!/^\d{4}-\d{2}-\d{2}-.+/.test(slug)) return "";

  return `/posts/${slug}/`;
}

function getRedirectSources(from = "") {
  const source = normalizePath(from);
  if (!source || source === "/") return [];

  const withoutTrailingSlash = source.replace(/\/+$/, "");
  return withoutTrailingSlash === source ? [source] : [withoutTrailingSlash, source];
}

module.exports = {
  buildAlias,
  getAliasSources,
  getLegacyPostSource,
  getRedirectSources,
  normalizePath
};
