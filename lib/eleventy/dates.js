// What a post shows is a calendar date, not an instant. The archive proves the
// two are not interchangeable: the 419 migrated posts carry a synthetic time of
// exactly 22:00Z/23:00Z (midnight Berlin), while posts written in the admin
// carry a real +01:00/+02:00 offset. Reading the calendar date off the
// timestamp therefore lands a day out for one group or the other, depending on
// the timezone doing the reading — the build runs in UTC on GitHub Actions and
// in Europe/Berlin locally.
//
// The file name is the one source that agrees with the intended date for every
// post, so that is what the site renders. `page.date` stays untouched and keeps
// doing what an instant is good for: ordering, feed timestamps, embargoes.

const FILE_NAME_DATE = /(\d{4})-(\d{2})-(\d{2})/;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A calendar date is rendered as UTC midnight so that no timezone can move it.
function calendarDateToUtc(value) {
  const match = CALENDAR_DATE.exec(String(value));
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function utcCalendarDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

// Posts are named YYYY-MM-DD-slug.md, and the date has to be read off the path:
// Eleventy has already stripped the prefix from page.fileSlug by the time
// computed data runs. Anything else falls back to the instant, read in UTC —
// the behaviour every page had before display dates existed.
function postDisplayDate(inputPath, fallbackDate) {
  const fileName = String(inputPath || "").split("/").pop();
  const match = FILE_NAME_DATE.exec(fileName);
  if (match && fileName.startsWith(match[0])) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return utcCalendarDate(fallbackDate);
}

function formatCalendarDate(value, locale = "de-DE") {
  const utc = calendarDateToUtc(value);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(utc || (value instanceof Date ? value : new Date(value)));
}

function calendarYear(value) {
  const match = CALENDAR_DATE.exec(String(value));
  if (match) return Number(match[1]);
  const fallback = utcCalendarDate(value);
  return fallback ? Number(fallback.slice(0, 4)) : NaN;
}

function isCalendarDate(value) {
  return typeof value === "string" && CALENDAR_DATE.test(value);
}

module.exports = {
  calendarYear,
  formatCalendarDate,
  isCalendarDate,
  postDisplayDate,
  utcCalendarDate
};
