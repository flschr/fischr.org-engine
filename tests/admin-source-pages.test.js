const assert = require("node:assert/strict");
const test = require("node:test");
const sourcePages = require("../blog/admin/source-pages");

test("source-page registry exposes only the explicitly editable templates", () => {
  assert.deepEqual(sourcePages.paths(), ["blog/about.njk", "blog/projects.njk"]);
  assert.equal(sourcePages.has("blog/about.njk"), true);
  assert.equal(sourcePages.has("blog/projects.njk"), true);
  assert.equal(sourcePages.has("blog/archive.njk"), false);
  assert.deepEqual(sourcePages.get("blog/about.njk"), {
    path: "blog/about.njk",
    title: "Über mich",
    slug: "about"
  });
});
