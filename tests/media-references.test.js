const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createMediaAssetHelpers } = require("../lib/eleventy/media-assets");
const { createMediaReferenceExtractor } = require("../lib/eleventy/media-references");

test("keeps sitemap images separate from admin video references", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-media-references-"));
  const imageRoot = path.join(tmp, "blog/assets/images");
  const videoRoot = path.join(tmp, "blog/assets/videos");
  const postPath = path.join(tmp, "blog/posts/test.md");

  fs.mkdirSync(path.join(imageRoot, "uploads"), { recursive: true });
  fs.mkdirSync(path.join(videoRoot, "uploads"), { recursive: true });
  fs.mkdirSync(path.dirname(postPath), { recursive: true });
  fs.writeFileSync(path.join(imageRoot, "uploads/photo.webp"), "image");
  fs.writeFileSync(path.join(imageRoot, "uploads/photo_(1).webp"), "image");
  fs.writeFileSync(path.join(videoRoot, "uploads/clip.mp4"), "video");
  fs.writeFileSync(path.join(videoRoot, "uploads/frontmatter.mp4"), "video");
  fs.writeFileSync(path.join(videoRoot, "uploads/angle.mp4"), "video");
  fs.writeFileSync(path.join(videoRoot, "uploads/clip_(1).mp4"), "video");
  fs.writeFileSync(postPath, [
    "---",
    'title: "Example !video(/assets/videos/uploads/frontmatter.mp4)"',
    "---",
    "![Zwei Kraniche im Nebel](/assets/images/uploads/photo.webp)",
    "![Foto](/assets/images/uploads/photo_(1).webp)",
    "!video(/assets/videos/uploads/clip.mp4)",
    "!video(</assets/videos/uploads/angle.mp4>)",
    '<video><source src="/assets/videos/uploads/clip_(1).mp4"></video>'
  ].join("\n"));

  const media = createMediaAssetHelpers({ root: tmp, localImageRoot: imageRoot, localVideoRoot: videoRoot });
  const item = { inputPath: postPath, data: {} };

  assert.deepEqual(media.getSitemapImages(item), [
    "/assets/images/uploads/photo.webp",
    "/assets/images/uploads/photo_(1).webp"
  ]);
  assert.deepEqual(media.getAdminMediaReferences(item), [
    { url: "/assets/images/uploads/photo.webp", alt: "Zwei Kraniche im Nebel" },
    { url: "/assets/images/uploads/photo_(1).webp", alt: "Foto" },
    { url: "/assets/videos/uploads/clip.mp4", alt: "" },
    { url: "/assets/videos/uploads/angle.mp4", alt: "" },
    { url: "/assets/videos/uploads/clip_(1).mp4", alt: "" }
  ]);
});

test("reads and parses each source only once across sitemap and admin consumers", () => {
  let reads = 0;
  let mtimeMs = 1;
  let ctimeMs = 1;
  let content = "![Foto](/assets/images/photo.webp)\n!video(/assets/videos/clip.mp4)";
  const extractor = createMediaReferenceExtractor({
    getLocalImageAsset: (src) => src ? { publicPath: src } : null,
    getLocalVideoAsset: (src) => src ? { publicPath: src } : null,
    fileSystem: {
      statSync: () => ({ mtimeMs, ctimeMs, ino: 1, size: content.length }),
      readFileSync: () => {
        reads += 1;
        return content;
      }
    }
  });
  const item = { inputPath: "/project/blog/posts/test.md", data: {} };

  assert.deepEqual(extractor.getSitemapImages(item), ["/assets/images/photo.webp"]);
  assert.deepEqual(extractor.getAdminMediaReferences(item), [
    { url: "/assets/images/photo.webp", alt: "Foto" },
    { url: "/assets/videos/clip.mp4", alt: "" }
  ]);
  assert.equal(reads, 1);

  ctimeMs = 2;
  content = "!video(/assets/videos/other.mp4)";
  assert.deepEqual(extractor.getAdminMediaReferences(item), [{ url: "/assets/videos/other.mp4", alt: "" }]);
  assert.equal(reads, 2);

  ctimeMs = 3;
  content = "!video(/assets/videos/third.mp4)";
  assert.deepEqual(extractor.getAdminMediaReferences(item), [{ url: "/assets/videos/third.mp4", alt: "" }]);
  assert.equal(reads, 3);
});

