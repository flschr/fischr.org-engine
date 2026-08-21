const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");
const sharp = require("sharp");
const ffmpeg = require("ffmpeg-static");

const execFileAsync = promisify(execFile);
const projectRoot = path.join(__dirname, "..");

// A minimal stand-in for the R2 S3-compatible endpoint: accepts any PUT under /<bucket>/<key>
// and remembers the uploaded bodies, so the test can assert on what the script actually sent
// without depending on real Cloudflare credentials or network access. r2-media.js's
// R2_S3_ENDPOINT override (test-only) points the script at this instead of the real endpoint.
function startFakeR2Server() {
  const uploads = new Map();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (req.method === "PUT") uploads.set(req.url, Buffer.concat(chunks));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        endpoint: `http://127.0.0.1:${port}`,
        uploads,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function copyRelative(fromRoot, toRoot, relativePath) {
  const destination = path.join(toRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(fromRoot, relativePath), destination);
}

function run(cwd, command, args, env = {}) {
  return execFileSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
}

// execFileSync blocks this process's event loop for its whole duration, which would deadlock
// a child script that needs to reach an HTTP server running in-process here (the fake R2
// stub) — this async variant keeps the event loop free while the child runs.
async function runAsync(cwd, command, args, env = {}) {
  const { stdout } = await execFileAsync(command, args, { cwd, env: { ...process.env, ...env } });
  return stdout.trim();
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

test("GitHub image normalization uploads to R2 and preserves a concurrent draft save", async () => {
  const fixture = setup("admin-image-real");
  const rawPath = "blog/assets/images/uploads/test.png";
  const targetPath = "blog/assets/images/uploads/test.webp";
  const absoluteRaw = path.join(fixture.source, rawPath);
  fs.mkdirSync(path.dirname(absoluteRaw), { recursive: true });
  await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#663399" } }).png().toFile(absoluteRaw);
  copyRelative(projectRoot, fixture.source, "scripts/admin-normalize-image.js");
  copyRelative(projectRoot, fixture.source, "scripts/lib/r2-media.js");
  copyRelative(projectRoot, fixture.source, "lib/eleventy/social.js");
  copyRelative(projectRoot, fixture.source, "lib/eleventy/html.js");
  git(fixture.source, "add", ".");
  git(fixture.source, "commit", "-m", "raw upload");
  const expectedSha = git(fixture.source, "rev-parse", "HEAD");
  fs.mkdirSync(path.join(fixture.source, "blog/posts"), { recursive: true });
  fs.writeFileSync(path.join(fixture.source, "blog/posts/later.md"), "later save\n");
  git(fixture.source, "add", ".");
  git(fixture.source, "commit", "-m", "later save");
  publishFixture(fixture);

  const fakeR2 = await startFakeR2Server();
  try {
    await runAsync(fixture.runner, "node", ["scripts/admin-normalize-image.js"], {
      DRAFT_SHA: expectedSha,
      SOURCE_PATH: rawPath,
      TARGET_PATH: targetPath,
      CLOUDFLARE_ACCOUNT_ID: "test-account",
      CLOUDFLARE_R2_TOKEN_ID: "test-token-id",
      CLOUDFLARE_R2_API_TOKEN: "test-token-secret",
      R2_S3_ENDPOINT: fakeR2.endpoint
    });
  } finally {
    await fakeR2.close();
  }

  git(fixture.runner, "fetch", "origin", "drafts");
  assert.throws(() => git(fixture.runner, "show", `origin/drafts:${rawPath}`));
  assert.throws(() => git(fixture.runner, "show", `origin/drafts:${targetPath}`));
  assert.equal(git(fixture.runner, "show", "origin/drafts:blog/posts/later.md"), "later save");

  const manifest = JSON.parse(git(fixture.runner, "show", "origin/drafts:automation/media-manifest.json"));
  const entry = manifest["images/uploads/test.webp"];
  assert.ok(entry, "expected a manifest entry for the uploaded image");
  assert.equal(entry.width, 1600);
  assert.equal(entry.contentType, "image/webp");

  const uploaded = fakeR2.uploads.get("/fischr-media/images/uploads/test.webp");
  assert.ok(uploaded, "expected the normalized image to have been PUT to R2");
  const metadata = await sharp(uploaded).metadata();
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
