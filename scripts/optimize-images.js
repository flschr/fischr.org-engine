#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const heicConvert = require("heic-convert");
const sharp = require("sharp");

const root = process.cwd();
const imageRoot = path.join(root, "blog/assets/images");
const contentRoots = [
  path.join(root, "blog/posts"),
  path.join(root, "blog/pages")
];
const siteUrl = "https://mysite.example";

const maxWidth = parseInteger(process.env.IMAGE_MAX_WIDTH, 1600);
const maxHeight = parseInteger(process.env.IMAGE_MAX_HEIGHT, 1600);
const quality = parseInteger(process.env.IMAGE_QUALITY, 76);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const all = args.includes("--all");
const fileListPath = getOptionValue("--file-list");

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

async function main() {
  const files = getInputFiles();
  const candidates = unique(files.map(normalizeRelativePath)).filter(shouldProcess);

  if (candidates.length === 0) {
    console.log("No candidate images found.");
    return;
  }

  let optimized = 0;
  let kept = 0;

  for (const relativeInput of candidates) {
    const result = await optimizeImage(relativeInput);
    if (result?.optimized) optimized += 1;
    if (result?.kept) kept += 1;
  }

  console.log(`Image optimization complete. Optimized: ${optimized}. Kept unchanged: ${kept}.`);
}

function getInputFiles() {
  if (fileListPath) {
    return fs
      .readFileSync(path.resolve(root, fileListPath), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const explicitFiles = args.filter((arg) => !arg.startsWith("--"));
  if (explicitFiles.length > 0) return explicitFiles;

  if (all) {
    return listFiles(imageRoot).map((file) => path.relative(root, file));
  }

  const changed = runGit([
    "diff",
    "--name-only",
    "--diff-filter=AM",
    "HEAD",
    "--",
    "blog/assets/images"
  ]);
  const untracked = runGit([
    "ls-files",
    "--others",
    "--exclude-standard",
    "blog/assets/images"
  ]);

  return `${changed}\n${untracked}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function optimizeImage(relativeInput) {
  const absoluteInput = path.join(root, relativeInput);
  const originalSize = fs.statSync(absoluteInput).size;
  const output = getOutputPath(relativeInput);
  const absoluteOutput = path.join(root, output);
  const tmpOutput = `${absoluteOutput}.tmp-${process.pid}.webp`;

  const sharpInput = await getSharpInput(absoluteInput, path.extname(relativeInput).toLowerCase());

  await sharp(sharpInput, { failOn: "none" })
    .rotate()
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: "inside",
      withoutEnlargement: true
    })
    .webp({ quality })
    .toFile(tmpOutput);

  const optimizedSize = fs.statSync(tmpOutput).size;

  if (optimizedSize >= originalSize) {
    fs.rmSync(tmpOutput, { force: true });
    console.log(`Kept ${relativeInput}; optimized file was not smaller.`);
    return { kept: true };
  }

  const fromPublicPath = toPublicPath(relativeInput);
  const toPublicPathValue = toPublicPath(output);

  if (dryRun) {
    fs.rmSync(tmpOutput, { force: true });
    console.log(
      `Would optimize ${relativeInput}: ${formatBytes(originalSize)} -> ${formatBytes(optimizedSize)}`
    );
    if (fromPublicPath !== toPublicPathValue) {
      console.log(`Would update references: ${fromPublicPath} -> ${toPublicPathValue}`);
    }
    return { optimized: true };
  }

  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.renameSync(tmpOutput, absoluteOutput);

  if (output !== relativeInput) {
    fs.rmSync(absoluteInput, { force: true });
    updateContentReferences(fromPublicPath, toPublicPathValue);
  }

  console.log(
    `Optimized ${relativeInput}: ${formatBytes(originalSize)} -> ${formatBytes(optimizedSize)}`
  );
  return { optimized: true };
}

function shouldProcess(relativePath) {
  if (!relativePath.startsWith("blog/assets/images/")) return false;
  if (relativePath.includes("/imported/")) return false;

  const basename = path.basename(relativePath).toLowerCase();
  if (
    basename.startsWith("favicon") ||
    basename.startsWith("apple-touch-icon") ||
    basename.startsWith("icon-") ||
    basename === "og-default.webp" ||
    basename === "404.webp"
  ) {
    return false;
  }

  return [".avif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"].includes(
    path.extname(relativePath).toLowerCase()
  );
}

async function getSharpInput(absoluteInput, extension) {
  if (extension !== ".heic" && extension !== ".heif") return absoluteInput;

  return heicConvert({
    buffer: fs.readFileSync(absoluteInput),
    format: "JPEG",
    quality: 1
  });
}

function getOutputPath(relativeInput) {
  const extension = path.extname(relativeInput).toLowerCase();
  if (extension === ".webp") return relativeInput;

  const parsed = path.parse(relativeInput);
  const preferred = path.join(parsed.dir, `${parsed.name}.webp`);
  if (!fs.existsSync(path.join(root, preferred))) return preferred;

  return path.join(parsed.dir, `${parsed.name}-optimized.webp`);
}

function updateContentReferences(fromPublicPath, toPublicPathValue) {
  const replacements = [
    [fromPublicPath, toPublicPathValue],
    [fromPublicPath.slice(1), toPublicPathValue.slice(1)],
    [`${siteUrl}${fromPublicPath}`, `${siteUrl}${toPublicPathValue}`]
  ];

  for (const rootDir of contentRoots) {
    for (const file of listFiles(rootDir).filter((item) => item.endsWith(".md"))) {
      const original = fs.readFileSync(file, "utf8");
      let next = original;

      for (const [from, to] of replacements) {
        next = next.split(from).join(to);
      }

      if (next !== original) fs.writeFileSync(file, next);
    }
  }
}

function toPublicPath(relativePath) {
  return `/${relativePath.replace(/^blog\//, "")}`;
}

function normalizeRelativePath(file) {
  const normalized = file.replace(/\\/g, "/");
  return path.isAbsolute(normalized) ? path.relative(root, normalized).replace(/\\/g, "/") : normalized;
}

function getOptionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}

function unique(values) {
  return [...new Set(values)];
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }

  return files;
}

function runGit(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" });
  } catch {
    return "";
  }
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
