const test = require("node:test");
const assert = require("node:assert/strict");

const { sitemapLastModified } = require("../lib/eleventy/sitemap");

test("sitemap lastmod prefers an explicitly maintained updated date", () => {
  const updated = new Date("2026-08-18T12:00:00Z");
  const published = new Date("2024-01-01T12:00:00Z");

  assert.equal(sitemapLastModified({
    date: published,
    data: { layout: "layouts/post.njk", updated }
  }), updated);
});

test("sitemap lastmod uses the publication date for blog posts", () => {
  const published = new Date("2026-08-12T12:00:00Z");

  assert.equal(sitemapLastModified({
    date: published,
    data: { layout: "layouts/post.njk" }
  }), published);
});

test("sitemap lastmod omits generated dates for static pages", () => {
  assert.equal(sitemapLastModified({
    date: new Date("2026-08-19T12:00:00Z"),
    data: { layout: "layouts/base.njk" }
  }), null);
});
