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
  calendarYear,
  formatCalendarDate,
  isCalendarDate,
  postDisplayDate
} = require("./lib/eleventy/dates");
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
const { adminBundleVersion, adminDeployedFiles } = require("./lib/eleventy/admin-bundle");
const { leafletRuntimeAssets } = require("./lib/eleventy/runtime-vendors");

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

  // Same delivery mapping the <img> itself already went through. Emitting the local
  // /assets/... path here instead pointed the preload at a different origin than the image it
  // was supposed to warm: browsers that honour imagesrcset ignored the href and preconnected
  // to nothing useful, and for an image with no srcset (a GIF, anything outside
  // responsiveImageExtensions) the href *is* the preload — so the LCP image was fetched twice,
  // once from mysite.example and once from media.mysite.example.
  const attributes = [
    ["rel", "preload"],
    ["as", "image"],
    ["href", media.toDeliveryUrl(asset.publicPath)]
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

// Der Zählpixel im Feed, seit jeher vorhanden — er zeigt auf die eigene Domain.
//
// Er trägt den echten Beitragspfad statt eines Ereignisnamens. Damit sagt die
// Zahl etwas pro Beitrag aus, und genau das ist ihr Wert: Wie oft ein Feed
// absolut geöffnet wird, hängt an der Bildeinstellung fremder Software; welcher
// Beitrag im Vergleich zu den anderen öfter erscheint, nicht.
function buildFeedReadTrackingPixel(post = {}, endpoint = "") {
  if (!endpoint || !post.url) return "";

  const src = `${endpoint}?p=${encodeURIComponent(post.url)}&k=feedread`;
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
  // blog/assets/images and blog/assets/videos as a whole are deliberately NOT copied. Every
  // file under them is materialized from R2 before the build (npm run media:source) purely so
  // sharp and ffprobe can read the real bytes — the emitted HTML names media.mysite.example for
  // all of them, so copying them into _site only re-uploaded ~735 MB across ~6400 files to
  // Pages that nothing would ever request, and counted against the per-site file limit.
  // scripts/check-media-delivery.js is what makes this safe to leave out: it fails the build
  // if anything in the manifest is still referenced from mysite.example, and check:links still
  // fails if a local reference has no file behind it.
  //
  // Video posters are the one exception, and only for the same one-build lag the responsive
  // variants have: generate-video-posters.js may produce a poster this build already names in
  // a `poster=` attribute while publish-build-media.js only uploads it afterwards. Eleven small
  // files, and without them a new video's poster would 404 for exactly one deploy.
  eleventyConfig.addPassthroughCopy({ "blog/assets/images/video-posters": "assets/images/video-posters" });
  for (const [source, destination] of leafletRuntimeAssets) {
    eleventyConfig.addPassthroughCopy({ [source]: destination });
  }
  if (publishAdmin) {
    // index.html is a Nunjucks template so its local assets receive automatic content
    // fingerprints. Everything else is named file by file, so a stale, ignored dependency
    // directory can never leak into a deployment — and the very same list feeds
    // adminBundleVersion, so the service-worker hash covers what is copied here and nothing
    // else. Copying directories instead would leave the two sides to agree by coincidence.
    for (const file of adminDeployedFiles(__dirname)) {
      eleventyConfig.addPassthroughCopy({ [file]: file.replace(/^blog\//, "") });
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

  // Templates pass a post's displayDate (a plain YYYY-MM-DD), which is rendered
  // as written and cannot be shifted by the build machine's timezone. Instants
  // keep the previous behaviour so non-post callers such as the sitemap's
  // lastmod are untouched.
  eleventyConfig.addFilter("date", (date, locale = "de-DE") => {
    if (isCalendarDate(date)) return formatCalendarDate(date, locale);
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(new Date(date));
  });

  eleventyConfig.addFilter("htmlDate", (date) => {
    if (isCalendarDate(date)) return date;
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
      const year = calendarYear(item.data?.displayDate
        || postDisplayDate(item.inputPath, item.date));
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

  // toDeliveryUrl on the result, not just on the frontmatter value: the auto-detected fallback
  // reads an already-rewritten <img> and the default is already absolute, so this only ever
  // changes an explicit `image:`/`social_image:` that still names a local /assets/... path —
  // which the admin is what writes for every new post. Without it those posts advertise an
  // og:image/twitter:image/JSON-LD image on mysite.example while the file itself lives in R2.
  eleventyConfig.addFilter("socialImage", (image, content) => {
    return media.toDeliveryUrl(resolveSocialImage(image, content));
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
    return media.getSitemapImages(item).map((publicPath) => media.toDeliveryUrl(publicPath));
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
  eleventyConfig.addFilter("adminBundleVersion", () => adminBundleVersion(__dirname));

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
