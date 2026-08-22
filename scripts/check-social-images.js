#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { readMergedManifest } = require("../lib/media-manifest");

const siteRoot = path.resolve(process.cwd(), "_site");
const siteUrl = "https://mysite.example";
const mediaUrl = "https://media.mysite.example";
const mediaManifest = readMergedManifest(process.cwd());

if (!fs.existsSync(siteRoot)) {
  console.error("Missing _site. Run npm run build first.");
  process.exit(1);
}

const files = listFiles(siteRoot).filter((file) => file.endsWith(".html"));
const articleFiles = files.filter((file) => {
  const html = fs.readFileSync(file, "utf8");
  return html.includes('property="og:type" content="article"');
});

const problems = [];

for (const file of articleFiles) {
  const html = fs.readFileSync(file, "utf8");
  const relativeFile = path.relative(siteRoot, file);
  const ogImage = getMetaContent(html, "property", "og:image");
  const twitterImage = getMetaContent(html, "name", "twitter:image");
  const imageAlt = getMetaContent(html, "property", "og:image:alt");

  if (!ogImage) problems.push(`${relativeFile}: missing og:image`);
  if (!twitterImage) problems.push(`${relativeFile}: missing twitter:image`);
  if (!imageAlt) problems.push(`${relativeFile}: missing og:image:alt`);

  for (const [label, imageUrl] of [
    ["og:image", ogImage],
    ["twitter:image", twitterImage]
  ]) {
    if (!imageUrl) continue;

    if (imageUrl.startsWith(`${mediaUrl}/`)) {
      // Media-hosted images live in R2, not in _site — verify against the migration
      // manifest (the record of what was actually uploaded) instead of the filesystem.
      const key = decodeURI(new URL(imageUrl).pathname).slice(1);
      if (!mediaManifest[key]) {
        problems.push(`${relativeFile}: ${label} is not in the media manifest (${imageUrl})`);
      }
      continue;
    }

    if (!imageUrl.startsWith(`${siteUrl}/`)) {
      problems.push(`${relativeFile}: ${label} is not a local absolute URL (${imageUrl})`);
      continue;
    }

    const pathname = new URL(imageUrl).pathname;
    const assetPath = path.join(siteRoot, decodeURI(pathname));

    if (!fs.existsSync(assetPath)) {
      problems.push(`${relativeFile}: ${label} file does not exist in _site (${pathname})`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Found ${problems.length} social image problems:`);
  problems.slice(0, 50).forEach((item) => console.error(`- ${item}`));
  if (problems.length > 50) console.error(`...and ${problems.length - 50} more.`);
  process.exit(1);
}

console.log(`Checked ${articleFiles.length} article pages. Social preview images are present and local.`);

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }

  return files;
}

function getMetaContent(html, attributeName, attributeValue) {
  const escaped = attributeValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\s+${attributeName}=["']${escaped}["']\\s+content=["']([^"']+)["']`, "i");
  return html.match(pattern)?.[1] || "";
}
