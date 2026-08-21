#!/usr/bin/env node
// Post-build step: uploads generated responsive image variants and video posters to R2 and
// records them in automation/media-manifest.json, so the delivery mapping in
// lib/eleventy/media-assets.js (toDeliveryUrl) picks them up as "migrated" on the next build.
//
// This intentionally runs AFTER `eleventy` finishes, not during rendering: rendering decides
// each <img>/<video>'s emitted URL from the manifest as it stood at the *start* of the build,
// so a brand-new responsive variant is served from Cloudflare Pages for that one build, then
// from media.mysite.example from the next build onward once this step has uploaded it. Existing,
// previously-uploaded variants are unaffected (their hash-named file, and therefore their
// manifest entry, never changes) — this only ever affects genuinely new/changed images.

const fs = require("fs");
const path = require("path");

const { loadManifest, saveManifest, publishMediaFile } = require("./lib/r2-media");

const root = process.cwd();
const responsiveRoot = path.join(root, "_site/assets/images/responsive");
const posterRoot = path.join(root, "blog/assets/images/video-posters");

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : entry.isFile() ? [full] : [];
  });
}

function publicPathFor(localPath, root, prefix) {
  return `${prefix}${path.relative(root, localPath).split(path.sep).join("/")}`;
}

const concurrency = Number.parseInt(process.env.R2_UPLOAD_CONCURRENCY || "12", 10);

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function runNext() {
    const index = next;
    next += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index]);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

async function main() {
  const manifest = loadManifest();
  const candidates = [
    ...listFiles(responsiveRoot).map((file) => ({
      localPath: file,
      publicPath: publicPathFor(file, responsiveRoot, "/assets/images/responsive/")
    })),
    ...listFiles(posterRoot).map((file) => ({
      localPath: file,
      publicPath: publicPathFor(file, posterRoot, "/assets/images/video-posters/")
    }))
  ];

  // publishMediaFile mutates `manifest` synchronously right after its await resolves, and each
  // candidate has a distinct key — concurrent workers never touch the same entry at once.
  const results = await runWithConcurrency(candidates, concurrency, ({ localPath, publicPath }) =>
    publishMediaFile({ localPath, publicPath, manifest })
  );

  const uploaded = results.filter((result) => result === "uploaded").length;
  const unchanged = results.length - uploaded;

  saveManifest(manifest);
  console.log(`Build media publish: ${candidates.length} candidates, ${uploaded} uploaded, ${unchanged} already up to date.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
