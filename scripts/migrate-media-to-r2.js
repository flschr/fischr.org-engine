#!/usr/bin/env node
// One-time bulk migration (DB-1129 Stufe 3): uploads every image/video actually referenced
// from blog/posts/*.md and blog/pages/*.md to R2, and rewrites those references to the
// absolute media.mysite.example delivery URL. Nothing is deleted from Git — the committed files
// stay exactly where they are as a fallback until a later, separate cleanup step.
//
// Reuses the same reference parser blog/admin/markdown-media.js already provides to the
// sitemap/admin-media pipeline (lib/eleventy/media-references.js), so "what counts as a
// media reference" stays identical to production behavior — this script only adds precise
// offset-based rewriting of each found reference plus the R2 upload/manifest step.

const fs = require("fs");
const path = require("path");

const matter = require("gray-matter");

const { createMediaAssetHelpers } = require("../lib/eleventy/media-assets");
const { create: createMarkdownMedia } = require("../blog/admin/markdown-media");
const { setHtmlAttribute } = require("../lib/eleventy/html");
const { loadManifest, saveManifest, publishMediaFile } = require("./lib/r2-media");

const root = process.cwd();
const contentRoots = [path.join(root, "blog/posts"), path.join(root, "blog/pages")];
const dryRun = process.argv.includes("--dry-run");

const { findHtmlMedia, findMarkdownImages, findMediaShortcuts, visibleMarkdownSource } =
  createMarkdownMedia({
    stripMarkdownUrl: (value) => {
      const text = String(value || "").trim();
      if (text.startsWith("<") && text.endsWith(">")) return text.slice(1, -1);
      return text.replace(/\s+["'][^"']+["']$/, "");
    },
    extension: () => ""
  });

const media = createMediaAssetHelpers({ root });

function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(full);
    return entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
  });
}

// Reconstructs the exact raw target text a markdown image's src was found in, so replacing it
// preserves an existing title (`"Caption"`) or angle-bracket wrapping untouched.
function replaceSrcWithinTarget(target, oldSrc, newSrc) {
  if (target === oldSrc) return newSrc;
  if (target === `<${oldSrc}>`) return `<${newSrc}>`;
  if (target.startsWith(oldSrc)) return newSrc + target.slice(oldSrc.length);
  return target.split(oldSrc).join(newSrc);
}

function lineSpans(text) {
  const spans = [];
  let offset = 0;
  for (const segment of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!segment[0]) continue;
    spans.push({ from: offset, to: offset + segment[0].length, text: segment[0] });
    offset += segment[0].length;
  }
  return spans;
}

// Collects every media reference in a file (frontmatter `image:` + body) as a splice
// { from, to, replacement(resolvedAsset) => string } so all rewrites can be applied by
// descending offset without the earlier parses' offsets shifting under later edits.
function collectSplices(rawText, bodyOffset) {
  const splices = [];
  const body = rawText.slice(bodyOffset);
  const visibleBody = visibleMarkdownSource(body);

  for (const image of findMarkdownImages(visibleBody)) {
    const asset = media.getLocalImageAsset(image.src);
    if (!asset) continue;
    splices.push({
      from: bodyOffset + image.from,
      to: bodyOffset + image.to,
      asset,
      build: (deliveryUrl) => `![${image.alt}](${replaceSrcWithinTarget(image.target, image.src, deliveryUrl)})`
    });
  }

  for (const tag of findHtmlMedia(visibleBody)) {
    const rematch = visibleBody.slice(tag.from).match(/^<(img|video|source)\b[^>]*>/i);
    if (!rematch) continue;
    const asset = tag.type === "img" ? media.getLocalImageAsset(tag.src) : media.getLocalVideoAsset(tag.src);
    if (!asset) continue;
    const original = rematch[0];
    splices.push({
      from: bodyOffset + tag.from,
      to: bodyOffset + tag.from + original.length,
      asset,
      build: (deliveryUrl) => setHtmlAttribute(original, "src", deliveryUrl)
    });
  }

  const spans = lineSpans(visibleBody);
  for (const shortcut of findMediaShortcuts(visibleBody)) {
    if (shortcut.type !== "video") continue;
    const asset = media.getLocalVideoAsset(shortcut.source);
    if (!asset) continue;
    const span = spans.find((candidate) => candidate.from === shortcut.from);
    if (!span) continue;
    const line = span.text.replace(/[\r\n]+$/, "");
    const label = shortcut.label ? `[${shortcut.label}]` : "";
    splices.push({
      from: bodyOffset + span.from,
      to: bodyOffset + span.from + line.length,
      asset,
      build: (deliveryUrl) => `!${shortcut.type}${label}(${deliveryUrl})`
    });
  }

  return splices;
}

