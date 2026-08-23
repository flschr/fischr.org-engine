const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const sharp = require("sharp");
const markdownIt = require("markdown-it");

const { createAssetHelpers } = require("../lib/eleventy/assets");
const { buildMetaDescription, renderFigureCaptions, streamEntryKind } = require("../lib/eleventy/content");
const { markdownItAdmonitions } = require("../blog/admin/markdown-conventions");
const { createEmbedHelpers } = require("../lib/eleventy/embeds");
const { createMediaAssetHelpers } = require("../lib/eleventy/media-assets");
const postsData = require("../blog/posts/posts.11tydata");
const pagesData = require("../blog/pages/pages.11tydata");
const { buildRecipeStructuredData, buildReviewStructuredData } = require("../lib/eleventy/structured-data");
const snapshots = require("./snapshots/eleventy-render.snap.json");
const gpx = require("../blog/assets/js/gpx-core.js");
const eleventyConfigSource = fs.readFileSync(path.join(__dirname, "../.eleventy.js"), "utf8");
const gpxViewerSource = fs.readFileSync(path.join(__dirname, "../blog/assets/js/gpx-viewer.js"), "utf8");
const baseLayoutSource = fs.readFileSync(path.join(__dirname, "../blog/_includes/layouts/base.njk"), "utf8");

// Built from a plain "media.mysite.example" literal on purpose: scripts/export-public-engine.js
// rewrites that string in the exported snapshot, so these expectations travel with the files
// they check. A regex literal that escapes the dots survives the rewrite untouched and then
// fails only in the export, never here.
const deliveryHost = "media.mysite.example".replace(/\./g, "\\.");

function assertSnapshot(name, actual) {
  assert.equal(actual, snapshots[name]);
}

test("preloads the normal DM Sans font without eagerly loading italics", () => {
  const fontPreloads = [...baseLayoutSource.matchAll(/<link rel="preload"[^>]+as="font"[^>]*>/g)].map(([link]) => link);

  assert.equal(fontPreloads.length, 1);
  assert.match(fontPreloads[0], /dm-sans-variable\.woff2/);
  assert.match(fontPreloads[0], /type="font\/woff2"/);
  assert.match(fontPreloads[0], /crossorigin/);
  assert.doesNotMatch(fontPreloads[0], /italic/);
});

test("loads one bundled public stylesheet", () => {
  const stylesheets = [...baseLayoutSource.matchAll(/<link rel="stylesheet"[^>]*>/g)].map(([link]) => link);

  assert.equal(stylesheets.length, 1);
  assert.match(stylesheets[0], /assets\/css\/generated\/main\.css/);
});

test("fingerprints local CSS and JS asset urls", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-assets-"));
  const cssPath = path.join(tmp, "blog/assets/css/main.css");
  const outputCssPath = path.join(tmp, "_site/assets/css/main.css");

  fs.mkdirSync(path.dirname(cssPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputCssPath), { recursive: true });
  fs.writeFileSync(cssPath, "body { color: #222; }\n");
  fs.writeFileSync(outputCssPath, "stale");

  const assets = createAssetHelpers({ root: tmp });
  const assetUrl = assets.assetUrl("/assets/css/main.css?theme=light#top");

  assert.match(assetUrl, /^\/assets\/css\/main\.[a-f0-9]{12}\.css\?theme=light#top$/);

  assets.copyFingerprintedAssets();

  const fingerprintedPath = path.join(tmp, "_site", assetUrl.split("?")[0].slice(1));
  assert.equal(fs.existsSync(fingerprintedPath), true);
  assert.equal(fs.existsSync(outputCssPath), false);
});

test("renders click-to-load YouTube embeds", () => {
  const embeds = createEmbedHelpers();
  const actual = embeds.renderIframeEmbed(
    '<iframe src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" title="Demo" width="560" height="315"></iframe>'
  );

  assertSnapshot("youtubeEmbed", actual);
});

