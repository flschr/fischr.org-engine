#!/usr/bin/env node

// Guards the invariant that a post is shown under the calendar date in its file
// name — on its own page, in the stream, and in the archive's year grouping.
//
// This checks the built HTML rather than the helper that produced it, because
// the bug it exists for (formatting an instant in the build machine's timezone,
// which moved 220 posts by a day in production while every unit test stayed
// green) only becomes visible once a page has been rendered.

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const siteRoot = path.join(root, "_site");
const postsRoot = path.join(root, "blog", "posts");
const failures = [];

const expected = new Map();
for (const name of fs.readdirSync(postsRoot)) {
  if (!name.endsWith(".md")) continue;
  const fileDate = name.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fileDate)) {
    failures.push(`${name}: file name does not start with a YYYY-MM-DD date`);
    continue;
  }
  const source = fs.readFileSync(path.join(postsRoot, name), "utf8");
  const slugMatch = /^slug:\s*["']?(.+?)["']?\s*$/m.exec(source.split(/^---$/m)[1] || "");
  const slug = slugMatch ? slugMatch[1] : name.slice(11).replace(/\.md$/, "");
  expected.set(slug, fileDate);
}

// Post pages: the visible date and the machine-readable one must both be the
// file name's date.
let checkedPages = 0;
for (const [slug, fileDate] of expected) {
  const page = path.join(siteRoot, slug, "index.html");
  if (!fs.existsSync(page)) continue; // draft or still under embargo
  checkedPages += 1;
  const html = fs.readFileSync(page, "utf8");
  const time = /<time class="dt-published"[^>]*>([^<]*)<\/time>/.exec(html);
  if (!time) {
    failures.push(`${slug}: no dt-published date on the page`);
    continue;
  }
  const shown = time[1].trim();
  if (shown !== renderGerman(fileDate)) {
    failures.push(`${slug}: page shows "${shown}", file name says ${fileDate} ("${renderGerman(fileDate)}")`);
  }
}

// Archive: datetime attribute per entry plus the year heading it sits under.
const archive = path.join(siteRoot, "archive", "index.html");
let checkedArchive = 0;
if (!fs.existsSync(archive)) {
  failures.push("no built archive page found");
} else {
  const html = fs.readFileSync(archive, "utf8");
  const list = html.slice(html.indexOf('id="archive-list"'));
  const pattern = /<h2>(\d{4})<\/h2>|<time datetime="([^"]*)">[^<]*<\/time>\s*<a href="\/([^/"]+)\//g;
  let year = null;
  let match;
  while ((match = pattern.exec(list)) !== null) {
    if (match[1]) {
      year = match[1];
      continue;
    }
    const [, , datetime, slug] = match;
    const fileDate = expected.get(slug);
    if (!fileDate) continue;
    checkedArchive += 1;
    if (datetime !== fileDate) {
      failures.push(`${slug}: archive datetime is ${datetime}, file name says ${fileDate}`);
    }
    if (year !== fileDate.slice(0, 4)) {
      failures.push(`${slug}: archive groups it under ${year}, file name says ${fileDate.slice(0, 4)}`);
    }
  }
}

if (checkedPages === 0) failures.push("no built post pages found");
if (checkedArchive === 0) failures.push("no archive entries found");

if (failures.length > 0) {
  console.error(`Post date check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}

console.log(`Post dates OK. ${checkedPages} pages and ${checkedArchive} archive entries match their file name.`);

function renderGerman(calendarDate) {
  const [year, month, day] = calendarDate.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
