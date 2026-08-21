const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const pluginRss = require("@11ty/eleventy-plugin-rss");
const markdownIt = require("markdown-it");
const { markdownItAdmonitions, markdownItMark, markdownItOptions } = require("./blog/admin/markdown-conventions");
const {
  faBluesky,
  faGithub,
  faLinkedin,
  faMastodon,
  faOpenstreetmap,
  faYoutube
} = require("@fortawesome/free-brands-svg-icons");
const {
  faBars,
  faCircleUser,
  faEnvelope,
  faMagnifyingGlass,
  faRss
} = require("@fortawesome/free-solid-svg-icons");

const manualAliases = require("./blog/_data/manualAliases.json");
const videoMetadata = require("./blog/_data/videoMetadata.json");
const {
  buildAlias,
  getAliasSources,
  getLegacyPostSource,
  getRedirectSources,
  normalizePath
} = require("./lib/eleventy/aliases");
const { createAssetHelpers } = require("./lib/eleventy/assets");
const {
  buildMetaDescription,
  removeDuplicateTitleParagraph,
  renderFigureCaptions,
  streamEntryKind
} = require("./lib/eleventy/content");
const { createEmbedHelpers } = require("./lib/eleventy/embeds");
const { escapeHtml, getHtmlAttribute, stripHtml } = require("./lib/eleventy/html");
const { createMediaAssetHelpers } = require("./lib/eleventy/media-assets");
const { ratingTitleAria, renderRatingTitle, renderRatingTitleHtml } = require("./lib/eleventy/ratings");
const { documentRkey } = require("./lib/atproto");
const { extractFirstImageAlt, imageMimeType, resolveSocialImage } = require("./lib/eleventy/social");
const { sitemapLastModified } = require("./lib/eleventy/sitemap");
const { buildRecipeStructuredData, buildReviewStructuredData } = require("./lib/eleventy/structured-data");
const { adminVendorBundles, leafletRuntimeAssets } = require("./lib/eleventy/runtime-vendors");

const production = process.env.ELEVENTY_ENV === "production";
const publishAdmin = process.env.PUBLISH_ADMIN !== "0";
const assets = createAssetHelpers({ root: __dirname });
const assetUrl = assets.assetUrl;
const media = createMediaAssetHelpers({
  root: __dirname,
  videoMetadata
});
const embeds = createEmbedHelpers({
  assetUrl,
  normalizeLocalMediaSources: media.normalizeLocalMediaSources,
  prepareFeedMedia: media.addFeedMediaAttributes,
  renderLocalVideoEmbed: media.renderLocalVideoEmbed
});

function adminAssetUrl(value = "") {
  const pathname = String(value);
  if (!pathname.startsWith("/admin/")) return pathname;
  const filePath = path.resolve(__dirname, "blog", pathname.slice(1));
  if (!fs.existsSync(filePath)) return pathname;
  const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 12);
  return `${pathname}?v=${hash}`;
}

function adminBundleVersion() {
  const adminRoot = path.resolve(__dirname, "blog/admin");
  const hash = crypto.createHash("sha256");
  const visit = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((entry) => {
        if (entry.name === "editor-src") return;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(entryPath);
        else if (entry.isFile()) {
          hash.update(path.relative(adminRoot, entryPath));
          hash.update(fs.readFileSync(entryPath));
        }
      });
  };
  visit(adminRoot);
  return hash.digest("hex").slice(0, 12);
}

function isPublished(item) {
  return !item.data.draft && item.date <= new Date();
}

function sortNewestFirst(a, b) {
  return b.date - a.date;
}

function getPublishedPosts(collectionApi) {
  return collectionApi
    .getFilteredByGlob("blog/posts/**/*.md")
    .filter((item) => (production ? isPublished(item) : !item.data.draft))
    .sort(sortNewestFirst);
}