test("renders feed-safe YouTube iframes", () => {
  const embeds = createEmbedHelpers();
  const actual = embeds.renderFeedEmbeds(
    '<p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">https://www.youtube.com/watch?v=dQw4w9WgXcQ</a></p>'
  );

  assertSnapshot("feedEmbed", actual);
});

test("renders a local GPX tour and a feed-safe download link", () => {
  const embeds = createEmbedHelpers();
  const html = embeds.renderGpxEmbed("/assets/files/gpx/uploads/demo.gpx", { activity: "wandern" });

  assert.match(html, /class="gpx-embed"/);
  assert.match(html, /data-gpx-activity="hiking"/);
  assert.match(html, /Karte laden/);
  assert.equal(
    embeds.renderFeedEmbeds(html),
    '<p><a href="/assets/files/gpx/uploads/demo.gpx">GPX-Tour herunterladen</a></p>'
  );
});

test("loads GPX assets conditionally and rejects remote track sources", () => {
  const embeds = createEmbedHelpers({ assetUrl: (value) => `/hashed${value}` });
  const html = embeds.renderGpxEmbed("/assets/files/gpx/uploads/demo.gpx");
  const page = embeds.appendGpxLoader(`<html><head></head><body>${html}</body></html>`);

  assert.match(page, /href="\/hashed\/assets\/css\/gpx\.css"/);
  assert.match(page, /src="\/hashed\/assets\/js\/gpx-core\.js"/);
  assert.equal(embeds.renderGpxEmbed("https://example.com/private.gpx"), "");
  assert.equal(embeds.renderGpxEmbed("/assets/files/gpx/../private.gpx"), "");
});

test("turns GPX Markdown into an activity-aware viewer", () => {
  const embeds = createEmbedHelpers();
  const markdown = markdownIt({ html: true }).use(embeds.markdownMediaShortcodes);
  const html = markdown.render("!gpx[laufen](/assets/files/gpx/uploads/demo.gpx)\n");

  assert.match(html, /data-gpx-src="\/assets\/files\/gpx\/uploads\/demo\.gpx"/);
  assert.match(html, /data-gpx-activity="running"/);
  assert.doesNotMatch(html, /<p>!gpx/);
});

test("calculates stable GPX summary statistics", () => {
  const points = [
    { lat: 48, lon: 11, ele: 500, time: new Date("2026-07-19T08:00:00Z") },
    { lat: 48.001, lon: 11, ele: 504, time: new Date("2026-07-19T08:01:00Z") },
    { lat: 48.002, lon: 11, ele: 510, time: new Date("2026-07-19T08:02:00Z") },
    { lat: 48.002, lon: 11, ele: 509, time: new Date("2026-07-19T08:12:00Z") }
  ];

  const stats = gpx.calculateStats(points);
  assert.ok(stats.distanceMeters > 220 && stats.distanceMeters < 225);
  assert.equal(stats.movingSeconds, 120);
  assert.ok(stats.elevationGainMeters >= 3);
  assert.ok(stats.highestPointMeters > 507);
  assert.ok(stats.averageSpeedKmh > 6.6 && stats.averageSpeedKmh < 6.8);
  assert.equal(gpx.formatStats(stats, "hiking")[3][0], "Ø Tempo");
});

test("average speed uses only distance covered during moving segments", () => {
  const points = [
    { lat: 48, lon: 11, ele: 500, time: new Date("2026-07-19T08:00:00Z") },
    { lat: 48.001, lon: 11, ele: 501, time: new Date("2026-07-19T08:01:00Z") },
    { lat: 48.011, lon: 11, ele: 502, time: new Date("2026-07-19T08:11:00Z") }
  ];
  const stats = gpx.calculateStats(points);

  assert.equal(stats.movingSeconds, 60);
  assert.ok(stats.distanceMeters > stats.movingDistanceMeters * 10);
  assert.ok(stats.averageSpeedKmh > 6.6 && stats.averageSpeedKmh < 6.8);
});

