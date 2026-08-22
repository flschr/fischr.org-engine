#!/usr/bin/env node

const path = require("path");
const { execFileSync } = require("child_process");

const root = process.cwd();
const sourcePath = String(process.env.SOURCE_PATH || "").replace(/\\/g, "/");
const expectedDraftSha = process.env.DRAFT_SHA || "";
const draftsBranch = process.env.DRAFTS_BRANCH || "drafts";
const attempts = Number(process.env.VIDEO_PREPARE_ATTEMPTS || 8);

main();

function main() {
  validateRequest();
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  git(["cat-file", "-e", `${expectedDraftSha}^{commit}`]);
  const expectedBlob = git(["rev-parse", `${expectedDraftSha}:${sourcePath}`]);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    git(["fetch", "--quiet", "origin", draftsBranch]);
    const currentDraftSha = git(["rev-parse", `origin/${draftsBranch}`]);
    const currentBlob = gitOptional(["rev-parse", `${currentDraftSha}:${sourcePath}`]);
    if (currentBlob !== expectedBlob) {
      throw new Error(`${sourcePath} changed after upload; refusing to prepare different bytes.`);
    }

    git(["checkout", "--force", "-B", `admin-video-${process.pid}`, currentDraftSha]);
    run("node", ["scripts/generate-video-posters.js"]);
    // Poster bytes stay out of git: blog/assets/images/ is ignored since media moved to R2
    // (DB-1129), and the Build workflow regenerates the posters and uploads them through
    // scripts/publish-build-media.js. Only the metadata belongs in the drafts commit.
    git(["add", "-A", "--", "blog/_data/videoMetadata.json"]);
    if (gitSucceeds(["diff", "--cached", "--quiet"])) {
      console.log(`${sourcePath} already has current poster metadata.`);
      return;
    }
    git(["commit", "-m", `Prepare admin video ${path.basename(sourcePath)} [skip ci]`]);
    const commitSha = git(["rev-parse", "HEAD"]);
    if (gitSucceeds(["push", "origin", `${commitSha}:refs/heads/${draftsBranch}`])) {
      console.log(`Prepared ${sourcePath} before review.`);
      return;
    }
    console.log(`Drafts moved during video processing (attempt ${attempt}/${attempts}); retrying.`);
  }
  throw new Error(`Could not commit video derivatives after ${attempts} attempts.`);
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
