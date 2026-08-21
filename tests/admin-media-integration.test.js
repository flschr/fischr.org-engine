const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");
const ffmpeg = require("ffmpeg-static");

const projectRoot = path.join(__dirname, "..");

function run(cwd, command, args, env = {}) {
  return execFileSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
}

function git(cwd, ...args) {
  return run(cwd, "git", args);
}

function setup(name) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const source = path.join(temp, "source");
  const origin = path.join(temp, "origin.git");
  const runner = path.join(temp, "runner");
  fs.mkdirSync(source);
  git(source, "init", "-b", "drafts");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.test");
  fs.mkdirSync(path.join(source, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(source, ".gitignore"), "node_modules\n");
  fs.symlinkSync(path.join(projectRoot, "node_modules"), path.join(source, "node_modules"), "dir");
  return { temp, source, origin, runner };
}

function publishFixture({ temp, source, origin, runner }) {
  git(temp, "init", "--bare", origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "push", "origin", "drafts");
  git(temp, "clone", "--branch", "drafts", origin, runner);
  fs.symlinkSync(path.join(projectRoot, "node_modules"), path.join(runner, "node_modules"), "dir");
  git(runner, "config", "user.name", "Test");
  git(runner, "config", "user.email", "test@example.test");
}

test("GitHub image normalization preserves a concurrent draft save", async () => {
  const fixture = setup("admin-image-real");
  const rawPath = "blog/assets/images/uploads/test.png";
  const targetPath = "blog/assets/images/uploads/test.webp";
  const absoluteRaw = path.join(fixture.source, rawPath);
  fs.mkdirSync(path.dirname(absoluteRaw), { recursive: true });
  await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#663399" } }).png().toFile(absoluteRaw);
  fs.copyFileSync(path.join(projectRoot, "scripts/admin-normalize-image.js"), path.join(fixture.source, "scripts/admin-normalize-image.js"));
  git(fixture.source, "add", ".");
  git(fixture.source, "commit", "-m", "raw upload");
  const expectedSha = git(fixture.source, "rev-parse", "HEAD");
  fs.mkdirSync(path.join(fixture.source, "blog/posts"), { recursive: true });
  fs.writeFileSync(path.join(fixture.source, "blog/posts/later.md"), "later save\n");
  git(fixture.source, "add", ".");
  git(fixture.source, "commit", "-m", "later save");
  publishFixture(fixture);

  run(fixture.runner, "node", ["scripts/admin-normalize-image.js"], {
    DRAFT_SHA: expectedSha,
    SOURCE_PATH: rawPath,
    TARGET_PATH: targetPath
  });
  git(fixture.runner, "fetch", "origin", "drafts");
  assert.throws(() => git(fixture.runner, "show", `origin/drafts:${rawPath}`));
  assert.equal(git(fixture.runner, "show", "origin/drafts:blog/posts/later.md"), "later save");
  const webp = execFileSync("git", ["show", `origin/drafts:${targetPath}`], { cwd: fixture.runner });
  const metadata = await sharp(webp).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1600);
});

test("GitHub video preparation creates reviewed metadata and preserves a concurrent save", () => {
  const fixture = setup("admin-video-real");
  const videoPath = "blog/assets/videos/uploads/test.mp4";
  const absoluteVideo = path.join(fixture.source, videoPath);
  fs.mkdirSync(path.dirname(absoluteVideo), { recursive: true });
  fs.mkdirSync(path.join(fixture.source, "blog/_data"), { recursive: true });
  fs.writeFileSync(path.join(fixture.source, "blog/_data/videoMetadata.json"), "{}\n");
  run(fixture.source, ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1", "-pix_fmt", "yuv420p", absoluteVideo]);
  for (const script of ["admin-prepare-video.js", "generate-video-posters.js"]) {
    fs.copyFileSync(path.join(projectRoot, "scripts", script), path.join(fixture.source, "scripts", script));
  }
  git(fixture.source, "add", ".");
  git(fixture.source, "commit", "-m", "video upload");
  const expectedSha = git(fixture.source, "rev-parse", "HEAD");
  fs.mkdirSync(path.join(fixture.source, "blog/posts"), { recursive: true });
  fs.writeFileSync(path.join(fixture.source, "blog/posts/later.md"), "later save\n");
  git(fixture.source, "add", ".");
  git(fixture.source, "commit", "-m", "later save");
  publishFixture(fixture);

  run(fixture.runner, "node", ["scripts/admin-prepare-video.js"], {
    DRAFT_SHA: expectedSha,
    SOURCE_PATH: videoPath
  });
  git(fixture.runner, "fetch", "origin", "drafts");
  const metadata = JSON.parse(git(fixture.runner, "show", "origin/drafts:blog/_data/videoMetadata.json"));
  const item = metadata["/assets/videos/uploads/test.mp4"];
  assert.equal(item.width, 320);
  assert.equal(item.height, 180);
  assert.match(item.poster, /^\/assets\/images\/video-posters\/test\.webp$/);
  assert.equal(git(fixture.runner, "show", "origin/drafts:blog/posts/later.md"), "later save");
  assert.doesNotThrow(() => git(fixture.runner, "show", `origin/drafts:blog${item.poster}`));
});
