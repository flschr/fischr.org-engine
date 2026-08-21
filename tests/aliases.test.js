const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAlias,
  getAliasSources,
  getLegacyPostSource,
  getRedirectSources,
  normalizePath
} = require("../lib/eleventy/aliases");

test("normalizes internal alias paths", () => {
  assert.equal(normalizePath("https://example.com/bodenschneid-1669m/"), "/bodenschneid-1669m/");
  assert.equal(normalizePath("bodenschneid-1669m"), "/bodenschneid-1669m/");
});

test("builds aliases from legacy aliases and site original urls", () => {
  const sources = getAliasSources({
    old_alias: ["2026/05/27/bodenschneid-1669m"],
    original_url: "https://example.com/bodenschneid-1669m/"
  });

  assert.deepEqual(sources, ["2026/05/27/bodenschneid-1669m", "https://example.com/bodenschneid-1669m/"]);
  assert.deepEqual(buildAlias(sources[1], "/posts/2026-05-27-bodenschneid-1669m/", "Bodenschneid"), {
    from: "/bodenschneid-1669m/",
    to: "/posts/2026-05-27-bodenschneid-1669m/",
    title: "Bodenschneid"
  });
});

test("does not create original-url aliases for other domains", () => {
  assert.deepEqual(getAliasSources({ original_url: "https://example.com/external/" }), []);
});

test("builds a legacy posts source from a dated file slug", () => {
  assert.equal(
    getLegacyPostSource("2026-05-11-platschern-in-der-wand"),
    "/posts/2026-05-11-platschern-in-der-wand/"
  );
  assert.equal(getLegacyPostSource("platschern-in-der-wand"), "");
});

test("returns slash variants for redirect files", () => {
  assert.deepEqual(getRedirectSources("/bodenschneid-1669m/"), ["/bodenschneid-1669m", "/bodenschneid-1669m/"]);
});
