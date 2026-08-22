#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ffmpeg = require("ffmpeg-static");
const ffprobe = require("ffprobe-static").path;

const { loadManifest, objectKeyForPublicPath } = require("./lib/r2-media");

const root = process.cwd();
const videoRoot = path.join(root, "blog/assets/videos");
const posterRoot = path.join(root, "blog/assets/images/video-posters");
const metadataPath = path.join(root, "blog/_data/videoMetadata.json");
const supportedExtensions = new Set([".webm", ".mp4", ".m4v", ".mov"]);
const maxPosterEdge = 640;

main();

function main() {
  if (!fs.existsSync(videoRoot)) {
    // No local video at all still means every migrated video keeps its entry: the sources are
    // materialized from R2 on demand, and writing {} here is exactly the wipe this file must
    // not perform.
    writeJsonIfChanged(metadataPath, sortByKey(remoteOnlyMetadata(readJson(metadataPath), [])));
    return;
  }

  fs.mkdirSync(posterRoot, { recursive: true });

  const previousMetadata = readJson(metadataPath);
  const videos = listFiles(videoRoot)
    .filter((file) => supportedExtensions.has(path.extname(file).toLowerCase()))
    .sort();
  const metadata = {};
  const usedPosterPaths = new Set();

  // A video that lives only in R2 is invisible here — scripts/prepare-media-source.js
  // materializes those on demand, and a job that skips that step (the admin's video
  // preparation) sees just the one upload it is about to process. Rebuilding this file from
  // the local directory alone would silently drop every other video's entry, and the admin
  // reads exactly this file to find a video's poster. Carry those entries over instead.
  for (const [publicPath, entry] of Object.entries(remoteOnlyMetadata(previousMetadata, videos))) {
    metadata[publicPath] = entry;
    if (entry.poster) usedPosterPaths.add(path.join(root, "blog", entry.poster));
  }

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

  writeJsonIfChanged(metadataPath, sortByKey(metadata));
}

// Entries whose video is absent from disk but recorded in the R2 media manifest. An entry that
// is in neither place refers to a genuinely deleted video and is dropped, as before.
function remoteOnlyMetadata(previousMetadata, localVideos) {
  const localPublicPaths = new Set(localVideos.map((videoPath) => toPublicPath(videoPath)));
  const manifest = loadManifest();
  return Object.fromEntries(
    Object.entries(previousMetadata).filter(([publicPath]) => (
      !localPublicPaths.has(publicPath) && Boolean(manifest[objectKeyForPublicPath(publicPath)])
    ))
  );
}

// Byte order, not localeCompare: this file is committed, and an ICU- or locale-dependent
// ordering would reshuffle it between the admin's GitHub job and a local build.
function sortByKey(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
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
