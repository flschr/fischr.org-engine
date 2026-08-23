#!/usr/bin/env node
// Post-build gate for the one invariant the R2 media boundary rests on: if an object is in the
// manifest, the built site must reference it on media.mysite.example — never on mysite.example.
//
// The delivery mapping itself (toDeliveryUrl in lib/eleventy/media-assets.js) is applied per
// emitter, and every emitter that forgot to call it produced HTML that still worked, because
// Cloudflare Pages also serves a copy of every migrated file. Three of them drifted that way
// unnoticed: the LCP preload link, the og:image/twitter:image pair, and the JSON-LD image. This
// checks the *output* instead of each emitter, so the next one cannot drift silently — and it
// is what has to be green before the local copies can stop being deployed at all.
//
// A local reference to something NOT in the manifest stays legal on purpose: that is the
// one-build lag for a responsive variant this build just generated (see docs/media.md), plus
// genuinely unmigrated assets. Both are still served from Pages, and correctly so.

const fs = require("fs");
const path = require("path");

const { readMergedManifest } = require("../lib/media-manifest");

const root = process.cwd();
const siteRoot = path.join(root, "_site");
const siteHost = "https://mysite.example";
// The admin is a private editor UI, not published output, and it resolves media through its own
// helpers against the live GitHub tree — it is not what this boundary is about.
const ignoredPrefixes = ["admin/"];
const checkedExtensions = new Set([".html", ".xml", ".json", ".txt", ".webmanifest"]);
// Built from siteHost rather than written as a regex literal: scripts/export-public-engine.js
// rewrites the plain host string in the exported snapshot, and an escaped-dot literal would
// survive that rewrite and quietly stop matching the site it is checking.
const referencePattern = new RegExp(
  `(?:${siteHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})?(/assets/(?:images|videos)/[^"'\\s)<>\\\\]+)`,
  "g"
);

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.isFile() && checkedExtensions.has(path.extname(entry.name).toLowerCase()) ? [full] : [];
  });
}

// Mirrors objectKeyForPublicPath in scripts/lib/r2-media.js, but returns "" instead of throwing:
// this walks arbitrary built output and must simply ignore anything that is not a media path.
function objectKeyFor(publicPath) {
  if (publicPath.startsWith("/assets/images/")) return `images/${publicPath.slice("/assets/images/".length)}`;
  if (publicPath.startsWith("/assets/videos/")) return `videos/${publicPath.slice("/assets/videos/".length)}`;
  return "";
}

// Strips the query and fragment a template may append (the favicons carry ?v=…) before the key
// lookup, so a cache-busted reference is still recognised as the object it points at.
function findLocalReferences(text) {
  return [...text.matchAll(referencePattern)].map(([, publicPath]) => decodeURI(publicPath.split("#")[0].split("?")[0]));
}

function main() {
  if (!fs.existsSync(siteRoot)) {
    console.error("Missing _site. Run npm run build first.");
    process.exit(1);
  }

  const manifest = readMergedManifest(root);
  const files = listFiles(siteRoot);
  const problems = [];
  let checked = 0;

  for (const file of files) {
    const relativeFile = path.relative(siteRoot, file).split(path.sep).join("/");
    if (ignoredPrefixes.some((prefix) => relativeFile.startsWith(prefix))) continue;
    checked += 1;

    const seen = new Set();
    for (const publicPath of findLocalReferences(fs.readFileSync(file, "utf8"))) {
      const key = objectKeyFor(publicPath);
      if (!key || !manifest[key] || seen.has(key)) continue;
      seen.add(key);
      problems.push(`${relativeFile}: ${publicPath} is in the media manifest but is served from ${siteHost}`);
    }
  }

  if (problems.length) {
    console.error(`Found ${problems.length} media references that should point at the delivery domain:`);
    problems.slice(0, 50).forEach((problem) => console.error(`- ${problem}`));
    if (problems.length > 50) console.error(`...and ${problems.length - 50} more.`);
    process.exit(1);
  }

  console.log(`Media delivery OK. ${checked} generated files reference every migrated object from the delivery domain.`);
}

main();