test("bounds large GPX render inputs and finds tooltip points logarithmically", () => {
  const points = Array.from({ length: 100000 }, (unused, index) => ({ distance: index * 10, ele: index % 500 }));
  const sampled = gpx.samplePoints(points, 1200);

  assert.equal(sampled.length, 1200);
  assert.equal(sampled[0], points[0]);
  assert.equal(sampled.at(-1), points.at(-1));
  assert.equal(gpx.numericExtent(points.map((point) => point.ele)).maximum, 499);
  assert.ok(Math.abs(gpx.pointAtDistance(sampled, 456780).distance - 456780) < 1000);
});

test("keeps the map button retryable after a Leaflet load failure", () => {
  assert.match(gpxViewerSource, /\.catch\(\(error\) => \{\s*leafletPromise = null;/);
  assert.match(gpxViewerSource, /button\.textContent = "Erneut versuchen"/);
  assert.doesNotMatch(gpxViewerSource, /renderMap\(embed, data\), \{ once: true \}/);
});

test("adds local video posters to feed embeds", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-feed-video-"));
  const videoRoot = path.join(tmp, "blog/assets/videos");
  const videoPath = path.join(videoRoot, "imported/demo.webm");

  fs.mkdirSync(path.dirname(videoPath), { recursive: true });
  fs.writeFileSync(videoPath, "");

  const media = createMediaAssetHelpers({
    root: tmp,
    localVideoRoot: videoRoot,
    videoMetadata: {
      "/assets/videos/imported/demo.webm": {
        width: 1280,
        height: 720,
        poster: "/assets/images/video-posters/demo.webp"
      }
    }
  });
  const embeds = createEmbedHelpers({
    prepareFeedMedia: media.addFeedMediaAttributes
  });
  const actual = embeds.renderFeedEmbeds(
    '<video controls width="100%"><source src="demo.webm" type="video/webm"></video>'
  );

  assertSnapshot("feedLocalVideo", actual);
});

test("renders GitHub-style admonitions as semantic asides", () => {
  const actual = markdownIt().use(markdownItAdmonitions).render(
    "> [!WARNING]\n> **Spoilers ahead**\n>\n> Text with **formatting**.\n"
  );

  assert.match(actual, /^<aside class="admonition admonition-warning" role="note" aria-label="Warnung">/);
  assert.match(actual, /<p class="admonition-title"><svg class="admonition-icon"[^>]*>.*<\/svg>Spoilers ahead<\/p>/);
  assert.match(actual, /<p>Text with <strong>formatting<\/strong>\.<\/p>/);
  assert.match(actual, /<\/aside>\n$/);
});

test("preserves inline Markdown in admonition titles without token-position assumptions", () => {
  const actual = markdownIt().use(markdownItAdmonitions).render(
    "> [!NOTE]\n> **Read [this](/details) and `that`**\n>\n> Text.\n"
  );
  assert.match(actual, /<svg class="admonition-icon"/);
  assert.match(actual, /Read <a href="\/details">this<\/a> and <code>that<\/code>/);
  assert.match(actual, /aria-label="Hinweis"/);
});

test("localizes accessible admonition type names without duplicating the title", () => {
  const md = markdownIt({ html: true }).use(markdownItAdmonitions);
  const english = md.render("> [!NOTE]\n> **<img src=\"/x\" alt=\"Backup\">**\n", { lang: "en" });
  const german = md.render("> [!WARNING]\n> **<abbr>API</abbr> prüfen**\n", { lang: "de" });
  assert.match(english, /aria-label="Note"/);
  assert.match(german, /aria-label="Warnung"/);
  assert.doesNotMatch(english, /aria-label="[^"]*Backup/);
  assert.doesNotMatch(german, /aria-label="[^"]*API/);
});

test("does not treat the former heading syntax as an admonition", () => {
  const actual = markdownIt().use(markdownItAdmonitions).render("> #### Legacy title\n> Text\n");
  assert.equal(actual, "<blockquote>\n<h4>Legacy title</h4>\n<p>Text</p>\n</blockquote>\n");
  assert.doesNotMatch(eleventyConfigSource, /normalizeAdmonitionHeadings|contentConventions/);
});

