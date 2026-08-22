#!/usr/bin/env node

const path = require("path");
const { execFileSync } = require("child_process");

const { loadManifest, objectKeyForPublicPath, publishMediaFile, savePendingUpload } = require("./lib/r2-media");

const root = process.cwd();
const sourcePath = String(process.env.SOURCE_PATH || "").replace(/\\/g, "/");
const expectedDraftSha = process.env.DRAFT_SHA || "";
const draftsBranch = process.env.DRAFTS_BRANCH || "drafts";
const attempts = Number(process.env.VIDEO_PREPARE_ATTEMPTS || 8);
const metadataPath = "blog/_data/videoMetadata.json";

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  validateRequest();
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  git(["cat-file", "-e", `${expectedDraftSha}^{commit}`]);
  const publicPath = toPublicPath(sourcePath);
  const objectKey = objectKeyForPublicPath(publicPath);
  const expectedBlob = gitOptional(["rev-parse", `${expectedDraftSha}:${sourcePath}`]);
  if (!expectedBlob) {
    // The admin retries with whatever drafts head its tab last saw. Once an earlier run
    // finished, the video no longer exists in that commit — reporting the completed state
    // keeps the retry idempotent instead of resurfacing a media error for finished work.
    reportAlreadyProcessed(objectKey);
    return;
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    git(["fetch", "--quiet", "origin", draftsBranch]);
    const currentDraftSha = git(["rev-parse", `origin/${draftsBranch}`]);
    const currentBlob = gitOptional(["rev-parse", `${currentDraftSha}:${sourcePath}`]);
    git(["checkout", "--force", "-B", `admin-video-${process.pid}`, currentDraftSha]);

    if (!currentBlob) {
      if (loadManifest()[objectKey]) {
        console.log(`${sourcePath} is already prepared and in R2.`);
        return;
      }
      throw new Error(`${sourcePath} is already gone but never reached R2.`);
    }
    if (currentBlob !== expectedBlob) {
      throw new Error(`${sourcePath} changed after upload; refusing to prepare different bytes.`);
    }

    // Posters and dimensions are read off the local file, so this has to run before the video
    // leaves the checkout.
    run("node", ["scripts/generate-video-posters.js"]);

    // Video sources join the images in R2 (DB-1129): the bytes are uploaded here and the blob
    // is dropped, so a video no longer re-grows the repository. The build materializes it
    // again from the manifest (npm run media:source) whenever it needs the real file.
    const manifest = loadManifest();
    await publishMediaFile({ localPath: path.join(root, sourcePath), publicPath, sourcePath, manifest });
    const recordPath = savePendingUpload(objectKey, manifest[objectKey]);

    // Poster bytes stay out of git: blog/assets/images/ is ignored since media moved to R2,
    // and the Build workflow regenerates the posters and uploads them through
    // scripts/publish-build-media.js. Only the metadata and the upload record are committed.
    // `git rm` is what removes the video — `git add` refuses a pathspec inside an ignored
    // directory, which blog/assets/videos/ has been since the migration.
    git(["rm", "--quiet", "--ignore-unmatch", "--", sourcePath]);
    git(["add", "-A", "--", metadataPath, recordPath]);
    if (gitSucceeds(["diff", "--cached", "--quiet"])) {
      console.log(`${sourcePath} already has current poster metadata.`);
      return;
    }
    git(["commit", "-m", `Prepare admin video ${path.basename(sourcePath)} [skip ci]`]);
    const commitSha = git(["rev-parse", "HEAD"]);
    if (gitSucceeds(["push", "origin", `${commitSha}:refs/heads/${draftsBranch}`])) {
      console.log(`Prepared ${sourcePath} and uploaded it to R2 as ${publicPath}.`);
      return;
    }
    console.log(`Drafts moved during video processing (attempt ${attempt}/${attempts}); retrying.`);
  }
  throw new Error(`Could not commit video derivatives after ${attempts} attempts.`);
}

function reportAlreadyProcessed(objectKey) {
  git(["fetch", "--quiet", "origin", draftsBranch]);
  git(["checkout", "--force", `origin/${draftsBranch}`]);
  if (!loadManifest()[objectKey]) {
    throw new Error(`${sourcePath} is missing from ${expectedDraftSha} and never reached R2.`);
  }
  console.log(`${sourcePath} is already prepared and in R2.`);
}

function toPublicPath(relativePath) {
  return `/${relativePath.replace(/^blog\//, "")}`;
}

function validateRequest() {
  if (!expectedDraftSha) throw new Error("DRAFT_SHA is required.");
  if (!/^blog\/assets\/videos\/uploads\/[a-zA-Z0-9._-]+\.(?:m4v|mov|mp4|webm)$/i.test(sourcePath)) {
    throw new Error("Invalid admin video path.");
  }
}

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function git(args) {
  return run("git", args);
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
