const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calendarYear,
  formatCalendarDate,
  isCalendarDate,
  postDisplayDate,
  utcCalendarDate
} = require("../lib/eleventy/dates");

// The regression that made this file necessary: reading the calendar date off
// the timestamp lands a day out for one half of the archive or the other,
// because migrated posts carry a synthetic midnight-Berlin time while posts
// written in the admin carry a real offset. The file name agrees with both.
// The same rule is swept across the whole production archive in
// tests/post-archive-dates.test.js, which stays in the private source with it.

test("a display date survives a build machine in any timezone", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "Europe/Berlin", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      assert.equal(formatCalendarDate("2026-08-23"), "23. Aug. 2026", zone);
      assert.equal(calendarYear("2022-12-31"), 2022, zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("reads the date off the input path, not off the timestamp", () => {
  // Written in the admin after midnight: the instant is still the previous day in UTC.
  assert.equal(
    postDisplayDate("./blog/posts/2026-08-23-poker-face-staffel-2-4-5.md", new Date("2026-08-22T22:27:17Z")),
    "2026-08-23"
  );
  // Migrated: the synthetic time is already midnight Berlin of the following day.
  assert.equal(
    postDisplayDate("./blog/posts/2025-08-23-barbie.md", new Date("2025-08-23T22:00:00Z")),
    "2025-08-23"
  );
});

// Eleventy strips the date prefix from page.fileSlug before computed data runs,
// so the path is the only place the date is still there. Passing the slug must
// not silently look like it worked.
test("a date-stripped slug falls back instead of guessing", () => {
  assert.equal(postDisplayDate("poker-face-staffel-2-4-5", new Date("2026-08-22T22:27:17Z")), "2026-08-22");
});

test("falls back to the instant for input without a date in its name", () => {
  assert.equal(postDisplayDate("./blog/pages/about.md", new Date("2026-08-22T22:27:17Z")), "2026-08-22");
  assert.equal(postDisplayDate("", new Date("2026-08-22T22:27:17Z")), "2026-08-22");
  assert.equal(utcCalendarDate("not a date"), null);
});

test("only plain calendar dates take the calendar path", () => {
  assert.equal(isCalendarDate("2026-08-23"), true);
  assert.equal(isCalendarDate("2026-08-23T00:27:17+02:00"), false);
  assert.equal(isCalendarDate(new Date()), false);
});
