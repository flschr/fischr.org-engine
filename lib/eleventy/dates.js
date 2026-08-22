// Every calendar date the site renders is a date in the author's timezone, not
// in the build machine's. GitHub Actions runs in UTC, so a post dated
// 2026-08-23T00:27+02:00 would otherwise render as "22. Aug. 2026" in
// production and as "23. Aug. 2026" on a local build.
const SITE_TIME_ZONE = "Europe/Berlin";

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

// Intl is the only reliable way to get the calendar parts of an instant in a
// named zone; en-CA happens to format them as YYYY-MM-DD.
const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function siteDateParts(value) {
  const [year, month, day] = isoDateFormatter.format(toDate(value)).split("-");
  return { year: Number(year), month: Number(month), day: Number(day) };
}

function formatSiteDate(value, locale = "de-DE") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: SITE_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(toDate(value));
}

function siteHtmlDate(value) {
  return isoDateFormatter.format(toDate(value));
}

function siteYear(value) {
  return siteDateParts(value).year;
}

module.exports = {
  SITE_TIME_ZONE,
  formatSiteDate,
  siteDateParts,
  siteHtmlDate,
  siteYear
};
