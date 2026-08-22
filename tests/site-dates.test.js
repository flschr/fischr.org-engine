const test = require("node:test");
const assert = require("node:assert/strict");

const { formatSiteDate, siteHtmlDate, siteYear } = require("../lib/eleventy/dates");

// The production build runs on GitHub Actions in UTC, the author writes in
// Europe/Berlin. Posts written between midnight and the UTC offset used to slip
// back onto the previous day in production only.
test("renders a post written just after midnight on its Berlin date", () => {
  const justAfterMidnightCest = "2026-08-23T00:27:00+02:00";

  assert.equal(formatSiteDate(justAfterMidnightCest), "23. Aug. 2026");
  assert.equal(siteHtmlDate(justAfterMidnightCest), "2026-08-23");
});

test("renders the Berlin date in winter time too", () => {
  const justAfterMidnightCet = "2026-01-05T00:30:00+01:00";

  assert.equal(formatSiteDate(justAfterMidnightCet), "05. Jan. 2026");
  assert.equal(siteHtmlDate(justAfterMidnightCet), "2026-01-05");
});

test("groups a New Year's post into the year it was written in", () => {
  assert.equal(siteYear("2026-01-01T00:30:00+01:00"), 2026);
  assert.equal(siteYear("2025-12-31T23:30:00+01:00"), 2025);
});

test("keeps a plain UTC timestamp on its Berlin date", () => {
  // 22:27Z in August is 00:27 the next day in Berlin.
  assert.equal(formatSiteDate("2026-08-22T22:27:00Z"), "23. Aug. 2026");
  assert.equal(siteHtmlDate("2026-08-22T22:27:00Z"), "2026-08-23");
});

test("accepts a Date instance as well as a string", () => {
  assert.equal(formatSiteDate(new Date("2026-08-22T22:27:00Z")), "23. Aug. 2026");
});
