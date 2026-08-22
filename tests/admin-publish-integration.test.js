const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const publishScript = fs.readFileSync(path.join(__dirname, "..", "scripts/admin-publish.js"), "utf8");
const sourcePagesScript = fs.readFileSync(path.join(__dirname, "..", "blog/admin/source-pages.js"), "utf8");
const publishPlanScript = fs.readFileSync(path.join(__dirname, "..", "blog/admin/publish-plan.js"), "utf8");
const publishValidationScript = fs.readFileSync(
  path.join(__dirname, "..", "scripts/lib/publish-validation.js"),
  "utf8"
);
const publishGitScript = fs.readFileSync(path.join(__dirname, "..", "scripts/lib/publish-git.js"), "utf8");
const reconcileDraftsScript = fs.readFileSync(path.join(__dirname, "..", "scripts/lib/reconcile-drafts.js"), "utf8");

function run(cwd, command, args, env = {}) {
  return execFileSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
}

function git(cwd, ...args) {
  return run(cwd, "git", args);
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test("transactional publish excludes later saves and preserves them after reconciliation", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-publish-transaction-"));
  const source = path.join(temp, "source");
  const origin = path.join(temp, "origin.git");
  const runner = path.join(temp, "runner");
  fs.mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.test");
  write(source, "blog/posts/reviewed.md", "published\n");
  write(source, "blog/posts/main-only.md", "keep-main\n");
  write(source, "blog/about.njk", "<article>published about</article>\n");
  write(source, "scripts/admin-publish.js", publishScript);
  write(source, "blog/admin/source-pages.js", sourcePagesScript);
  write(source, "blog/admin/publish-plan.js", publishPlanScript);
  write(source, "scripts/lib/publish-validation.js", publishValidationScript);
  write(source, "scripts/lib/publish-git.js", publishGitScript);
  write(source, "scripts/lib/reconcile-drafts.js", reconcileDraftsScript);
  write(source, "scripts/generate-video-posters.js", "// test no-op\n");
  write(source, "scripts/optimize-images.js", "// test no-op\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "main base");
  const mainSha = git(source, "rev-parse", "HEAD");

  git(source, "checkout", "-b", "drafts");
  write(source, "blog/posts/reviewed.md", "reviewed draft\n");
  write(source, "blog/about.njk", "<article>reviewed about source</article>\n");
  write(source, "blog/assets/files/gpx/uploads/reviewed.gpx", "<gpx><trk><trkseg /></trk></gpx>\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "reviewed change");
  const reviewedDraftSha = git(source, "rev-parse", "HEAD");
  write(source, "blog/posts/later.md", "saved after publish click\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "later save");

  git(temp, "init", "--bare", origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "push", "origin", "main", "drafts");
  git(temp, "clone", "--branch", "main", origin, runner);
  git(runner, "config", "user.name", "Test");
  git(runner, "config", "user.email", "test@example.test");
  const outputFile = path.join(temp, "outputs");
  run(runner, "node", ["scripts/admin-publish.js"], {
    PUBLISH_REQUEST_ID: "request-123",
    MAIN_SHA: mainSha,
    DRAFT_SHA: reviewedDraftSha,
    CHANGE_COUNT: "1",
    GITHUB_OUTPUT: outputFile
  });
  const finalSha = fs.readFileSync(outputFile, "utf8").match(/^final_sha=(.+)$/m)[1];
  assert.match(fs.readFileSync(outputFile, "utf8"), /^validation_mode=full$/m);
  assert.equal(git(runner, "show", `${finalSha}:blog/posts/reviewed.md`), "reviewed draft");
  assert.equal(git(runner, "show", `${finalSha}:blog/about.njk`), "<article>reviewed about source</article>");
  assert.equal(git(runner, "show", `${finalSha}:blog/posts/main-only.md`), "keep-main");
  assert.equal(
    git(runner, "show", `${finalSha}:blog/assets/files/gpx/uploads/reviewed.gpx`),
    "<gpx><trk><trkseg /></trk></gpx>"
  );
  assert.throws(() => git(runner, "show", `${finalSha}:blog/posts/later.md`));

  run(runner, "node", ["scripts/admin-publish.js", "--push-final"], {
    PUBLISH_REQUEST_ID: "request-123",
    MAIN_SHA: mainSha,
    DRAFT_SHA: reviewedDraftSha,
    FINAL_SHA: finalSha,
    BASE_SHA: mainSha
  });

  // Simulate a deploy that succeeded but stopped before drafts reconciliation.
  // Re-running the original reviewed request must enter recovery mode instead
  // of rejecting the already-published managed delta.
  const recoveryOutput = path.join(temp, "recovery-outputs");
  const recoveryLog = run(runner, "node", ["scripts/admin-publish.js"], {
    PUBLISH_REQUEST_ID: "request-123-recovery",
    MAIN_SHA: mainSha,
    DRAFT_SHA: reviewedDraftSha,
    CHANGE_COUNT: "1",
    GITHUB_OUTPUT: recoveryOutput
  });
  const recoveryFinalSha = fs.readFileSync(recoveryOutput, "utf8").match(/^final_sha=(.+)$/m)[1];
  assert.equal(recoveryFinalSha, finalSha);
  assert.match(recoveryLog, /reconciliation recovery mode/);
  run(runner, "node", ["scripts/admin-publish.js", "--reconcile-drafts"], {
    PUBLISH_REQUEST_ID: "request-123",
    MAIN_SHA: mainSha,
    DRAFT_SHA: reviewedDraftSha,
    FINAL_SHA: recoveryFinalSha
  });
  git(runner, "fetch", "origin", "main", "drafts");
  assert.equal(git(runner, "show", "origin/drafts:blog/posts/reviewed.md"), "reviewed draft");
  assert.equal(git(runner, "show", "origin/drafts:blog/about.njk"), "<article>reviewed about source</article>");
  assert.equal(git(runner, "show", "origin/drafts:blog/posts/later.md"), "saved after publish click");
  assert.equal(git(runner, "diff", "--name-only", "origin/main", "origin/drafts"), "blog/posts/later.md");
});

test("transactional publish removes the old path when a scheduled post is renamed", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-publish-rename-"));
  const source = path.join(temp, "source");
  const origin = path.join(temp, "origin.git");
  const runner = path.join(temp, "runner");
  fs.mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.test");
  write(source, "blog/posts/2026-08-06-post.md", "scheduled Thursday\n");
  write(source, "scripts/admin-publish.js", publishScript);
  write(source, "blog/admin/source-pages.js", sourcePagesScript);
  write(source, "blog/admin/publish-plan.js", publishPlanScript);
  write(source, "scripts/lib/publish-validation.js", publishValidationScript);
  write(source, "scripts/lib/publish-git.js", publishGitScript);
  write(source, "scripts/lib/reconcile-drafts.js", reconcileDraftsScript);
  write(source, "scripts/generate-video-posters.js", "// test no-op\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "published schedule");
  const mainSha = git(source, "rev-parse", "HEAD");

  git(source, "checkout", "-b", "drafts");
  git(source, "mv", "blog/posts/2026-08-06-post.md", "blog/posts/2026-08-02-post.md");
  write(source, "blog/posts/2026-08-02-post.md", "scheduled tomorrow\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "move publish date forward");
  const draftSha = git(source, "rev-parse", "HEAD");

  git(temp, "init", "--bare", origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "push", "origin", "main", "drafts");
  git(temp, "clone", "--branch", "main", origin, runner);
  const outputFile = path.join(temp, "outputs");
  run(runner, "node", ["scripts/admin-publish.js"], {
    PUBLISH_REQUEST_ID: "request-rename",
    MAIN_SHA: mainSha,
    DRAFT_SHA: draftSha,
    CHANGE_COUNT: "2",
    GITHUB_OUTPUT: outputFile
  });
  const finalSha = fs.readFileSync(outputFile, "utf8").match(/^final_sha=(.+)$/m)[1];

  assert.equal(git(runner, "show", `${finalSha}:blog/posts/2026-08-02-post.md`), "scheduled tomorrow");
  assert.throws(() => git(runner, "show", `${finalSha}:blog/posts/2026-08-06-post.md`));
});

test("transactional publish refuses a main commit that changed after review", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-publish-stale-main-"));
  const source = path.join(temp, "source");
  const origin = path.join(temp, "origin.git");
  const runner = path.join(temp, "runner");
  fs.mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.test");
  write(source, "blog/posts/post.md", "published\n");
  write(source, "scripts/admin-publish.js", publishScript);
  write(source, "blog/admin/source-pages.js", sourcePagesScript);
  write(source, "blog/admin/publish-plan.js", publishPlanScript);
  write(source, "scripts/lib/publish-validation.js", publishValidationScript);
  write(source, "scripts/lib/publish-git.js", publishGitScript);
  write(source, "scripts/lib/reconcile-drafts.js", reconcileDraftsScript);
  git(source, "add", ".");
  git(source, "commit", "-m", "reviewed main");
  const reviewedMainSha = git(source, "rev-parse", "HEAD");
  git(source, "checkout", "-b", "drafts");
  write(source, "blog/posts/post.md", "draft\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "draft");
  const draftSha = git(source, "rev-parse", "HEAD");
  git(source, "checkout", "main");
  write(source, "blog/posts/main-change.md", "newer main\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "main changed after review");
  git(temp, "init", "--bare", origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "push", "origin", "main", "drafts");
  git(temp, "clone", "--branch", "main", origin, runner);
  assert.throws(
    () => run(runner, "node", ["scripts/admin-publish.js"], {
      PUBLISH_REQUEST_ID: "request-stale",
      MAIN_SHA: reviewedMainSha,
      DRAFT_SHA: draftSha,
      CHANGE_COUNT: "1"
    }),
    /changed in publish-relevant files after review/
  );
});

// Regression: video sources live in R2 since DB-1129, so the publish checkout has no
// blog/assets/videos/ at all. The old gate regenerated posters here, which rewrote
// videoMetadata.json from an empty directory and failed every publish — including
// text-only ones.
test("transactional publish succeeds when video sources live only in R2", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-publish-r2-videos-"));
  const source = path.join(temp, "source");
  const origin = path.join(temp, "origin.git");
  const runner = path.join(temp, "runner");
  fs.mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.test");
  write(source, "blog/posts/post.md", "published\n");
  // Metadata for a migrated video whose bytes exist only in R2, never on disk here.
  write(source, "blog/_data/videoMetadata.json", JSON.stringify({
    "/assets/videos/imported/migrated.webm": {
      width: 1920,
      height: 1080,
      posterWidth: 640,
      posterHeight: 360,
      poster: "/assets/images/video-posters/migrated.webp",
      sourceHash: "abc123"
    }
  }, null, 2) + "\n");
  write(source, "scripts/admin-publish.js", publishScript);
  write(source, "blog/admin/source-pages.js", sourcePagesScript);
  write(source, "blog/admin/publish-plan.js", publishPlanScript);
  write(source, "scripts/lib/publish-validation.js", publishValidationScript);
  write(source, "scripts/lib/publish-git.js", publishGitScript);
  write(source, "scripts/lib/reconcile-drafts.js", reconcileDraftsScript);
  git(source, "add", ".");
  git(source, "commit", "-m", "main base");
  const mainSha = git(source, "rev-parse", "HEAD");

  git(source, "checkout", "-b", "drafts");
  write(source, "blog/posts/new-post.md", "reviewed text-only post\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "draft");
  const draftSha = git(source, "rev-parse", "HEAD");
  git(temp, "init", "--bare", origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "push", "origin", "main", "drafts");
  git(temp, "clone", "--branch", "main", origin, runner);

  run(runner, "node", ["scripts/admin-publish.js"], {
    PUBLISH_REQUEST_ID: "request-r2-videos",
    MAIN_SHA: mainSha,
    DRAFT_SHA: draftSha,
    CHANGE_COUNT: "1",
    GITHUB_OUTPUT: path.join(temp, "output.txt")
  });
  const finalSha = fs.readFileSync(path.join(temp, "output.txt"), "utf8").match(/^final_sha=(.+)$/m)[1];
  assert.equal(git(runner, "show", `${finalSha}:blog/posts/new-post.md`), "reviewed text-only post");
  // The metadata of the R2-only video must survive untouched.
  const metadata = JSON.parse(git(runner, "show", `${finalSha}:blog/_data/videoMetadata.json`));
  assert.ok(metadata["/assets/videos/imported/migrated.webm"]);
});

test("transactional publish refuses a reviewed video without prepared metadata", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-publish-video-gate-"));
  const source = path.join(temp, "source");
  const origin = path.join(temp, "origin.git");
  const runner = path.join(temp, "runner");
  fs.mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.test");
  write(source, "blog/posts/post.md", "published\n");
  write(source, "blog/_data/videoMetadata.json", "{}\n");
  write(source, "scripts/admin-publish.js", publishScript);
  write(source, "blog/admin/source-pages.js", sourcePagesScript);
  write(source, "blog/admin/publish-plan.js", publishPlanScript);
  write(source, "scripts/lib/publish-validation.js", publishValidationScript);
  write(source, "scripts/lib/publish-git.js", publishGitScript);
  write(source, "scripts/lib/reconcile-drafts.js", reconcileDraftsScript);
  git(source, "add", ".");
  git(source, "commit", "-m", "main base");
  const mainSha = git(source, "rev-parse", "HEAD");

  git(source, "checkout", "-b", "drafts");
  write(source, "blog/assets/videos/uploads/fresh.mp4", "not really a video\n");
  git(source, "add", "--force", "--", "blog/assets/videos/uploads/fresh.mp4");
  git(source, "commit", "-m", "video without metadata");
  const draftSha = git(source, "rev-parse", "HEAD");
  git(temp, "init", "--bare", origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "push", "origin", "main", "drafts");
  git(temp, "clone", "--branch", "main", origin, runner);

  assert.throws(
    () => run(runner, "node", ["scripts/admin-publish.js"], {
      PUBLISH_REQUEST_ID: "request-video-gate",
      MAIN_SHA: mainSha,
      DRAFT_SHA: draftSha,
      CHANGE_COUNT: "1"
    }),
    /Video metadata must be generated on drafts before review/
  );
});

// A prepared video is no longer a blob in the reviewed delta — admin-prepare-video.js uploads
// it to R2 and leaves an upload record. The gate has to recognize that shape too, or the only
// remaining video path stops being checked at all.
test("transactional publish refuses a reviewed video upload record without prepared metadata", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-publish-video-record-gate-"));
  const source = path.join(temp, "source");
  const origin = path.join(temp, "origin.git");
  const runner = path.join(temp, "runner");
  fs.mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.test");
  write(source, "blog/posts/post.md", "published\n");
  write(source, "blog/_data/videoMetadata.json", "{}\n");
  write(source, "scripts/admin-publish.js", publishScript);
  write(source, "blog/admin/source-pages.js", sourcePagesScript);
  write(source, "blog/admin/publish-plan.js", publishPlanScript);
  write(source, "scripts/lib/publish-validation.js", publishValidationScript);
  write(source, "scripts/lib/publish-git.js", publishGitScript);
  write(source, "scripts/lib/reconcile-drafts.js", reconcileDraftsScript);
  git(source, "add", ".");
  git(source, "commit", "-m", "main base");
  const mainSha = git(source, "rev-parse", "HEAD");

  git(source, "checkout", "-b", "drafts");
  write(source, "automation/media-uploads/videos__uploads__fresh.mp4.json", `${JSON.stringify({
    key: "videos/uploads/fresh.mp4",
    entry: { sha256: "abc", size: 10, contentType: "video/mp4" }
  }, null, 2)}\n`);
  git(source, "add", ".");
  git(source, "commit", "-m", "video record without metadata");
  const draftSha = git(source, "rev-parse", "HEAD");
  git(temp, "init", "--bare", origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "push", "origin", "main", "drafts");
  git(temp, "clone", "--branch", "main", origin, runner);

  assert.throws(
    () => run(runner, "node", ["scripts/admin-publish.js"], {
      PUBLISH_REQUEST_ID: "request-video-record-gate",
      MAIN_SHA: mainSha,
      DRAFT_SHA: draftSha,
      CHANGE_COUNT: "1"
    }),
    /Video metadata must be generated on drafts before review: \/assets\/videos\/uploads\/fresh\.mp4/
  );
});

// Regression: the gate compared the reviewed main against HEAD, but applyPathDelta only fills
// index and working tree — HEAD was still the untouched main commit, so the comparison never
// saw the reviewed delta and a raw upload travelled into the published tree.
test("transactional publish refuses an unnormalized image in the reviewed delta", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-publish-raw-image-"));
  const source = path.join(temp, "source");
  const origin = path.join(temp, "origin.git");
  const runner = path.join(temp, "runner");
  fs.mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.test");
  write(source, "blog/posts/post.md", "published\n");
  write(source, "blog/_data/videoMetadata.json", "{}\n");
  write(source, "scripts/admin-publish.js", publishScript);
  write(source, "blog/admin/source-pages.js", sourcePagesScript);
  write(source, "blog/admin/publish-plan.js", publishPlanScript);
  write(source, "scripts/lib/publish-validation.js", publishValidationScript);
  write(source, "scripts/lib/publish-git.js", publishGitScript);
  write(source, "scripts/lib/reconcile-drafts.js", reconcileDraftsScript);
  git(source, "add", ".");
  git(source, "commit", "-m", "main base");
  const mainSha = git(source, "rev-parse", "HEAD");

  git(source, "checkout", "-b", "drafts");
  write(source, "blog/assets/images/uploads/raw.jpg", "raw upload that never reached R2\n");
  git(source, "add", "--force", "--", "blog/assets/images/uploads/raw.jpg");
  git(source, "commit", "-m", "raw upload");
  const draftSha = git(source, "rev-parse", "HEAD");
  git(temp, "init", "--bare", origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "push", "origin", "main", "drafts");
  git(temp, "clone", "--branch", "main", origin, runner);

  assert.throws(
    () => run(runner, "node", ["scripts/admin-publish.js"], {
      PUBLISH_REQUEST_ID: "request-raw-image",
      MAIN_SHA: mainSha,
      DRAFT_SHA: draftSha,
      CHANGE_COUNT: "1"
    }),
    /Images must be normalized before review/
  );
});

test("transactional publish accepts a delta that only removes a raw upload", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-publish-raw-removed-"));
  const source = path.join(temp, "source");
  const origin = path.join(temp, "origin.git");
  const runner = path.join(temp, "runner");
  fs.mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.test");
  write(source, "blog/posts/post.md", "published\n");
  write(source, "blog/_data/videoMetadata.json", "{}\n");
  write(source, "blog/assets/images/uploads/raw.jpg", "leftover raw upload\n");
  write(source, "scripts/admin-publish.js", publishScript);
  write(source, "blog/admin/source-pages.js", sourcePagesScript);
  write(source, "blog/admin/publish-plan.js", publishPlanScript);
  write(source, "scripts/lib/publish-validation.js", publishValidationScript);
  write(source, "scripts/lib/publish-git.js", publishGitScript);
  write(source, "scripts/lib/reconcile-drafts.js", reconcileDraftsScript);
  git(source, "add", ".");
  git(source, "add", "--force", "--", "blog/assets/images/uploads/raw.jpg");
  git(source, "commit", "-m", "main base with a leftover raw upload");
  const mainSha = git(source, "rev-parse", "HEAD");

  git(source, "checkout", "-b", "drafts");
  // Normalization removes the raw upload; the WebP itself never enters Git, it goes to R2.
  git(source, "rm", "-q", "--", "blog/assets/images/uploads/raw.jpg");
  write(source, "automation/media-manifest.json", JSON.stringify({
    "images/uploads/raw.webp": { sourcePath: "blog/assets/images/uploads/raw.webp", sha256: "abc" }
  }, null, 2) + "\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "normalized upload");
  const draftSha = git(source, "rev-parse", "HEAD");
  git(temp, "init", "--bare", origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "push", "origin", "main", "drafts");
  git(temp, "clone", "--branch", "main", origin, runner);

  run(runner, "node", ["scripts/admin-publish.js"], {
    PUBLISH_REQUEST_ID: "request-raw-removed",
    MAIN_SHA: mainSha,
    DRAFT_SHA: draftSha,
    CHANGE_COUNT: "1",
    GITHUB_OUTPUT: path.join(temp, "output.txt")
  });
  const finalSha = fs.readFileSync(path.join(temp, "output.txt"), "utf8").match(/^final_sha=(.+)$/m)[1];
  assert.throws(() => git(runner, "show", `${finalSha}:blog/assets/images/uploads/raw.jpg`));
});
