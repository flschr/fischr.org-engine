#!/usr/bin/env node
// One-time migration (DB-1129): uploads the fixed set of site-wide "chrome" images — favicons,
// PWA icons, the default Open Graph image, the 404 illustration, and the fish-line CSS
// background — to R2 and rewrites their references to the media.mysite.example delivery URL.
//
// These are never referenced from post/page Markdown (scripts/migrate-media-to-r2.js's job),
// only from site-wide templates/CSS/JS — and unlike other template-hardcoded assets, they're
// few, stable, and safe to actually migrate rather than just excluded from the orphan report.
// Nothing is deleted from Git; the committed files stay as a fallback exactly like the earlier
// content migration did.

const fs = require("fs");
const path = require("path");

const { loadManifest, saveManifest, publishMediaFile } = require("./lib/r2-media");
const { createMediaAssetHelpers } = require("../lib/eleventy/media-assets");

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");

// Mirrors scripts/export-public-engine.js's publicImageFiles — the set of site-wide chrome
// images considered safe/non-personal there is exactly the set actually migrated here.
const chromeImagePaths = [
  "blog/assets/images/404.webp",
  "blog/assets/images/apple-touch-icon.png",
  "blog/assets/images/favicon-16x16.png",
  "blog/assets/images/favicon-32x32.png",
  "blog/assets/images/favicon.ico",
  "blog/assets/images/fish-line.svg",
  "blog/assets/images/icon-192-maskable.png",
  "blog/assets/images/icon-192.png",
  "blog/assets/images/icon-512-maskable.png",
  "blog/assets/images/icon-512.png",
  "blog/assets/images/og-default.webp"
];

// Every reference below is a plain string in template/CSS/JS source, not user content, so a
// literal find/replace against the local /assets/images/... path is enough — no markdown
// parsing needed like scripts/migrate-media-to-r2.js's content splices.
const referenceSources = [
  "blog/_includes/layouts/base.njk",
  "blog/site.webmanifest.njk",
  "blog/404.md",
  "blog/assets/css-src/main/02-document-base.css",
  "lib/eleventy/social.js"
];

function publicPathFor(relativePath) {
  return `/${relativePath.replace(/^blog\//, "")}`;
}

async function main() {
  const manifest = loadManifest();
  let uploaded = 0;

  for (const relativePath of chromeImagePaths) {
    if (dryRun) continue;
    const result = await publishMediaFile({
      localPath: path.join(root, relativePath),
      publicPath: publicPathFor(relativePath),
      manifest
    });
    if (result === "uploaded") uploaded += 1;
  }

  if (!dryRun) saveManifest(manifest);

  // Reuses the manifest just written above so toDeliveryUrl recognizes these keys as migrated
  // in this same run, instead of only on the next build once read back from disk.
  const media = createMediaAssetHelpers({ root, mediaManifest: manifest });
  let rewrites = 0;

  for (const relativePath of chromeImagePaths) {
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

  console.log(`\nChrome media migrate: ${chromeImagePaths.length} candidates, ${uploaded} uploaded, ${rewrites} reference(s) rewritten.`);
  if (dryRun) console.log("--dry-run: nothing was uploaded or written.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
