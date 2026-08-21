const test = require("node:test");
const assert = require("node:assert/strict");

const { parseFiveStarRating, ratingTitleAria, renderRatingTitle, renderRatingTitleHtml } = require("../lib/eleventy/ratings");

test("renders stored five-point ratings as five stars", () => {
  assert.equal(renderRatingTitle("Gone Girl (2/5)"), "Gone Girl (★★☆☆☆)");
  assert.equal(renderRatingTitle("Moon (5/5)"), "Moon (★★★★★)");
  assert.equal(renderRatingTitle("The Guilty (0/5)"), "The Guilty (☆☆☆☆☆)");
  assert.equal(renderRatingTitle("Bugonia 5/5"), "Bugonia (★★★★★)");
});

test("leaves unrelated title suffixes untouched", () => {
  assert.equal(renderRatingTitle("Pluribus, S1"), "Pluribus, S1");
  assert.equal(renderRatingTitle("Acht von zehn (8/10)"), "Acht von zehn (8/10)");
  assert.equal(parseFiveStarRating("Kapitel (6/5)"), null);
});

test("provides a natural accessible rating label", () => {
  assert.equal(ratingTitleAria("Americana (5/5)"), "Americana, 5 von 5 Sternen");
  assert.equal(ratingTitleAria("Ohne Wertung"), "Ohne Wertung");
});

test("renders visible stars in a separately styleable safe span", () => {
  assert.equal(
    renderRatingTitleHtml("Gone & Girl (2/5)"),
    'Gone &amp; Girl <span class="rating-stars" aria-hidden="true">(★★☆☆☆)</span>'
  );
});