test("renders every centrally declared admonition type and rejects unknown markers", () => {
  const { types } = require("../blog/admin/admonitions");
  const md = markdownIt().use(markdownItAdmonitions);
  for (const type of types) {
    assert.match(md.render(`> [!${type.marker}]\n> **Title**\n`), new RegExp(`admonition-${type.className}`));
  }
  assert.doesNotMatch(md.render("> [!TIP]\n> **Title**\n"), /class="admonition/);
});

test("classifies stream entries as thought, quote, or full", () => {
  assert.equal(streamEntryKind(""), "thought");
  assert.equal(streamEntryKind("   \n  "), "thought");
  assert.equal(streamEntryKind("<blockquote><p>Ein Zitat</p></blockquote>"), "quote");
  assert.equal(streamEntryKind("<blockquote><p>Zitat</p><p>— Autor</p></blockquote>"), "quote");
  assert.equal(streamEntryKind("<blockquote><p>Zitat</p></blockquote><p>Kommentar</p>"), "full");
  assert.equal(streamEntryKind("<p>Ein normaler Absatz.</p>"), "full");
});

test("renders image captions as figures", () => {
  const actual = renderFigureCaptions('<p><img src="/x.webp" alt="X"><br><em>Bildtext</em></p>');

  assertSnapshot("figureCaption", actual);
});

test("renders Markdown image titles as figure captions", () => {
  const actual = renderFigureCaptions('<p><img src="/x.webp" alt="X" title="Bildtext"></p>');

  assert.equal(
    actual,
    '<figure>\n  <img src="/x.webp" alt="X">\n  <figcaption>Bildtext</figcaption>\n</figure>'
  );
});

test("leaves a title-less standalone image untouched", () => {
  const html = '<p><img src="/x.webp" alt="X"></p>';

  assert.equal(renderFigureCaptions(html), html);
});

test("builds meta descriptions from image alt fallback", () => {
  const actual = buildMetaDescription("", "", "Ein Bergsee mit Spiegelung im Abendlicht.", "Fallback");

  assert.equal(actual, "Ein Bergsee mit Spiegelung im Abendlicht.");
});

test("builds compact meta descriptions from content", () => {
  const actual = buildMetaDescription(
    "<p>Ein kurzer Text mit Leerzeichen vor , Satzzeichen und genug Inhalt fuer eine ordentliche Kuerzung.</p>",
    "",
    "",
    "",
    72
  );

  assert.equal(actual, "Ein kurzer Text mit Leerzeichen vor, Satzzeichen und genug Inhalt...");
});

test("posts render with the article layout and public slug permalink", () => {
  assert.equal(postsData.layout, "layouts/post.njk");
  assert.deepEqual(postsData.tags, ["posts"]);
  assert.equal(
    postsData.eleventyComputed.permalink({
      draft: false,
      page: {
        fileSlug: "2026-06-04-abendidylle-in-erding"
      }
    }),
    "/abendidylle-in-erding/"
  );
});

test("draft posts and pages do not render public permalinks", () => {
  assert.equal(
    postsData.eleventyComputed.permalink({
      draft: true,
      page: {
        fileSlug: "2026-06-05-test"
      }
    }),
    false
  );

  assert.equal(
    pagesData.eleventyComputed.permalink({
      draft: true,
      permalink: "/secret/",
      page: {
        fileSlug: "secret"
      }
    }),
    false
  );
});

test("builds review structured data from explicit schema and title rating", () => {
  const actual = buildReviewStructuredData(
    {
      type: "review",
      itemType: "Movie",
      itemName: "Still: A Michael J. Fox Movie"
    },
    "Still: A Michael J. Fox Movie (5/5)",
    "https://mysite.example/still-a-michael-j-fox-movie/",
    "https://mysite.example/assets/images/still.webp",
    "Ein warmherziges Portraet.",
    "2025-11-02T23:00:00.000Z",
    "2025-11-02T23:00:00.000Z",
    "de",
    {
      name: "Example Author",
      url: "https://mysite.example/about/"
    }
  );

  assert.equal(actual["@type"], "Review");
  assert.deepEqual(actual.reviewRating, {
    "@type": "Rating",
    ratingValue: 5,
    bestRating: 5,
    worstRating: 0
  });
  assert.equal(actual.itemReviewed["@type"], "Movie");
  assert.equal(actual.itemReviewed.name, "Still: A Michael J. Fox Movie");
});

test("adds book author to review structured data", () => {
  const actual = buildReviewStructuredData(
    {
      type: "review",
      itemType: "Book",
      itemName: "Die Strasse",
      itemAuthor: "Cormac McCarthy",
      rating: 4,
      bestRating: 5
    },
    "Die Strasse (4/5)",
    "https://mysite.example/die-strasse/",
    "https://mysite.example/assets/images/die-strasse.webp",
    "Eine Buchkritik.",
    "2025-09-12T22:00:00.000Z",
    "2025-09-12T22:00:00.000Z",
    "de",
    "Example Author",
    "https://mysite.example/about/"
  );

  assert.equal(actual.itemReviewed["@type"], "Book");
  assert.deepEqual(actual.itemReviewed.author, {
    "@type": "Person",
    name: "Cormac McCarthy"
  });
});

test("builds recipe structured data from recipe article sections", () => {
  const actual = buildRecipeStructuredData(
    { type: "recipe" },
    [
      "<p>Die Menge reicht für 4 Personen.</p>",
      "<h2>Zutaten (für 4 Personen)</h2>",
      "<ul><li>400 g Spaghetti</li><li>150 g Guanciale</li></ul>",
      "<h2>Zubereitung</h2>",
      "<ol><li>Spaghetti al dente kochen.</li><li>Alles cremig vermengen.</li></ol>"
    ].join(""),
    "Spaghetti Carbonara",
    "https://mysite.example/spaghetti-carbonara/",
    "https://mysite.example/assets/images/carbonara.webp",
    "Ein cremiges Pastarezept.",
    "2025-05-31T22:00:00.000Z",
    "2025-05-31T22:00:00.000Z",
    "de",
    "Example Author",
    "https://mysite.example/about/"
  );

  assert.equal(actual["@type"], "Recipe");
  assert.equal(actual.recipeYield, "4 Personen");
  assert.deepEqual(actual.recipeIngredient, ["400 g Spaghetti", "150 g Guanciale"]);
  assert.deepEqual(actual.recipeInstructions, [
    {
      "@type": "HowToStep",
      text: "Spaghetti al dente kochen."
    },
    {
      "@type": "HowToStep",
      text: "Alles cremig vermengen."
    }
  ]);
});

test("skips recipe structured data without ingredients and instructions", () => {
  const actual = buildRecipeStructuredData(
    { type: "recipe" },
    "<p>Spontan zusammengeworfen und lecker.</p>",
    "Überraschend lecker",
    "https://mysite.example/uberraschend-lecker/",
    "https://mysite.example/assets/images/uberraschend.webp"
  );

  assert.equal(actual, null);
});

test("adds media performance attributes and responsive srcsets", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-eleventy-"));
  const imageRoot = path.join(tmp, "blog/assets/images");
  const videoRoot = path.join(tmp, "blog/assets/videos");

  fs.mkdirSync(imageRoot, { recursive: true });
  fs.mkdirSync(videoRoot, { recursive: true });

  await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 20, g: 40, b: 60 }
    }
  })
    .webp({ quality: 80 })
    .toFile(path.join(imageRoot, "sample.webp"));

  const media = createMediaAssetHelpers({
    root: tmp,
    localImageRoot: imageRoot,
    localVideoRoot: videoRoot,
    outputRoot: path.join(tmp, "_site"),
    responsiveImageCacheRoot: path.join(tmp, ".cache/responsive-images"),
    responsiveImageQuality: 80
  });

  const actual = await media.addMediaPerformanceAttributes(
    '<main><img src="/assets/images/sample.webp" alt="Sample"><img src="/assets/images/sample.webp" alt="Second"></main>',
    { url: "/" }
  );
  const normalized = actual
    .replace(/sample-[a-f0-9]{12}-/g, "sample-<hash>-")
    .replace(/url\(data:image\/webp;base64,[A-Za-z0-9+/=]+\)/g, "url(data:<lqip>)");

  assertSnapshot("mediaAttributes", normalized);
});

