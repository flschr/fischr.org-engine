#!/usr/bin/env node
// One-time migration (DB-1129): uploads the remaining images embedded directly in site-wide
// .njk templates (the about-page portrait/gallery, author card, and project screenshots) to R2
// and rewrites their references — the same gap scripts/migrate-chrome-media-to-r2.js closed for
// favicons/icons/OG images. scripts/migrate-media-to-r2.js's main scan only covers
// blog/posts/*.md and blog/pages/*.md, so images hardcoded straight into .njk/.json never got
// uploaded, only counted as "referenced" (via templateReferencedAssetPaths()) to keep the
// orphan report accurate. Nothing is deleted from Git; the committed files stay as a fallback
// exactly like every earlier migration step here.

const fs = require("fs");
const path = require("path");

const { loadManifest, saveManifest, publishMediaFile } = require("./lib/r2-media");
const { createMediaAssetHelpers } = require("../lib/eleventy/media-assets");

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");

// Every reference below is a plain string in template/data source, not user content, so a
// literal find/replace against the local /assets/images/... path is enough.
const referenceSources = [
  "blog/about.njk",
  "blog/projects.njk",
  "blog/_data/site.json",
  "blog/_includes/partials/author-card.njk"
];

function publicPathFor(relativePath) {
  return `/${relativePath.replace(/^blog\//, "")}`;
}

// Derived from the reference sources at runtime instead of a hand-typed list, so this doesn't
// embed personal filenames (e.g. the about-page portrait) as string literals in engine code —
// scripts/export-public-engine.js scans exactly for that when building the public,
// personal-data-free version of this codebase. Mirrors migrate-media-to-r2.js's
// templateReferencedAssetPaths(), but returns repo-relative paths instead of absolute ones.
function discoverTemplateContentImagePaths() {
  const found = new Set();
  for (const relativePath of referenceSources) {
    const absolute = path.join(root, relativePath);
    if (!fs.existsSync(absolute)) continue;
    const text = fs.readFileSync(absolute, "utf8");
    for (const match of text.matchAll(/\/assets\/images\/[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+/g)) {
      found.add(`blog${match[0]}`);
    }
  }
  return [...found].sort();
}

async function main() {
  const manifest = loadManifest();
  const templateContentImagePaths = discoverTemplateContentImagePaths();
  let uploaded = 0;

  for (const relativePath of templateContentImagePaths) {
    if (dryRun) continue;
    const result = await publishMediaFile({
      localPath: path.join(root, relativePath),
      publicPath: publicPathFor(relativePath),
      manifest
    });
    if (result === "uploaded") uploaded += 1;
  }

  if (!dryRun) saveManifest(manifest);

  const media = createMediaAssetHelpers({ root, mediaManifest: manifest });
  let rewrites = 0;

  for (const relativePath of templateContentImagePaths) {
    const publicPath = publicPathFor(relativePath);
    const deliveryUrl = media.toDeliveryUrl(publicPath);
    if (deliveryUrl === publicPath) continue; // not (yet) migrated — leave references untouched

    for (const sourceRelativePath of referenceSources) {
      const sourcePath = path.join(root, sourceRelativePath);
      if (!fs.existsSync(sourcePath)) continue;

      const text = fs.readFileSync(sourcePath, "utf8");
      if (!text.includes(publicPath)) continue;

      const next = text.split(publicPath).join(deliveryUrl);
      if (next === text) continue;

      rewrites += 1;
      console.log(`Rewrote ${publicPath} -> ${deliveryUrl} in ${sourceRelativePath}`);
      if (!dryRun) fs.writeFileSync(sourcePath, next);
    }
  }

  console.log(`\nTemplate content media migrate: ${templateContentImagePaths.length} candidates, ${uploaded} uploaded, ${rewrites} reference(s) rewritten.`);
  if (dryRun) console.log("--dry-run: nothing was uploaded or written.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
