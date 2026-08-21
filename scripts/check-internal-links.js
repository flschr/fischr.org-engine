#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const siteRoot = path.resolve(process.cwd(), "_site");

if (!fs.existsSync(siteRoot)) {
  console.error("Missing _site. Run npm run build first.");
  process.exit(1);
}

const redirectSources = loadRedirectSources();
const files = listFiles(siteRoot).filter((file) => file.endsWith(".html"));
const broken = [];

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const matches = html.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi);

  for (const match of matches) {
    const rawUrl = match[1];
    if (!shouldCheck(rawUrl)) continue;

    const url = normalizeInternalUrl(rawUrl);
    if (!url || url === "/") continue;

    if (!targetExists(url)) {
      broken.push(`${path.relative(siteRoot, file)} -> ${rawUrl}`);
    }
  }
}

if (broken.length > 0) {
  console.error(`Found ${broken.length} broken internal links:`);
  broken.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}

console.log(`Checked ${files.length} HTML files. No broken internal links found.`);

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

function shouldCheck(value) {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/admin/") &&
    !value.startsWith("/api/") &&
    !value.startsWith("/cdn-cgi/")
  );
}

function normalizeInternalUrl(value) {
  const [withoutHash] = value.split("#");
  const [pathname] = withoutHash.split("?");
  return decodeURI(pathname);
}

function targetExists(url) {
  const target = path.join(siteRoot, url);

  return (
    redirectSources.has(url) ||
    fs.existsSync(target) ||
    fs.existsSync(`${target}.html`) ||
    fs.existsSync(path.join(target, "index.html"))
  );
}

function loadRedirectSources() {
  const redirectsPath = path.join(siteRoot, "_redirects");
  if (!fs.existsSync(redirectsPath)) return new Set();

  return new Set(
    fs
      .readFileSync(redirectsPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("/") && !line.includes("*") && !line.includes(":"))
      .map((line) => line.split(/\s+/)[0])
  );
}