function getAliasCollection(collectionApi) {
  const aliases = [];
  const seen = new Set();
  const reserved = new Set();
  const posts = collectionApi
    .getFilteredByGlob("blog/posts/**/*.md")
    .filter((item) => (production ? isPublished(item) : !item.data.draft));

  const addAlias = (from, to, title = "") => {
    const alias = buildAlias(from, to, title);
    if (!alias || seen.has(alias.from) || reserved.has(alias.from)) return;
    seen.add(alias.from);
    aliases.push(alias);
  };

  posts.forEach((item) => {
    reserved.add(normalizePath(item.url));
  });

  posts.forEach((item) => {
    getAliasSources(item.data).forEach((aliasSource) => {
      addAlias(aliasSource, item.url, item.data.title);
    });
    const sourceFileSlug = path.basename(item.inputPath, path.extname(item.inputPath));
    addAlias(getLegacyPostSource(sourceFileSlug), item.url, item.data.title);
  });

  manualAliases.forEach((alias) => addAlias(alias.from, alias.to, alias.title));

  return aliases.sort((a, b) => a.from.localeCompare(b.from));
}


function onlyHtmlPage(page = {}) {
  return page.outputPath && page.outputPath.endsWith(".html");
}

function getMainHtml(content = "") {
  return String(content).match(/<main\b[\s\S]*?<\/main>/i)?.[0] || String(content);
}

function getFirstPriorityImageTag(content = "") {
  for (const [img] of getMainHtml(content).matchAll(/<img\b[^>]*>/gi)) {
    const src = getHtmlAttribute(img, "src");
    if (!src || src.startsWith("data:")) continue;
    if (getHtmlAttribute(img, "fetchpriority").toLowerCase() === "high") return img;
  }

  return "";
}

function buildImagePreloadLink(img = "") {
  const src = getHtmlAttribute(img, "src");
  const asset = media.getLocalImageAsset(src);
  if (!asset) return "";

  const attributes = [
    ["rel", "preload"],
    ["as", "image"],
    ["href", asset.publicPath]
  ];
  const type = imageMimeType(asset.publicPath);
  const srcset = getHtmlAttribute(img, "srcset");
  const sizes = getHtmlAttribute(img, "sizes");

  if (type) attributes.push(["type", type]);
  if (srcset) attributes.push(["imagesrcset", srcset]);
  if (sizes) attributes.push(["imagesizes", sizes]);
  attributes.push(["fetchpriority", "high"]);

  return `<link ${attributes.map(([name, value]) => `${name}="${escapeHtml(value)}"`).join(" ")}>`;
}

