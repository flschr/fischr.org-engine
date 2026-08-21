#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const videoRoot = path.join(root, "blog/assets/videos");
const videoExtensions = new Set([".m4v", ".mov", ".mp4", ".webm"]);
const maxVideoBytes = Number(process.env.MAX_VIDEO_BYTES || 20 * 1024 * 1024);
const maxTotalVideoBytes = Number(process.env.MAX_TOTAL_VIDEO_BYTES || 200 * 1024 * 1024);

main();

function main() {
  if (!fs.existsSync(videoRoot)) {
    console.log("Video media budget OK. No video directory.");
    return;
  }

  const videos = listFiles(videoRoot)
    .filter((file) => videoExtensions.has(path.extname(file).toLowerCase()))
    .map((file) => ({
      file,
      relative: path.relative(root, file),
      size: fs.statSync(file).size
    }))
    .sort((a, b) => b.size - a.size);

  const total = videos.reduce((sum, video) => sum + video.size, 0);
  const oversized = videos.filter((video) => video.size > maxVideoBytes);
  const failures = [];

  if (oversized.length) {
    failures.push(`Videos over ${formatBytes(maxVideoBytes)}:`);
    oversized.forEach((video) => {
      failures.push(`- ${video.relative} (${formatBytes(video.size)})`);
    });
  }

  if (total > maxTotalVideoBytes) {
    failures.push(`Video library is ${formatBytes(total)}; budget is ${formatBytes(maxTotalVideoBytes)}.`);
  }

  if (failures.length) {
    console.error("Video media budget failed.");
    console.error(failures.join("\n"));
    process.exit(1);
  }

  console.log(`Video media budget OK. ${videos.length} file${videos.length === 1 ? "" : "s"}, ${formatBytes(total)} total.`);
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
  });
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
