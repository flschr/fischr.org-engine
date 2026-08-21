const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const publishScript = fs.readFileSync(path.join(root, "scripts/admin-publish.js"), "utf8");
const publishGitScript = fs.readFileSync(path.join(root, "scripts/lib/publish-git.js"), "utf8");
const reconcileDraftsScript = fs.readFileSync(path.join(root, "scripts/lib/reconcile-drafts.js"), "utf8");
const alignWorkflow = fs.readFileSync(path.join(root, ".github/workflows/align-drafts.yml"), "utf8");
const normalizeWorkflow = fs.readFileSync(path.join(root, ".github/workflows/admin-normalize-image.yml"), "utf8");
const normalizeScript = fs.readFileSync(path.join(root, "scripts/admin-normalize-image.js"), "utf8");
const videoWorkflow = fs.readFileSync(path.join(root, ".github/workflows/admin-prepare-video.yml"), "utf8");
const videoScript = fs.readFileSync(path.join(root, "scripts/admin-prepare-video.js"), "utf8");
const optimizeWorkflow = fs.readFileSync(path.join(root, ".github/workflows/optimize-images.yml"), "utf8");

test("admin publish assembles the reviewed snapshot without mutating reviewed images", () => {
  assert.doesNotMatch(publishScript, /git\(\["rebase"/);
  assert.match(publishScript, /checkoutBranch\(workBranch, currentMainSha\)/);
  assert.match(publishScript, /applyPathDelta\(expectedMainSha, expectedDraftSha, managedPaths\)/);
  assert.doesNotMatch(publishScript, /optimize-images\.js/);
  assert.match(publishScript, /assertReviewedImagesNormalized/);
  assert.match(publishScript, /"blog\/assets\/files\/gpx"/);
});

test("admin publish advances protected drafts without a force push", () => {
  assert.match(publishScript, /"commit-tree", tree/);
  assert.match(reconcileDraftsScript, /"-p", currentDraftSha/);
  assert.match(reconcileDraftsScript, /"-p", finalCommit/);
  assert.doesNotMatch(reconcileDraftsScript, /force-with-lease/);
  assert.match(reconcileDraftsScript, /could not reconcile/);
  assert.match(publishGitScript, /"checkout", "--force", "-B"/);
});

test("draft alignment merges main with a normal protected-branch push", () => {
  assert.match(alignWorkflow, /git merge --no-ff -X ours/);
  assert.match(alignWorkflow, /git push origin HEAD:refs\/heads\/drafts/);
  assert.doesNotMatch(alignWorkflow, /git push --force/);
  assert.match(alignWorkflow, /requires repair/);
  assert.doesNotMatch(alignWorkflow, /::warning::Merge/);
});

test("video derivatives are generated on drafts and publish only verifies them", () => {
  assert.match(videoWorkflow, /workflow_dispatch:/);
  assert.match(videoScript, /generate-video-posters\.js/);
  assert.match(videoScript, /Prepared .* before review/);
  assert.match(publishScript, /assertVideoDerivativesPrepared/);
  assert.doesNotMatch(publishScript, /function generateVideoPosters/);
});

test("legacy image optimizer is explicit maintenance and cannot race automatic deploys", () => {
  assert.match(optimizeWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(optimizeWorkflow, /push:\s*\n\s*branches:/);
  assert.match(optimizeWorkflow, /exit 1/);
});

test("admin images are normalized on GitHub before publish review", () => {
  assert.match(normalizeWorkflow, /workflow_dispatch:/);
  assert.match(normalizeWorkflow, /ref: \$\{\{ inputs\.draft_sha \}\}/);
  assert.match(normalizeScript, /\.webp\(\{ quality: 76 \}\)/);
  assert.match(normalizeScript, /withoutEnlargement: true/);
  assert.match(normalizeScript, /changed after upload; refusing/);
});