function findFrontmatterImageSplice(rawText, frontmatterEnd) {
  const frontmatter = rawText.slice(0, frontmatterEnd);
  const match = frontmatter.match(/^image:\s*(\S+)\s*$/m);
  if (!match) return null;

  const asset = media.getLocalImageAsset(match[1]);
  if (!asset) return null;

  const from = match.index + match[0].indexOf(match[1]);
  return { from, to: from + match[1].length, asset, build: (deliveryUrl) => deliveryUrl };
}

async function processFile(file, manifest, stats, referenced) {
  const rawText = fs.readFileSync(file, "utf8");
  const parsed = matter(rawText);
  const frontmatterEnd = rawText.length - parsed.content.length;

  const splices = collectSplices(rawText, frontmatterEnd);
  const frontmatterSplice = findFrontmatterImageSplice(rawText, frontmatterEnd);
  if (frontmatterSplice) splices.push(frontmatterSplice);

  if (splices.length === 0) return;

  splices.sort((a, b) => b.from - a.from);

  let nextText = rawText;
  for (const splice of splices) {
    referenced.add(splice.asset.localPath);
    stats.references += 1;

    if (!dryRun) {
      const result = await publishMediaFile({
        localPath: splice.asset.localPath,
        publicPath: splice.asset.publicPath,
        manifest
      });
      stats[result] = (stats[result] || 0) + 1;
    }

    const deliveryUrl = media.toDeliveryUrl(splice.asset.publicPath);
    nextText = nextText.slice(0, splice.from) + splice.build(deliveryUrl) + nextText.slice(splice.to);
  }

  if (nextText !== rawText) {
    stats.filesChanged += 1;
    if (!dryRun) fs.writeFileSync(file, nextText);
  }
}

function listAllMediaFiles() {
  const roots = [
    { dir: path.join(root, "blog/assets/images"), skip: (p) => p.includes(`${path.sep}responsive${path.sep}`) },
    { dir: path.join(root, "blog/assets/videos"), skip: () => false }
  ];

  const files = [];
  for (const { dir, skip } of roots) {
    const walk = (current) => {
      if (!fs.existsSync(current)) return;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && !skip(full)) files.push(full);
      }
    };
    walk(dir);
  }
  return files;
}

async function main() {
  const manifest = loadManifest();
  const stats = { references: 0, filesChanged: 0, uploaded: 0, unchanged: 0 };
  const referenced = new Set();

  const files = contentRoots.flatMap(listMarkdownFiles).sort();
  console.log(`Scanning ${files.length} markdown files under blog/posts and blog/pages...`);

  for (const file of files) {
    await processFile(file, manifest, stats, referenced);
  }

  if (!dryRun) saveManifest(manifest);

  const allMediaFiles = listAllMediaFiles();
  const orphaned = allMediaFiles.filter((file) => !referenced.has(file)).sort();

  console.log(`\nFiles scanned: ${files.length}`);
  console.log(`Files rewritten: ${stats.filesChanged}`);
  console.log(`Media references resolved: ${stats.references} (${referenced.size} distinct files)`);
  console.log(`R2 uploads: ${stats.uploaded || 0} uploaded, ${stats.unchanged || 0} already up to date`);
  console.log(`Unreferenced media files (not migrated, left as-is): ${orphaned.length}`);

  if (orphaned.length > 0) {
    const reportPath = path.join(root, "automation/unreferenced-media-report.json");
    if (!dryRun) fs.writeFileSync(reportPath, `${JSON.stringify(orphaned.map((f) => path.relative(root, f)), null, 2)}\n`);
    console.log(`  → see ${dryRun ? "(dry run, not written)" : path.relative(root, reportPath)}`);
  }

  if (dryRun) console.log("\n--dry-run: no files were written, nothing was uploaded.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
