const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const sharp = require("sharp");
const markdownIt = require("markdown-it");

const { createAssetHelpers } = require("../lib/eleventy/assets");
const { buildMetaDescription, normalizeAdmonitionHeadings, renderFigureCaptions, streamEntryKind } = require("../lib/eleventy/content");
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

test("normalizes admonitions without changing surrounding headings", () => {
  const actual = normalizeAdmonitionHeadings(
    "<blockquote><h5>Spoilers ahead</h5><p>Text</p></blockquote><h4>Deep</h4>"
  );

  assertSnapshot("contentConventions", actual);
});

test("preserves authored heading levels through Markdown rendering", () => {
  const rendered = markdownIt().render("### Update\n\nText\n\n#### Detail\n");
  const actual = normalizeAdmonitionHeadings(rendered);

  assert.equal(actual, "<h3>Update</h3>\n<p>Text</p>\n<h4>Detail</h4>\n");
});

test("registers content conventions exactly once in the rendering pipeline", () => {
  assert.equal((eleventyConfigSource.match(/normalizeAdmonitionHeadings\(content\)/g) || []).length, 1);
  assert.doesNotMatch(eleventyConfigSource, /addTransform\("admonitionHeadings"/);
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
    "https://example.com/still-a-michael-j-fox-movie/",
    "https://example.com/assets/images/still.webp",
    "Ein warmherziges Portraet.",
    "2025-11-02T23:00:00.000Z",
    "2025-11-02T23:00:00.000Z",
    "de",
    {
      name: "Example Author",
      url: "https://example.com/about/"
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
    "https://example.com/die-strasse/",
    "https://example.com/assets/images/die-strasse.webp",
    "Eine Buchkritik.",
    "2025-09-12T22:00:00.000Z",
    "2025-09-12T22:00:00.000Z",
    "de",
    "Example Author",
    "https://example.com/about/"
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
    "https://example.com/spaghetti-carbonara/",
    "https://example.com/assets/images/carbonara.webp",
    "Ein cremiges Pastarezept.",
    "2025-05-31T22:00:00.000Z",
    "2025-05-31T22:00:00.000Z",
    "de",
    "Example Author",
    "https://example.com/about/"
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
    "https://example.com/uberraschend-lecker/",
    "https://example.com/assets/images/uberraschend.webp"
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