test("only rewrites image/video src to the media delivery host once R2 confirms it was uploaded", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-media-manifest-"));
  const imageRoot = path.join(tmp, "blog/assets/images");
  fs.mkdirSync(imageRoot, { recursive: true });

  await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .webp()
    .toFile(path.join(imageRoot, "migrated.webp"));
  await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 4, g: 5, b: 6 } } })
    .webp()
    .toFile(path.join(imageRoot, "not-migrated.webp"));

  const media = createMediaAssetHelpers({
    root: tmp,
    localImageRoot: imageRoot,
    localVideoRoot: path.join(tmp, "blog/assets/videos"),
    outputRoot: path.join(tmp, "_site"),
    responsiveImageCacheRoot: path.join(tmp, ".cache/responsive-images"),
    mediaManifest: { "images/migrated.webp": { sha256: "irrelevant-for-this-test" } }
  });

  assert.equal(media.toDeliveryUrl("/assets/images/migrated.webp"), "https://media.mysite.example/images/migrated.webp");
  assert.equal(media.toDeliveryUrl("/assets/images/not-migrated.webp"), "/assets/images/not-migrated.webp");
});

// An admin upload records itself as an automation/media-uploads/ record and is only folded
// into the manifest by the next production build. Until then the build still has to resolve
// it to the delivery host — otherwise the freshly uploaded image renders as an /assets/...
// path that has not existed in Git since DB-1129, and 404s.
test("resolves an upload that is recorded but not yet folded into the manifest", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-pending-upload-"));
  const imageRoot = path.join(tmp, "blog/assets/images");
  fs.mkdirSync(imageRoot, { recursive: true });
  fs.mkdirSync(path.join(tmp, "automation/media-uploads"), { recursive: true });

  fs.writeFileSync(
    path.join(tmp, "automation/media-manifest.json"),
    `${JSON.stringify({ "images/folded.webp": { sha256: "already-folded" } }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(tmp, "automation/media-uploads/images__uploads__fresh.webp.json"),
    `${JSON.stringify({ key: "images/uploads/fresh.webp", entry: { sha256: "just-uploaded" } }, null, 2)}\n`
  );

  // No mediaManifest option: this must go through the on-disk read, which is where the merge
  // of manifest and upload records lives.
  const media = createMediaAssetHelpers({
    root: tmp,
    localImageRoot: imageRoot,
    localVideoRoot: path.join(tmp, "blog/assets/videos"),
    outputRoot: path.join(tmp, "_site"),
    responsiveImageCacheRoot: path.join(tmp, ".cache/responsive-images")
  });

  assert.equal(media.toDeliveryUrl("/assets/images/uploads/fresh.webp"), "https://media.mysite.example/images/uploads/fresh.webp");
  assert.equal(media.toDeliveryUrl("/assets/images/folded.webp"), "https://media.mysite.example/images/folded.webp");
  assert.equal(media.toDeliveryUrl("/assets/images/unknown.webp"), "/assets/images/unknown.webp");
});

test("skips the blur-up placeholder for transparent images", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-alpha-"));
  const imageRoot = path.join(tmp, "blog/assets/images");
  fs.mkdirSync(imageRoot, { recursive: true });

  await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 4,
      background: { r: 200, g: 0, b: 0, alpha: 0 }
    }
  })
    .webp()
    .toFile(path.join(imageRoot, "transparent.webp"));

  const media = createMediaAssetHelpers({
    root: tmp,
    localImageRoot: imageRoot,
    localVideoRoot: path.join(tmp, "blog/assets/videos"),
    outputRoot: path.join(tmp, "_site"),
    responsiveImageCacheRoot: path.join(tmp, ".cache/responsive-images")
  });

  const actual = await media.addMediaPerformanceAttributes(
    '<main><img src="/assets/images/transparent.webp" alt="Transparent"></main>',
    { url: "/" }
  );

  assert.doesNotMatch(actual, /background-image/);
});

// The delivered variants are content-addressed: their filename falls out of the source hash,
// the width and the quality, so a variant the manifest already records needs no bytes at all
// to be named in a srcset. Producing it anyway meant every build re-materialized ~5200 files
// that the emitted HTML points at media.mysite.example — which then had to be uploaded to
// Cloudflare Pages on every deploy and counted against its per-site file limit.
test("skips producing a responsive variant the manifest already records", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-variant-skip-"));
  const imageRoot = path.join(tmp, "blog/assets/images");
  fs.mkdirSync(imageRoot, { recursive: true });

  const imagePath = path.join(imageRoot, "sample.webp");
  await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 7, g: 8, b: 9 } } })
    .webp()
    .toFile(imagePath);

  const hash = require("node:crypto")
    .createHash("sha256")
    .update(fs.readFileSync(imagePath))
    .digest("hex")
    .slice(0, 12);
  // Every stage a 800 px source produces: the configured widths under the cap, plus the cap
  // itself (the source width), plus the extra stage the first in-content image gets.
  const widths = [420, 680, 760, 800];
  const variantKeys = widths.map((width) => `images/responsive/sample-${hash}-${width}.webp`);

  function helpers(manifest) {
    return createMediaAssetHelpers({
      root: tmp,
      localImageRoot: imageRoot,
      localVideoRoot: path.join(tmp, "blog/assets/videos"),
      outputRoot: path.join(tmp, "_site"),
      responsiveImageCacheRoot: path.join(tmp, ".cache/responsive-images"),
      mediaManifest: manifest
    });
  }

  const known = Object.fromEntries(
    [...variantKeys, "images/sample.webp"].map((key) => [key, { sha256: "recorded" }])
  );
  const html = await helpers(known).addMediaPerformanceAttributes(
    '<main><img src="/assets/images/sample.webp" alt="Sample"></main>',
    { url: "/post/" }
  );

  for (const width of widths) {
    assert.match(html, new RegExp(`https://${deliveryHost}/images/responsive/sample-${hash}-${width}\\.webp ${width}w`));
  }
  assert.doesNotMatch(html, /"\/assets\/images\/responsive\//);
  assert.equal(fs.existsSync(path.join(tmp, "_site/assets/images/responsive")), false);
  assert.equal(fs.existsSync(path.join(tmp, ".cache/responsive-images")), false);

  // The other half of the same rule: a variant the manifest does not know is still produced and
  // still served locally, which is the one-build lag a brand-new image depends on.
  const freshHtml = await helpers({ "images/sample.webp": { sha256: "recorded" } })
    .addMediaPerformanceAttributes('<main><img src="/assets/images/sample.webp" alt="Sample"></main>', { url: "/post/" });

  assert.match(freshHtml, new RegExp(`/assets/images/responsive/sample-${hash}-680\\.webp 680w`));
  assert.deepEqual(
    fs.readdirSync(path.join(tmp, "_site/assets/images/responsive")).sort(),
    widths.map((width) => `sample-${hash}-${width}.webp`).sort()
  );
});

