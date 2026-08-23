const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const { deliveryAddressIndex, readMergedManifest } = require("../../lib/media-manifest");

const root = process.cwd();
const postsRoot = path.join(root, "blog/posts");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse JSON file ${path.relative(root, file)}: ${error.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporaryFile, file);
  } finally {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; received ${JSON.stringify(value ?? fallback)}.`);
  }
  return parsed;
}

function loadConfig() {
  return readJson(path.join(root, "automation/social-config.json"), {});
}

function listPublishedPosts(options = {}) {
  const config = loadConfig();
  const siteUrl = options.siteUrl || config.siteUrl || "https://mysite.example";
  const startAfter = options.startAfter || config.startAfter || "";
  const maxAgeDays = Number(options.maxAgeDays ?? config.maxAgeDays ?? 14);
  const now = options.now || new Date();
  const startAfterDate = startAfter ? new Date(startAfter) : null;
  const maxAgeMs = maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : 0;

  return listFiles(postsRoot)
    .filter((file) => file.endsWith(".md"))
    .map((file) => parsePost(file, siteUrl))
    .filter((post) => {
      if (!post) return false;
      if (post.draft) return false;
      if (!post.date || post.date > now) return false;
      if (startAfterDate && post.date < startAfterDate) return false;
      if (maxAgeMs > 0 && now - post.date > maxAgeMs) return false;
      return true;
    })
    .sort((a, b) => a.date - b.date);
}

function parsePost(file, siteUrl) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = matter(raw);
  const data = parsed.data || {};
  const date = data.date ? new Date(data.date) : null;

  if (!date || Number.isNaN(date.getTime())) return null;

  const slug = data.slug || path.basename(file, ".md").replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const urlPath = normalizeUrlPath(data.permalink || `/${slug}/`);
  const contentImages = extractMarkdownImages(parsed.content).map((img) => ({
    src: normalizeImagePath(img.src),
    alt: String(img.alt || "").trim()
  }));
  const firstImage = contentImages[0] || { src: "", alt: "" };
  const image = normalizeImagePath(data.social_image || data.socialImage || data.image || firstImage.src || "");
  // Match the lead image's alt to the lead image itself: an explicit override,
  // else that image's own alt from the body, and only then the first body image
  // as a last resort — so a chosen social_image never inherits an unrelated alt.
  const imageOwnAlt = (contentImages.find((img) => img.src === image) || {}).alt || "";
  const imageAlt = String(
    data.social_image_alt || data.socialImageAlt || data.image_alt || data.imageAlt || imageOwnAlt || firstImage.alt || ""
  ).trim();
  const tags = normalizeArray(data.tags);
  const type = String(data.type || "post").trim().toLowerCase();
  const rawSocialImages = data.social_images ?? data.socialImages;

  return {
    file,
    relativeFile: path.relative(root, file),
    title: String(data.title || slug).trim(),
    slug,
    date,
    type,
    tags,
    draft: isTruthy(data.draft),
    url: `${siteUrl.replace(/\/$/, "")}${urlPath}`,
    urlPath,
    image,
    imageAlt,
    // Every image embedded in the body, in order (for multi-image attachment).
    contentImages,
    // Keep the Markdown source so GoToSocial can render inline links.
    // `content` remains the shared plain-text form.
    contentMarkdown: parsed.content,
    content: cleanContent(parsed.content, data.title || ""),
    // The social template (Beitragsart) chosen for this post. Absent → the
    // configured default template. (No tag matching — the choice is explicit.)
    // `category` is read as a legacy alias.
    socialTemplate: normalizeToken(data.social_template || data.category || ""),
    // Explicit per-post image selection: an ordered list of paths (1–4), or `[]`
    // for "no image". `null` (absent) means "use the category default count".
    socialImages: Array.isArray(rawSocialImages) ? rawSocialImages.map(normalizeImagePath).filter(Boolean) : null,
    // Custom post text that overrides the category template.
    socialText: String(data.social_text || data.socialText || "").trim(),
    // `syndicate: false` opts the post out of GoToSocial publishing entirely.
    syndicate: !(data.syndicate === false || String(data.syndicate ?? "").toLowerCase() === "false")
  };
}

const livenessUserAgent = "mysite.example liveness check";

// Is `url` already served on the live site (2xx)? Syndication runs on their own
// crons and gate only on the post date, so a future-dated post can come due a
// few minutes before scheduled-publish.yml finishes deploying it. Posting its
// link in that window would 404 on GoToSocial/IndexNow/etc. This guard
// lets a script skip a post until its URL is actually reachable; a later publish
// or manual run retries it. Errors/timeouts are treated as "not live" on purpose — a post
// arriving one cycle late is far better than syndicating a dead link.
async function isLive(url, options = {}) {
  if (process.env.SKIP_LIVENESS_CHECK === "1") return true;

  const timeoutMs = positiveInteger(options.timeoutMs, 10000, "liveness timeoutMs");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init = {
    redirect: "follow",
    signal: controller.signal,
    headers: { "User-Agent": livenessUserAgent }
  };

  try {
    let response = await fetch(url, { ...init, method: "HEAD" });
    // Some hosts reject or mishandle HEAD — fall back to GET before giving up.
    if ([403, 405, 501].includes(response.status)) {
      response = await fetch(url, { ...init, method: "GET" });
    }
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Filter a list down to the items whose URL is already live, checking them
// concurrently. `getUrl` extracts the URL to probe (defaults to `item.url`).
//
// A post that just came due may legitimately not be deployed yet, so a recent
// skip is quiet. But a post that has been due for longer than `staleAfterMs`
// (default 2h) and is still unreachable is almost certainly broken — a bad
// permalink or a deploy that never succeeded — not just deploy lag. Those are
// surfaced as GitHub Actions ::warning:: annotations so they don't stay
// invisible; they are deliberately not hard failures, because these jobs run
// every few minutes and would otherwise spam failure notifications.
async function keepLive(items, getUrl = (item) => item.url, options = {}) {
  const getDate = options.getDate || ((item) => item.date);
  const staleAfterMs = Number(options.staleAfterMs ?? 2 * 60 * 60 * 1000);
  const now = options.now instanceof Date ? options.now : new Date();

  const checks = await Promise.all(
    items.map(async (item) => ({ item, live: await isLive(getUrl(item), options) }))
  );

  const live = [];
  for (const { item, live: ok } of checks) {
    if (ok) {
      live.push(item);
      continue;
    }

    const date = getDate(item);
    const overdueMs = date instanceof Date ? now - date : 0;
    if (overdueMs > staleAfterMs) {
      console.log(
        `::warning::${getUrl(item)} has been due for ${Math.round(overdueMs / 60000)} min but is still not reachable — skipping. Check the deploy and the post permalink.`
      );
    } else {
      console.log(`Skipping ${getUrl(item)} — not live yet (will retry next run).`);
    }
  }
  return live;
}

// Resolve a category by its stable id (or, as a fallback, its name).
function findRuleById(id, rules = []) {
  if (!id) return null;
  const target = normalizeToken(id);
  if (!target) return null;
  return rules.find((rule) => normalizeToken(rule.id || rule.name) === target) || null;
}

// The template that applies to a post: its explicit `social_template`, else the
// configured default template, else the first template. No tag matching — the
// choice is explicit, with a single configured fallback.
function resolveRule(post, social = {}) {
  const rules = social.rules || [];
  return (
    findRuleById(post.socialTemplate, rules) ||
    findRuleById(social.defaultTemplate || social.defaultCategory, rules) ||
    rules[0] ||
    null
  );
}

// Whether a template attaches the canonical link. On by default; `link: false`
// makes a native, linkless post (just text + images, no link/link-card) — the
// way the photo templates used to behave.
function ruleWantsLink(rule = {}) {
  return rule.link !== false;
}

// Reconcile a template string with the link toggle: drop {link} when the rule
// is linkless, and append it when the rule wants a link but the template omits
// the placeholder (so the toggle alone is enough — no need to type {link}).
function applyLinkToggle(template, wantsLink) {
  const text = String(template || "");
  if (!wantsLink) return text.replace(/\{link\}/g, "");
  if (/\{link\}/.test(text)) return text;
  // Append inline (a space, not a blank line) so it reads "…text. <link>".
  return text.trim() ? `${text.trimEnd()} {link}` : "{link}";
}

// Build the final post text for a single post. When the post carries a custom
// `social_text`, that overrides the category template. Plain custom text is fed
// through the renderer as `{content}` so a link (when the template wants one) is
// appended *and* survives truncation (the prose is shrunk, never the
// link). Custom text that already contains placeholders is treated as a full
// template, giving power users control over link/title placement.
function renderPostText(post, rule, limit, options = {}) {
  const wantsLink = ruleWantsLink(rule);
  const custom = cleanSocialText(post.socialText, options);
  const hasMarkdownSource = post.contentMarkdown != null;
  const contentSource = hasMarkdownSource ? post.contentMarkdown : post.content;
  const cleanPost = {
    ...post,
    title: cleanSocialText(post.title, options),
    content: hasMarkdownSource
      ? cleanContent(contentSource, post.title, options)
      : cleanSocialText(contentSource, options)
  };
  if (custom) {
    // Only treat the custom text as a full template when it explicitly places
    // the link itself. Plain prose (even if it happens to contain "{content}"
    // or "{title}") gets the link appended — unless the template is linkless.
    if (/\{link\}/.test(custom)) {
      return renderTemplate(custom, cleanPost, limit);
    }
    const wrapper = wantsLink ? "{content} {link}" : "{content}";
    return renderTemplate(wrapper, { ...cleanPost, content: custom }, limit);
  }
  return renderTemplate(applyLinkToggle(rule.template, wantsLink), cleanPost, limit);
}

function renderTemplate(template, post, limit) {
  const sourceTemplate = template || "{title} {link}";
  const fallbackContent = post.content || post.title;
  let content = fallbackContent;
  let text = fillTemplate(sourceTemplate, post, content);

  if (text.length <= limit) return text;

  while (text.length > limit && content.length > 20) {
    const overflow = text.length - limit;
    content = truncateText(content, Math.max(20, content.length - overflow - 1));
    text = fillTemplate(sourceTemplate, post, content);
  }

  return text.length <= limit ? text : truncateText(text, limit);
}

// How many images a category attaches by default: an explicit `images` count,
// or the legacy `includeImage` boolean (true → 1), else none.
function ruleImageCount(rule = {}) {
  if (Number.isFinite(rule.images)) return Math.max(0, Math.min(4, rule.images));
  return rule.includeImage ? 1 : 0;
}

// Media now delivers from its own subdomain (see lib/eleventy/media-assets.js), but the
// underlying bytes are still committed under blog/assets/{images,videos}/ — map the delivery
// URL back to that repo-relative path so social attachments can still read the file locally.
const mediaDeliveryOrigin = "https://media.mysite.example";

// Erst gebaut, wenn wirklich eine Auslieferungs-URL aufgelöst werden muss: Die meisten Beiträge
// nennen ihr Bild als /assets/…-Pfad, und das Manifest hat über 6.000 Einträge.
let deliveryIndex = null;

function fromMediaDeliveryPath(pathValue) {
  if (!pathValue.startsWith(mediaDeliveryOrigin)) return pathValue;
  const pathname = pathValue.slice(mediaDeliveryOrigin.length);
  if (pathname.startsWith("/images/") || pathname.startsWith("/videos/")) return `/assets${pathname}`;

  // Eine Inhaltsadresse lässt sich nicht aus dem Pfad ableiten — cas/<hash> sagt nichts darüber,
  // wo die Datei liegt. Ohne diesen Blick ins Manifest fände localImageFromPath die Datei nicht
  // und der Beitrag ginge ohne Bild raus: kein Fehler, keine Meldung, nur ein Foto-Beitrag ohne
  // Foto bei GoToSocial und Bluesky.
  if (!deliveryIndex) deliveryIndex = deliveryAddressIndex(readMergedManifest(root));
  const manifestKey = deliveryIndex.get(pathname.replace(/^\//, ""));
  if (manifestKey) return `/assets/${manifestKey}`;

  return pathname;
}

// Build a local image object for a public `/assets/...` path (or the equivalent
// media-domain URL), or null if it isn't a usable local raster image.
function localImageFromPath(pathValue, alt, fallbackAlt) {
  if (!pathValue) return null;
  const normalizedPath = fromMediaDeliveryPath(pathValue);
  if (!normalizedPath.startsWith("/")) return null;
  const absolutePath = path.join(root, "blog", normalizedPath.replace(/^\//, ""));
  if (!fs.existsSync(absolutePath)) return null;
  const mimeType = imageMimeType(absolutePath);
  if (!mimeType || mimeType === "image/svg+xml" || mimeType === "image/gif") return null;
  return {
    path: absolutePath,
    name: path.basename(absolutePath),
    mimeType,
    size: fs.statSync(absolutePath).size,
    alt: alt || fallbackAlt
  };
}

// The single preview image (lead) — also used by standard.site publishing.
function getLocalImage(post) {
  return localImageFromPath(post.image, post.imageAlt, post.title);
}

// The ordered list of images (max 4) to attach to a post's toot/skeet:
// the explicit per-post selection if present, otherwise the first N (the
// category's default count) of the lead image + body images.
function getLocalImages(post, rule = {}) {
  const altFor = (src) => {
    // Prefer the image's own alt from the body so every attachment keeps its
    // matching description. Only fall back to the lead image's alt for the
    // social_image when it has no body alt of its own (e.g. an og-only image) —
    // otherwise a selected lead image wrongly inherited the first body image's alt.
    const match = (post.contentImages || []).find((img) => img.src === src);
    if (match && match.alt) return match.alt;
    if (src === post.image && post.imageAlt) return post.imageAlt;
    return match ? match.alt : "";
  };

  let paths;
  if (Array.isArray(post.socialImages)) {
    paths = post.socialImages;
  } else {
    const count = ruleImageCount(rule);
    if (count <= 0) return [];
    paths = [];
    if (post.image) paths.push(post.image);
    for (const img of post.contentImages || []) {
      if (!paths.includes(img.src)) paths.push(img.src);
    }
    paths = paths.slice(0, count);
  }

  const seen = new Set();
  const images = [];
  for (const src of paths) {
    if (seen.has(src)) continue;
    seen.add(src);
    const image = localImageFromPath(src, altFor(src), post.title);
    if (image) images.push(image);
    if (images.length >= 4) break;
  }
  return images;
}

function normalizeToken(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }

  return files;
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
}

function fillTemplate(template, post, content) {
  return template
    .replaceAll("{title}", post.title)
    .replaceAll("{link}", post.url)
    .replaceAll("{content}", content)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(value, limit) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  if (limit <= 1) return "…";
  return `${text.slice(0, limit - 1).replace(/\s+\S*$/, "")}…`;
}

function cleanContent(content, title, options = {}) {
  const text = cleanSocialText(content, options).replace(/\s+/g, " ").trim();

  const normalizedText = normalizeComparable(text);
  const normalizedTitle = normalizeComparable(title);
  if (normalizedText === normalizedTitle) return "";

  return text;
}

// Convert Markdown to readable social-network text. GoToSocial can retain
// inline Markdown links for server-side rendering. Explicit URLs are unaffected.
function cleanSocialText(content, options = {}) {
  let text = String(content || "");

  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/!\[[^\]]*]\([^)]*\)/g, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_match, label, url) => {
    if (options.preserveMarkdownLinks) return _match;
    return label === url ? url : `${label} (${url})`;
  });
  text = text.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, label, url) => {
    if (options.preserveMarkdownLinks) return _match;
    return `${label} (${url})`;
  });
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/[*_~`>]+/g, "");
  text = text.replace(/==([^=]+)==/g, "$1");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&quot;/g, "\"");
  text = text.replace(/&#39;/g, "'");
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractMarkdownImages(content) {
  const images = [];
  const re = /!\[([^\]]*)]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  let match;
  while ((match = re.exec(String(content || "")))) {
    images.push({ alt: match[1] || "", src: match[2] || "" });
  }
  return images;
}

function normalizeImagePath(value) {
  const image = String(value || "").trim();
  if (!image) return "";
  if (image.startsWith("https://mysite.example/")) return new URL(image).pathname;
  return image;
}

function normalizeUrlPath(value) {
  const pathValue = String(value || "/").trim();
  if (pathValue === false) return "/";
  if (pathValue.startsWith("http")) return new URL(pathValue).pathname;
  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

function isTruthy(value) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes"].includes(String(value || "").toLowerCase());
}

function normalizeComparable(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function imageMimeType(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".svg") return "image/svg+xml";
  return "";
}

module.exports = {
  root,
  loadConfig,
  readJson,
  writeJson,
  positiveInteger,
  listPublishedPosts,
  isLive,
  keepLive,
  findRuleById,
  resolveRule,
  ruleWantsLink,
  renderTemplate,
  renderPostText,
  getLocalImage,
  getLocalImages,
  extractMarkdownImages
};
