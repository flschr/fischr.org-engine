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
    "![Foto](/assets/images/uploads/photo.webp)",
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
    "/assets/images/uploads/photo.webp",
    "/assets/images/uploads/photo_(1).webp",
    "/assets/videos/uploads/clip.mp4",
    "/assets/videos/uploads/angle.mp4",
    "/assets/videos/uploads/clip_(1).mp4"
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
    "/assets/images/photo.webp",
    "/assets/videos/clip.mp4"
  ]);
  assert.equal(reads, 1);

  ctimeMs = 2;
  content = "!video(/assets/videos/other.mp4)";
  assert.deepEqual(extractor.getAdminMediaReferences(item), ["/assets/videos/other.mp4"]);
  assert.equal(reads, 2);

  ctimeMs = 3;
  content = "!video(/assets/videos/third.mp4)";
  assert.deepEqual(extractor.getAdminMediaReferences(item), ["/assets/videos/third.mp4"]);
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
    ["/assets/videos/real.mp4", "/assets/videos/html.mp4"]
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