// Nothing under the media roots may be copied wholesale into _site any more: every file there
// is materialized from R2 purely so sharp and ffprobe can read it, and the emitted HTML names
// media.mysite.example for all of it. Copying it anyway shipped ~735 MB across ~6400 files to
// Cloudflare Pages that no visitor could ever request. Video posters stay, for the same
// one-build lag the freshly generated responsive variants have.
test("does not deploy the media trees that are only materialized for the build", () => {
  const passthroughs = Array.from(
    eleventyConfigSource.matchAll(/addPassthroughCopy\(\{\s*"([^"]+)":/g),
    (match) => match[1]
  );

  assert.ok(!passthroughs.includes("blog/assets/images"), "blog/assets/images must not be copied wholesale");
  assert.ok(!passthroughs.includes("blog/assets/videos"), "blog/assets/videos must not be copied wholesale");
  assert.ok(passthroughs.includes("blog/assets/images/video-posters"), "video posters need a local fallback");
  // The favicon is referenced from the site root rather than under /assets, so it is copied on
  // its own and must survive the removal of the tree it happens to live in.
  assert.ok(passthroughs.includes("blog/assets/images/favicon.ico"));
});

// Eine Auslieferungs-URL im Markdown muss auf die lokale Datei zurückführen, sonst bekommt das
// Bild weder Abmessungen noch responsive Varianten noch ein Platzhalterbild.
//
// Bei den rund 1.400 absoluten URLs im Bestand geht das über die Pfadform. Seit Uploads
// inhaltsadressiert sind, kann eine solche URL aber auch cas/<hash> lauten — und dafür gibt es
// keine Prefix-Regel, aus der sich der lokale Pfad ableiten liesse. Die Zuordnung steht nur im
// Manifest, also muss sie von dort kommen.
test("a content-addressed delivery URL in the source resolves back to the local file", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-cas-reverse-"));
  const imageRoot = path.join(tmp, "blog/assets/images");
  fs.mkdirSync(imageRoot, { recursive: true });

  const imagePath = path.join(imageRoot, "sample.webp");
  await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .webp()
    .toFile(imagePath);

  const objectKey = `cas/aa/${"aa".repeat(32)}.webp`;
  const media = createMediaAssetHelpers({
    root: tmp,
    localImageRoot: imageRoot,
    localVideoRoot: path.join(tmp, "blog/assets/videos"),
    outputRoot: path.join(tmp, "_site"),
    responsiveImageCacheRoot: path.join(tmp, ".cache/responsive-images"),
    mediaManifest: {
      "images/sample.webp": { sha256: "recorded", objectKey }
    }
  });

  const html = await media.addMediaPerformanceAttributes(
    `<main><img src="https://media.mysite.example/${objectKey}" alt="Sample"></main>`,
    { url: "/post/" }
  );

  // Aufgelöst heisst: die echten Abmessungen stehen dran und es gibt ein srcset. Ohne Auflösung
  // bliebe das Bild ein nacktes img-Element mit einer fremden URL.
  assert.match(html, /width="800"/);
  assert.match(html, /height="600"/);
  assert.match(html, /srcset="/);
});

// Der Fall, der bei einem ersetzten Bild entsteht: Ein veröffentlichter Beitrag trägt die
// Adresse von vorher, das Manifest führt sie nur noch unter supersededObjectKeys. Auch die muss
// auf dieselbe lokale Datei führen — sonst verliert ausgerechnet der ältere Bestand seine
// Varianten, während der neue sie behält.
test("a superseded delivery address still resolves to the local file", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-cas-superseded-"));
  const imageRoot = path.join(tmp, "blog/assets/images");
  fs.mkdirSync(imageRoot, { recursive: true });

  const imagePath = path.join(imageRoot, "sample.webp");
  await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 4, g: 5, b: 6 } } })
    .webp()
    .toFile(imagePath);

  const current = `cas/bb/${"bb".repeat(32)}.webp`;
  const previous = `cas/cc/${"cc".repeat(32)}.webp`;

  const media = createMediaAssetHelpers({
    root: tmp,
    localImageRoot: imageRoot,
    localVideoRoot: path.join(tmp, "blog/assets/videos"),
    outputRoot: path.join(tmp, "_site"),
    responsiveImageCacheRoot: path.join(tmp, ".cache/responsive-images"),
    mediaManifest: {
      "images/sample.webp": { sha256: "recorded", objectKey: current, supersededObjectKeys: [previous] }
    }
  });

  const html = await media.addMediaPerformanceAttributes(
    `<main><img src="https://media.mysite.example/${previous}" alt="Sample"></main>`,
    { url: "/post/" }
  );

  assert.match(html, /width="800"/);
  assert.match(html, /srcset="/);
});
