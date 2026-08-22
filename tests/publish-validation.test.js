const assert = require("node:assert/strict");
const test = require("node:test");
const { isContentOnlyPath, plan, validationMode } = require("../scripts/lib/publish-validation");

test("normal admin content uses the content validation path", () => {
  const paths = [
    "blog/posts/2026-07-22-fast-publishing.md",
    "blog/pages/impressum.md",
    "blog/assets/images/uploads/article.webp",
    "blog/assets/images/video-posters/article.webp",
    "blog/assets/images/imported/legacy/unused.webp",
    "blog/assets/videos/uploads/article.mp4",
    "blog/assets/files/gpx/uploads/tour.gpx",
    "blog/_data/videoMetadata.json",
    // An image upload's only Git trace since media moved to R2.
    "automation/media-manifest.json"
  ];

  assert.equal(paths.every(isContentOnlyPath), true);
  assert.equal(validationMode(paths), "content");
  assert.equal(isContentOnlyPath("automation/admin-rename-origins.json"), false);
});

test("unknown, presentation, and implementation changes require full validation", () => {
  const paths = [
    "blog/pages/identity.njk",
    "blog/about.njk",
    "blog/projects.njk",
    "blog/assets/images/favicon.ico",
    "blog/assets/images/imported/legacy/raw.jpg",
    "blog/admin/index.html",
    "blog/assets/css-src/main/01-foundation.css",
    ".eleventy.js"
  ];

  paths.forEach((filePath) => assert.equal(validationMode([filePath]), "full", filePath));
  assert.equal(validationMode(["blog/posts/article.md", "blog/pages/identity.njk"]), "full");
  assert.equal(validationMode([]), "full");
});

test("publish classification covers create, update, delete, media, and mixed changes", () => {
  const contentCases = [
    "blog/posts/new.md",
    "blog/posts/updated.md",
    "blog/pages/deleted.md",
    "blog/assets/images/uploads/new.webp",
    "blog/assets/images/imported/old/deleted.webp",
    "blog/assets/images/video-posters/replaced.webp",
    "blog/assets/videos/uploads/clip.mp4",
    "blog/assets/videos/uploads/clip.webm",
    "blog/assets/files/gpx/uploads/tour.gpx",
    "blog/_data/videoMetadata.json"
  ];
  const fullCases = [
    "blog/layouts/post.njk",
    "blog/about.njk",
    "blog/projects.njk",
    "blog/assets/css-src/main/01-foundation.css",
    "blog/assets/js/site.js",
    "blog/admin/index.html",
    ".github/workflows/build.yml",
    "package.json",
    "blog/assets/images/imported/raw.jpg"
  ];

  for (const filePath of contentCases) assert.equal(plan([{ path: filePath, kind: "delete" }]).mode, "content", filePath);
  for (const filePath of fullCases) assert.equal(plan([{ path: filePath, kind: "upsert" }]).mode, "full", filePath);
  const mixed = plan(["blog/posts/article.md", "blog/assets/js/site.js"]);
  assert.equal(mixed.mode, "full");
  assert.deepEqual(mixed.fullValidationPaths, ["blog/assets/js/site.js"]);
});
