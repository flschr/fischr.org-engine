const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

// Built from a plain "media.mysite.example" literal on purpose: scripts/export-public-engine.js
// rewrites that string in the exported snapshot, so these expectations travel with the files
// they check. A regex literal that escapes the dots survives the rewrite untouched and then
// fails only in the export, never here.
const deliveryHostName = "media.mysite.example";
// Pre-escaped for the remaining regex assertions in this file.
const deliveryHost = deliveryHostName.replace(/\./g, "\\.");

const execFileAsync = promisify(execFile);
const projectRoot = path.join(__dirname, "..");

// Same fake R2 S3-compatible stub as tests/admin-media-integration.test.js: accepts any PUT
// under /<bucket>/<key> and remembers the uploaded bodies.
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

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function setupProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-chrome-media-"));

  fs.mkdirSync(path.join(root, "automation"), { recursive: true });
  fs.writeFileSync(path.join(root, "automation/media-manifest.json"), "{}\n");

  copyDir(path.join(projectRoot, "lib/eleventy"), path.join(root, "lib/eleventy"));
  fs.mkdirSync(path.join(root, "scripts/lib"), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, "scripts/migrate-chrome-media-to-r2.js"), path.join(root, "scripts/migrate-chrome-media-to-r2.js"));
  fs.copyFileSync(path.join(projectRoot, "scripts/lib/r2-media.js"), path.join(root, "scripts/lib/r2-media.js"));
  fs.copyFileSync(path.join(projectRoot, "lib/media-manifest.js"), path.join(root, "lib/media-manifest.js"));
  fs.mkdirSync(path.join(root, "blog/admin"), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, "blog/admin/markdown-media.js"), path.join(root, "blog/admin/markdown-media.js"));

  fs.symlinkSync(path.join(projectRoot, "node_modules"), path.join(root, "node_modules"), "dir");

  // Minimal fixture files at the exact relative paths migrate-chrome-media-to-r2.js hardcodes —
  // content doesn't need to be a real image; publishMediaFile only hashes bytes, and
  // rasterDimensions() tolerates non-image content by catching the sharp() failure.
  const chromeImagePaths = [
    "blog/assets/images/404.webp",
    "blog/assets/images/apple-touch-icon.png",
    "blog/assets/images/favicon-16x16.png",
    "blog/assets/images/favicon-32x32.png",
    "blog/assets/images/favicon.ico",
    "blog/assets/images/fish-line.svg",
    "blog/assets/images/icon-192-maskable.png",
    "blog/assets/images/icon-192.png",
    "blog/assets/images/icon-512-maskable.png",
    "blog/assets/images/icon-512.png",
    "blog/assets/images/og-default.webp"
  ];
  for (const relativePath of chromeImagePaths) {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `fixture bytes for ${relativePath}`);
  }

  fs.mkdirSync(path.join(root, "blog/_includes/layouts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "blog/_includes/layouts/base.njk"),
    [
      '<link rel="icon" href="/assets/images/favicon-32x32.png?v=1" sizes="32x32" type="image/png">',
      '<link rel="icon" href="/assets/images/favicon-16x16.png?v=1" sizes="16x16" type="image/png">',
      '<link rel="shortcut icon" href="/favicon.ico?v=1" type="image/x-icon">',
      '<link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png?v=1">',
      '{% if previewImage == "/assets/images/og-default.webp" %}<meta property="og:image:width" content="1200">{% endif %}'
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(root, "blog/site.webmanifest.njk"),
    '{"icons": [{"src": "/assets/images/icon-192.png"}, {"src": "/assets/images/icon-512.png"}]}'
  );
  fs.writeFileSync(
    path.join(root, "blog/404.md"),
    '<img src="/assets/images/404.webp" alt="404">'
  );
  fs.mkdirSync(path.join(root, "blog/assets/css-src/main"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "blog/assets/css-src/main/02-document-base.css"),
    'body { background: url("/assets/images/fish-line.svg"); }'
  );
  // lib/eleventy/social.js was already copied wholesale above (copyDir) — its real
  // defaultSocialImage constant already contains the exact literal this test rewrites, and
  // media-assets.js/r2-media.js both need its other real exports (imageMimeType etc.) to work.

  return root;
}

test("migrates every chrome asset to R2 and rewrites all of its references", async () => {
  const root = setupProject();
  const fakeR2 = await startFakeR2Server();

  try {
    await execFileAsync("node", ["scripts/migrate-chrome-media-to-r2.js"], {
      cwd: root,
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: "test-account",
        CLOUDFLARE_R2_ACCESS_KEY_ID: "test-access-key-id",
        CLOUDFLARE_R2_SECRET_ACCESS_KEY: "test-secret-access-key",
        R2_S3_ENDPOINT: fakeR2.endpoint
      }
    });
  } finally {
    await fakeR2.close();
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "automation/media-manifest.json"), "utf8"));
  assert.ok(manifest["images/og-default.webp"], "expected og-default.webp to be recorded in the manifest");
  assert.ok(manifest["images/favicon.ico"], "expected favicon.ico to be recorded in the manifest");
  assert.equal(Object.keys(manifest).length, 11);
  assert.ok(
    fakeR2.uploads.get(`/fischr-media/${manifest["images/og-default.webp"].objectKey}`),
    "expected og-default.webp to have been PUT to R2 under its content address"
  );

  // Every rewritten reference names the object, not the path the file used to have. Deriving the
  // expectation from the manifest is the point: hard-coding an address would only re-assert the
  // mutable scheme this migration exists to leave behind.
  const delivered = (manifestKey) => `https://${deliveryHostName}/${manifest[manifestKey].objectKey}`;
  // Plain substring checks rather than regexes: the addresses are hex, and escaping them for a
  // pattern only invites the escaping bug over the assertion it is meant to make.
  const contains = (haystack, needle, label) => assert.ok(haystack.includes(needle), `${label}: ${needle}`);

  const baseTemplate = fs.readFileSync(path.join(root, "blog/_includes/layouts/base.njk"), "utf8");
  contains(baseTemplate, `href="${delivered("images/favicon-32x32.png")}?v=1"`, "favicon-32");
  contains(baseTemplate, `href="${delivered("images/favicon-16x16.png")}?v=1"`, "favicon-16");
  contains(baseTemplate, `href="${delivered("images/apple-touch-icon.png")}?v=1"`, "apple-touch-icon");
  // The /favicon.ico root-level reference is untouched — only /assets/images/... paths are
  // in scope, the root passthrough copy is a separate, still-local fallback.
  assert.match(baseTemplate, /href="\/favicon\.ico\?v=1"/);
  assert.match(
    baseTemplate,
    new RegExp(`\\{% if previewImage == "${delivered("images/og-default.webp").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" %\\}`)
  );

  const webmanifest = fs.readFileSync(path.join(root, "blog/site.webmanifest.njk"), "utf8");
  contains(webmanifest, `"src": "${delivered("images/icon-192.png")}"`, "icon-192");
  contains(webmanifest, `"src": "${delivered("images/icon-512.png")}"`, "icon-512");

  const notFoundPage = fs.readFileSync(path.join(root, "blog/404.md"), "utf8");
  contains(notFoundPage, `src="${delivered("images/404.webp")}"`, "404 image");

  const css = fs.readFileSync(path.join(root, "blog/assets/css-src/main/02-document-base.css"), "utf8");
  contains(css, `url("${delivered("images/fish-line.svg")}")`, "fish-line");

  const socialJs = fs.readFileSync(path.join(root, "lib/eleventy/social.js"), "utf8");
  // Unchanged on purpose, and the one assertion here that must NOT name a content address: this
  // reference was already absolute before the run, and an absolute delivery URL is left exactly
  // as it is. That is what "old keys stay frozen" means in practice — every address already
  // published somewhere keeps resolving, and only local paths are rewritten to the new scheme.
  contains(
    socialJs,
    `const defaultSocialImage = "https://${deliveryHostName}/images/og-default.webp";`,
    "default social image stays on its original address"
  );
});

test("--dry-run uploads nothing and leaves every reference untouched", async () => {
  const root = setupProject();
  const baseline = fs.readFileSync(path.join(root, "blog/_includes/layouts/base.njk"), "utf8");

  await execFileAsync("node", ["scripts/migrate-chrome-media-to-r2.js", "--dry-run"], { cwd: root });

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "automation/media-manifest.json"), "utf8"));
  assert.deepEqual(manifest, {});
  assert.equal(fs.readFileSync(path.join(root, "blog/_includes/layouts/base.njk"), "utf8"), baseline);
});