function addLcpImagePreload(content = "") {
  if (/<link\b(?=[^>]*\brel=["']preload["'])(?=[^>]*\bas=["']image["'])[^>]*>/i.test(content)) {
    return content;
  }

  const preloadLink = buildImagePreloadLink(getFirstPriorityImageTag(content));
  if (!preloadLink) return content;

  if (/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*>/i.test(content)) {
    return content.replace(
      /(\s*)<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*>/i,
      (match, indentation) => `${indentation}${preloadLink}${match}`
    );
  }

  return content.replace(/<\/head>/i, `    ${preloadLink}\n  </head>`);
}

function getFeedReadEventPath(url = "") {
  const slug = normalizePath(url)
    .replace(/^\/|\/$/g, "")
    .replace(/\//g, "-");

  return `feed-read-${slug || "home"}`;
}

const fontAwesomeIcons = {
  bluesky: faBluesky,
  email: faEnvelope,
  profile: faCircleUser,
  github: faGithub,
  linkedin: faLinkedin,
  mastodon: faMastodon,
  menu: faBars,
  openstreetmap: faOpenstreetmap,
  rss: faRss,
  search: faMagnifyingGlass,
  youtube: faYoutube
};

function renderFontAwesomeIcon(name = "") {
  const icon = fontAwesomeIcons[name];
  if (!icon?.icon) return "";

  const [width, height, , , pathData] = icon.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  return `<svg class="social-icon" aria-hidden="true" viewBox="0 0 ${width} ${height}" focusable="false">${paths.map((d) => `<path fill="currentColor" d="${d}"></path>`).join("")}</svg>`;
}

function getGoatCounterCountUrl(endpoint = "", params = {}) {
  if (!endpoint) return "";

  const url = new URL(endpoint);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function buildFeedReadTrackingPixel(post = {}, endpoint = "") {
  const src = getGoatCounterCountUrl(endpoint, {
    p: getFeedReadEventPath(post.url),
    t: `Feed: ${post.data?.title || post.url || "Unbenannter Beitrag"}`,
    e: "1"
  });

  if (!src) return "";

  return `<img src="${escapeHtml(src)}" width="1" height="1" alt="">`;
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight);
  eleventyConfig.addPlugin(pluginRss);

  eleventyConfig.setLibrary(
    "md",
    markdownIt(markdownItOptions({ html: true })).use(markdownItMark)
      .use(markdownItAdmonitions)
      .use(embeds.markdownMediaShortcodes)
  );

  eleventyConfig.addPassthroughCopy({ "blog/assets/files": "assets/files" });
  eleventyConfig.addPassthroughCopy({ "blog/assets/fonts": "assets/fonts" });
  eleventyConfig.addPassthroughCopy({ "blog/assets/images": "assets/images" });
  eleventyConfig.addPassthroughCopy({ "blog/assets/videos": "assets/videos" });
  for (const [source, destination] of leafletRuntimeAssets) {
    eleventyConfig.addPassthroughCopy({ [source]: destination });
  }
  if (publishAdmin) {
    // index.html is a Nunjucks template so its local assets receive automatic
    // content fingerprints. Copy the generated vendor bundles explicitly so a
    // stale, ignored dependency directory can never leak into a deployment.
    for (const entry of fs.readdirSync(path.join(__dirname, "blog/admin"))) {
      if (["index.html", "editor-src", "admin-src", "css-src", "vendor"].includes(entry)) continue;
      eleventyConfig.addPassthroughCopy({ [`blog/admin/${entry}`]: `admin/${entry}` });
    }
    for (const source of Object.values(adminVendorBundles)) {
      eleventyConfig.addPassthroughCopy({ [source]: source.replace(/^blog\//, "") });
    }
  } else {
    eleventyConfig.ignores.add("blog/admin/**");
  }
  eleventyConfig.addPassthroughCopy({ "blog/assets/images/favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "blog/indexnow-key.txt": "indexnow-key.txt" });
  eleventyConfig.addPassthroughCopy({ "blog/_headers": "_headers" });
  eleventyConfig.addPassthroughCopy({ "blog/_routes.json": "_routes.json" });
  eleventyConfig.addWatchTarget("blog/assets/css/");
  eleventyConfig.addWatchTarget("blog/assets/css-src/");
  eleventyConfig.addWatchTarget("blog/assets/js/");
  eleventyConfig.on("eleventy.after", assets.copyFingerprintedAssets);

  eleventyConfig.addGlobalData("env", {
    environment: production ? "production" : "development"
  });
  eleventyConfig.addGlobalData("publishAdmin", publishAdmin);

  eleventyConfig.addCollection("publishedPosts", getPublishedPosts);
  // All posts incl. drafts — only consumed by the auth-protected admin index.
  // Empty when the admin is not published, so the JSON never leaks draft data.
  eleventyConfig.addCollection("adminPosts", (collectionApi) =>
    publishAdmin ? collectionApi.getFilteredByGlob("blog/posts/**/*.md").sort(sortNewestFirst) : []);
  eleventyConfig.addCollection("aliases", getAliasCollection);

  eleventyConfig.addFilter("date", (date, locale = "de-DE") => {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(new Date(date));
  });

  eleventyConfig.addFilter("htmlDate", (date) => {
    return new Date(date).toISOString().slice(0, 10);
  });

  eleventyConfig.addFilter("isoDate", (date) => {
    return new Date(date).toISOString();
  });

  eleventyConfig.addFilter("excerpt", (content, length = 180) => {
    const text = stripHtml(content);
    if (text.length <= length) return text;
    return `${text.slice(0, length).trim()}...`;
  });

  eleventyConfig.addFilter("metaDescription", (content, explicit = "", imageAlt = "", fallback = "", length = 155) => {
    return buildMetaDescription(content, explicit, imageAlt, fallback, length);
  });

  eleventyConfig.addFilter("ratingTitle", renderRatingTitle);
  eleventyConfig.addFilter("ratingTitleAria", ratingTitleAria);
  eleventyConfig.addFilter("ratingTitleHtml", renderRatingTitleHtml);

  eleventyConfig.addFilter("withoutDuplicateTitle", (content, title) => {
    return removeDuplicateTitleParagraph(content, title);
  });

  eleventyConfig.addFilter("streamEntryKind", (content) => {
    return streamEntryKind(content);
  });

  eleventyConfig.addFilter("limit", (items, count) => {
    return (items || []).slice(0, count);
  });

  eleventyConfig.addFilter("randomPosts", (items, count, excludeFirst = 0) => {
    const pool = (items || []).slice(excludeFirst);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
    }
    return pool.slice(0, count);
  });

  eleventyConfig.addFilter("groupByYear", (items) => {
    const grouped = new Map();
    (items || []).forEach((item) => {
      const year = new Date(item.date).getFullYear();
      if (!grouped.has(year)) grouped.set(year, []);
      grouped.get(year).push(item);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, posts]) => ({ year, posts }));
  });

  eleventyConfig.addFilter("absoluteUrl", (url, siteUrl) => {
    return new URL(url, siteUrl).toString();
  });

  eleventyConfig.addFilter("feedReadTrackingPixel", (post, endpoint) => {
    return buildFeedReadTrackingPixel(post, endpoint);
  });

  eleventyConfig.addFilter("assetUrl", assetUrl);

  eleventyConfig.addFilter("redirectSources", (from) => {
    return getRedirectSources(from);
  });

  eleventyConfig.addFilter("socialImage", (image, content) => {
    return resolveSocialImage(image, content);
  });

  eleventyConfig.addFilter("firstImageAlt", (content) => {
    return extractFirstImageAlt(content);
  });

  eleventyConfig.addFilter("feedEmbeds", (content) => {
    return embeds.renderFeedEmbeds(content);
  });

  eleventyConfig.addFilter("imageMimeType", (image) => {
    return imageMimeType(image);
  });

  eleventyConfig.addFilter("reviewStructuredData", (...args) => {
    return buildReviewStructuredData(...args);
  });

  eleventyConfig.addFilter("recipeStructuredData", (...args) => {
    return buildRecipeStructuredData(...args);
  });

  eleventyConfig.addFilter("sitemapImages", (item) => {
    return media.getSitemapImages(item);
  });

  eleventyConfig.addFilter("adminMediaReferences", (item) => {
    return media.getAdminMediaReferences(item);
  });

  eleventyConfig.addFilter("sitemapLastModified", sitemapLastModified);

  eleventyConfig.addFilter("olderPost", (posts, currentUrl) => {
    const index = (posts || []).findIndex((post) => post.url === currentUrl);
    return index >= 0 ? posts[index + 1] : null;
  });

  eleventyConfig.addFilter("newerPost", (posts, currentUrl) => {
    const index = (posts || []).findIndex((post) => post.url === currentUrl);
    return index > 0 ? posts[index - 1] : null;
  });

  eleventyConfig.addFilter("atprotoDocKey", (slug, fileSlug) => documentRkey({ slug, fileSlug }));

  eleventyConfig.addFilter("faIcon", renderFontAwesomeIcon);
  eleventyConfig.addFilter("adminAssetUrl", adminAssetUrl);
  eleventyConfig.addFilter("adminBundleVersion", adminBundleVersion);

  eleventyConfig.addShortcode("year", () => String(new Date().getFullYear()));

  eleventyConfig.addTransform("mediaEmbeds", function (content) {
    if (!onlyHtmlPage(this.page)) return content;

    const transformed = content
      .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, embeds.renderIframeEmbed)
      .replace(
        /<p>\s*<a href="(https?:\/\/[^"]+)">\s*(https?:\/\/[^<]+)\s*<\/a>\s*<\/p>/g,
        (match, href, label) => {
          return embeds.renderStandaloneEmbed(href, label) || match;
        }
      );

    return embeds.appendGpxLoader(embeds.appendEmbedLoader(transformed));
  });

  eleventyConfig.addTransform("figureCaptions", function (content) {
    if (!onlyHtmlPage(this.page)) return content;
    return renderFigureCaptions(content);
  });

  eleventyConfig.addTransform("mediaPerformanceAttributes", async function (content) {
    if (!onlyHtmlPage(this.page)) return content;
    return media.addMediaPerformanceAttributes(content, this.page);
  });

  eleventyConfig.addTransform("lcpImagePreload", function (content) {
    if (!onlyHtmlPage(this.page)) return content;
    return addLcpImagePreload(content);
  });

  return {
    dir: {
      input: "blog",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    templateFormats: ["md", "njk", "html", "11ty.js"],
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk"
  };
};
