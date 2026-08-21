#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ffmpeg = require("ffmpeg-static");
const ffprobe = require("ffprobe-static").path;

const root = process.cwd();
const videoRoot = path.join(root, "blog/assets/videos");
const posterRoot = path.join(root, "blog/assets/images/video-posters");
const metadataPath = path.join(root, "blog/_data/videoMetadata.json");
const supportedExtensions = new Set([".webm", ".mp4", ".m4v", ".mov"]);
const maxPosterEdge = 640;

main();

function main() {
  if (!fs.existsSync(videoRoot)) {
    writeJsonIfChanged(metadataPath, {});
    return;
  }

  fs.mkdirSync(posterRoot, { recursive: true });

  const previousMetadata = readJson(metadataPath);
  const videos = listFiles(videoRoot)
    .filter((file) => supportedExtensions.has(path.extname(file).toLowerCase()))
    .sort();
  const metadata = {};
  const usedPosterPaths = new Set();

  for (const videoPath of videos) {
    const publicVideoPath = toPublicPath(videoPath);
    const sourceHash = hashFile(videoPath);
    const previous = previousMetadata[publicVideoPath] || {};
    const dimensions = readVideoDimensions(videoPath);
    const posterPath = getPosterPath(videoPath, previous.poster, usedPosterPaths);
    const posterSize = getPosterSize(dimensions.width, dimensions.height);
    const publicPosterPath = toPublicPath(posterPath);

    usedPosterPaths.add(posterPath);

    const shouldRenderPoster = !fs.existsSync(posterPath) || (
      previous.sourceHash && previous.sourceHash !== sourceHash
    ) || (
      previous.posterWidth !== posterSize.width || previous.posterHeight !== posterSize.height
    );

    if (shouldRenderPoster) {
      renderPoster(videoPath, posterPath, dimensions, posterSize);
      console.log(`Generated ${path.relative(root, posterPath)} from ${path.relative(root, videoPath)}`);
    }

    metadata[publicVideoPath] = {
      width: dimensions.width,
      height: dimensions.height,
      posterWidth: posterSize.width,
      posterHeight: posterSize.height,
      poster: publicPosterPath,
      sourceHash
    };
  }

  writeJsonIfChanged(metadataPath, metadata);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeJsonIfChanged(filePath, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";

  if (next === previous) return;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next);
  console.log(`Updated ${path.relative(root, filePath)}`);
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
  });
}

function toPublicPath(filePath) {
  return `/${path.relative(path.join(root, "blog"), filePath).split(path.sep).join("/")}`;
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 16);
}

function readVideoDimensions(videoPath) {
  const result = JSON.parse(execFileSync(ffprobe, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,duration:format=duration",
    "-of",
    "json",
    videoPath
  ], { encoding: "utf8" }));
  const stream = result.streams && result.streams[0];

  if (!stream || !stream.width || !stream.height) {
    throw new Error(`Could not read video dimensions for ${path.relative(root, videoPath)}`);
  }

  return {
    width: Number(stream.width),
    height: Number(stream.height),
    duration: Number(stream.duration || result.format?.duration || 0)
  };
}

function getPosterPath(videoPath, previousPoster = "", usedPosterPaths) {
  if (previousPoster) {
    const existing = path.join(root, "blog", previousPoster.replace(/^\//, ""));
    if (isInside(existing, posterRoot) && !usedPosterPaths.has(existing)) return existing;
  }

  const parsed = path.parse(videoPath);
  const baseName = parsed.name.replace(/[^A-Za-z0-9._-]+/g, "-");
  let posterPath = path.join(posterRoot, `${baseName}.webp`);
  let counter = 2;

  while (usedPosterPaths.has(posterPath)) {
    posterPath = path.join(posterRoot, `${baseName}-${counter}.webp`);
    counter += 1;
  }

  return posterPath;
}

function isInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function renderPoster(videoPath, posterPath, dimensions, posterSize) {
  const seekTime = getSeekTime(dimensions.duration);

  fs.mkdirSync(path.dirname(posterPath), { recursive: true });
  execFileSync(ffmpeg, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(seekTime),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${posterSize.width}:${posterSize.height}`,
    "-compression_level",
    "6",
    "-quality",
    "70",
    posterPath
  ], { stdio: "inherit" });
}

function getSeekTime(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0.5;
  if (duration < 0.5) return 0;
  return Math.min(Math.max(duration * 0.08, 0.15), 1);
}

function getPosterSize(width, height) {
  if (width <= maxPosterEdge && height <= maxPosterEdge) {
    return { width, height };
  }

  if (width >= height) {
    return {
      width: maxPosterEdge,
      height: even((height / width) * maxPosterEdge)
    };
  }

  return {
    width: even((width / height) * maxPosterEdge),
    height: maxPosterEdge
  };
}

function even(value) {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}
