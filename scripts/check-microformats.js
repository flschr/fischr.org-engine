#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { mf2 } = require("microformats-parser");

const root = path.resolve(__dirname, "..");
const siteRoot = path.join(root, "_site");
const failures = [];
let articleCount = 0;

for (const file of walkHtml(siteRoot)) {
  const html = fs.readFileSync(file, "utf8");
  if (!/<meta\b[^>]*property=["']og:type["'][^>]*content=["']article["']/i.test(html)) continue;

  articleCount += 1;
  const relative = path.relative(siteRoot, file);
  const baseUrl = new URL(relative.replace(/index\.html$/, ""), "https://mysite.example/").toString();
  const parsed = mf2(html, { baseUrl });
  const entry = parsed.items.find((item) => item.type?.includes("h-entry"));

  if (!entry) {
    failures.push(`${relative}: missing h-entry`);
    continue;
  }

  for (const property of ["name", "url", "published", "author"]) {
    if (!entry.properties?.[property]?.length) failures.push(`${relative}: missing ${property}`);
  }

  const author = entry.properties?.author?.[0];
  if (!author?.properties?.photo?.length) failures.push(`${relative}: author is missing photo`);
}

if (articleCount === 0) failures.push("no built article pages found");

if (failures.length > 0) {
  console.error(`Microformats check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}

console.log(`Microformats OK. ${articleCount} article pages parsed.`);

function* walkHtml(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walkHtml(file);
    else if (entry.isFile() && entry.name.endsWith(".html")) yield file;
  }
}