test("ignores media syntax in code and comments", () => {
  const content = [
    "!video(/assets/videos/real.mp4)",
    "`!video(/assets/videos/inline.mp4)`",
    "<!-- !video(/assets/videos/comment.mp4) -->",
    "```md",
    "!video(/assets/videos/fenced.mp4)",
    "<!-- unfinished example",
    "```",
    "`<!--`",
    "    !video(/assets/videos/indented.mp4)",
    "<video controls>",
    "    <source src=\"/assets/videos/html.mp4\">",
    "</video>",
    "<!--",
    "!video(/assets/videos/unclosed-comment.mp4)"
  ].join("\n");
  const extractor = createMediaReferenceExtractor({
    getLocalImageAsset: () => null,
    getLocalVideoAsset: (src) => src ? { publicPath: src } : null,
    fileSystem: {
      statSync: () => ({ mtimeMs: 1, size: content.length }),
      readFileSync: () => content
    }
  });

  assert.deepEqual(
    extractor.getAdminMediaReferences({ inputPath: "/project/blog/posts/test.md", data: {} }),
    [{ url: "/assets/videos/real.mp4", alt: "" }, { url: "/assets/videos/html.mp4", alt: "" }]
  );
});

test("treats a source that disappears during inspection as empty", () => {
  const extractor = createMediaReferenceExtractor({
    getLocalImageAsset: () => null,
    getLocalVideoAsset: () => null,
    fileSystem: {
      statSync: () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); },
      readFileSync: () => { throw new Error("must not read"); }
    }
  });

  assert.deepEqual(
    extractor.getAdminMediaReferences({ inputPath: "/project/blog/posts/gone.md", data: {} }),
    []
  );
});

test("wires videos into the admin index without adding them to the sitemap", () => {
  const root = path.resolve(__dirname, "..");
  const adminIndex = fs.readFileSync(path.join(root, "blog/admin-posts-index.njk"), "utf8");
  const sitemap = fs.readFileSync(path.join(root, "blog/sitemap.njk"), "utf8");

  assert.match(adminIndex, /post \| adminMediaReferences/);
  assert.doesNotMatch(adminIndex, /post \| sitemapImages/);
  assert.match(sitemap, /item \| sitemapImages/);
  assert.doesNotMatch(sitemap, /item \| adminMediaReferences/);
});

// Der Alt-Text gehört zur Verwendung, nicht zur Datei: Dasselbe Bild kann in zwei Beiträgen
// unterschiedlich beschrieben sein, und in einem davon gar nicht. Der Index trägt deshalb je
// Referenz einen Alt-Text — und behält innerhalb eines Beitrags den ersten, der etwas sagt.
test("carries the alt text of each image reference into the admin index", () => {
  const content = [
    "![](/assets/images/leer.webp)",
    "![Ein Reh am Waldrand](/assets/images/leer.webp)",
    '<img src="/assets/images/html.webp" alt="Nebel &amp; Licht">',
    "![Nur hier beschrieben](/assets/images/einzeln.webp)"
  ].join("\n");
  const extractor = createMediaReferenceExtractor({
    getLocalImageAsset: (src) => src ? { publicPath: src } : null,
    getLocalVideoAsset: () => null,
    fileSystem: {
      statSync: () => ({ mtimeMs: 1, ctimeMs: 1, ino: 1, size: content.length }),
      readFileSync: () => content
    }
  });

  assert.deepEqual(
    extractor.getAdminMediaReferences({ inputPath: "/project/blog/posts/test.md", data: {} }),
    [
      { url: "/assets/images/leer.webp", alt: "Ein Reh am Waldrand" },
      { url: "/assets/images/html.webp", alt: "Nebel & Licht" },
      { url: "/assets/images/einzeln.webp", alt: "Nur hier beschrieben" }
    ]
  );
});

test("takes the alt text of the frontmatter preview image from image_alt", () => {
  const content = "";
  const extractor = createMediaReferenceExtractor({
    getLocalImageAsset: (src) => src ? { publicPath: src } : null,
    getLocalVideoAsset: () => null,
    fileSystem: {
      statSync: () => ({ mtimeMs: 1, ctimeMs: 1, ino: 1, size: 0 }),
      readFileSync: () => content
    }
  });

  assert.deepEqual(
    extractor.getAdminMediaReferences({
      inputPath: "/project/blog/posts/test.md",
      data: { image: "/assets/images/vorschau.webp", image_alt: "Blick über den See" }
    }),
    [{ url: "/assets/images/vorschau.webp", alt: "Blick über den See" }]
  );
});

// Die Sitemap kennt weiterhin nur Adressen. Ein Objekt an dieser Stelle würde als
// "[object Object]" in die XML-Ausgabe wandern, ohne dass ein Test das bemerkt.
test("keeps sitemap images as plain public paths", () => {
  const content = "![Foto](/assets/images/photo.webp)";
  const extractor = createMediaReferenceExtractor({
    getLocalImageAsset: (src) => src ? { publicPath: src } : null,
    getLocalVideoAsset: () => null,
    fileSystem: {
      statSync: () => ({ mtimeMs: 1, ctimeMs: 1, ino: 1, size: content.length }),
      readFileSync: () => content
    }
  });

  assert.deepEqual(
    extractor.getSitemapImages({ inputPath: "/project/blog/posts/test.md", data: {} }),
    ["/assets/images/photo.webp"]
  );
});
