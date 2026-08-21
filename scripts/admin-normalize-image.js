#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const heicConvert = require("heic-convert");
const sharp = require("sharp");

const root = process.cwd();
const sourcePath = normalize(process.env.SOURCE_PATH || "");
const targetPath = normalize(process.env.TARGET_PATH || "");
const expectedDraftSha = process.env.DRAFT_SHA || "";
const draftsBranch = process.env.DRAFTS_BRANCH || "drafts";
const attempts = Number(process.env.NORMALIZE_ATTEMPTS || 8);

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  validateRequest();
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  git(["cat-file", "-e", `${expectedDraftSha}^{commit}`]);
  const expectedBlob = git(["rev-parse", `${expectedDraftSha}:${sourcePath}`]);
  git(["checkout", "--force", expectedDraftSha]);

  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-image-"));
  const normalizedFile = path.join(temporaryDir, "normalized.webp");
  try {
    const input = await sharpInput(path.join(root, sourcePath), path.extname(sourcePath).toLowerCase());
    await sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76 })
      .toFile(normalizedFile);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      git(["fetch", "--quiet", "origin", draftsBranch]);
      const currentDraftSha = git(["rev-parse", `origin/${draftsBranch}`]);
      const currentSourceBlob = gitOptional(["rev-parse", `${currentDraftSha}:${sourcePath}`]);
      const currentTargetBlob = gitOptional(["rev-parse", `${currentDraftSha}:${targetPath}`]);

      if (!currentSourceBlob && currentTargetBlob) {
        console.log(`${targetPath} is already normalized.`);
        return;
      }
      if (currentSourceBlob !== expectedBlob) {
        throw new Error(`${sourcePath} changed after upload; refusing to process different bytes.`);
      }

      git(["checkout", "-B", `admin-image-${process.pid}`, currentDraftSha]);
      const absoluteTarget = path.join(root, targetPath);
      fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
      fs.copyFileSync(normalizedFile, absoluteTarget);
      if (sourcePath !== targetPath) fs.rmSync(path.join(root, sourcePath), { force: true });
      git(["add", "-A", "--", sourcePath, targetPath]);
      if (gitSucceeds(["diff", "--cached", "--quiet"])) {
        console.log(`${sourcePath} already satisfies the normalization policy.`);
        return;
      }
      git(["commit", "-m", `Normalize admin upload ${path.basename(targetPath)} [skip ci]`]);
      const commitSha = git(["rev-parse", "HEAD"]);
      if (gitSucceeds(["push", "origin", `${commitSha}:refs/heads/${draftsBranch}`])) {
        console.log(`Normalized ${sourcePath} to ${targetPath}.`);
        return;
      }
      console.log(`Drafts moved during image processing (attempt ${attempt}/${attempts}); retrying.`);
    }
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
  throw new Error(`Could not commit normalized image after ${attempts} attempts.`);
}

function validateRequest() {
  const allowed = /^blog\/assets\/images\/uploads\/[a-zA-Z0-9._-]+$/;
  if (!expectedDraftSha) throw new Error("DRAFT_SHA is required.");
  if (!allowed.test(sourcePath) || !allowed.test(targetPath)) throw new Error("Invalid admin image path.");
  if (!targetPath.endsWith(".webp")) throw new Error("TARGET_PATH must end in .webp.");
  if (path.dirname(sourcePath) !== path.dirname(targetPath)) throw new Error("Image paths must share a directory.");
}

async function sharpInput(file, extension) {
  if (![".heic", ".heif"].includes(extension)) return file;
  return heicConvert({ buffer: fs.readFileSync(file), format: "JPEG", quality: 1 });
}

function normalize(value) {
  return String(value).replace(/\\/g, "/");
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitOptional(args) {
  try { return git(args); } catch { return ""; }
}

function gitSucceeds(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
