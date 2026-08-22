const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const projectRoot = path.join(__dirname, "..");

// Same fake R2 S3-compatible stub as tests/admin-media-integration.test.js.
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

function setupProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-template-content-media-"));

  fs.mkdirSync(path.join(root, "automation"), { recursive: true });
  fs.writeFileSync(path.join(root, "automation/media-manifest.json"), "{}\n");

  fs.mkdirSync(path.join(root, "scripts/lib"), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, "scripts/migrate-template-content-media-to-r2.js"), path.join(root, "scripts/migrate-template-content-media-to-r2.js"));
  fs.copyFileSync(path.join(projectRoot, "scripts/lib/r2-media.js"), path.join(root, "scripts/lib/r2-media.js"));
  fs.mkdirSync(path.join(root, "lib/eleventy"), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, "lib/media-manifest.js"), path.join(root, "lib/media-manifest.js"));
  for (const name of ["media-assets.js", "html.js", "social.js", "media-references.js"]) {
    fs.copyFileSync(path.join(projectRoot, "lib/eleventy", name), path.join(root, "lib/eleventy", name));
  }
  fs.mkdirSync(path.join(root, "blog/admin"), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, "blog/admin/markdown-media.js"), path.join(root, "blog/admin/markdown-media.js"));

  fs.symlinkSync(path.join(projectRoot, "node_modules"), path.join(root, "node_modules"), "dir");

  // Fixture image referenced from two of the four scanned template/data sources — content
  // doesn't need to be a real image, publishMediaFile only hashes bytes.
  const imagePath = "blog/assets/images/imported/about/fixture-portrait.webp";
  fs.mkdirSync(path.dirname(path.join(root, imagePath)), { recursive: true });
  fs.writeFileSync(path.join(root, imagePath), "fixture portrait bytes");

  fs.writeFileSync(
    path.join(root, "blog/about.njk"),
    '<img class="about-portrait" src="/assets/images/imported/about/fixture-portrait.webp" width="512" height="512" alt="">'
  );
  fs.mkdirSync(path.join(root, "blog/_includes/partials"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "blog/_includes/partials/author-card.njk"),
    '<img class="author-card-photo" src="/assets/images/imported/about/fixture-portrait.webp" width="512" height="512" alt="">'
  );
  fs.mkdirSync(path.join(root, "blog/_data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "blog/_data/site.json"),
    '{"author": {"image": "/assets/images/imported/about/fixture-portrait.webp"}}'
  );
  fs.writeFileSync(path.join(root, "blog/projects.njk"), "<p>no images here</p>");

  return root;
}

test("discovers a template-embedded image with no hardcoded filename, uploads it, and rewrites every reference", async () => {
  const root = setupProject();
  const fakeR2 = await startFakeR2Server();

  try {
    await execFileAsync("node", ["scripts/migrate-template-content-media-to-r2.js"], {
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
  assert.ok(manifest["images/imported/about/fixture-portrait.webp"]);
  assert.ok(fakeR2.uploads.get("/fischr-media/images/imported/about/fixture-portrait.webp"));

  const deliveryUrl = "https://media.mysite.example/images/imported/about/fixture-portrait.webp";
  assert.match(fs.readFileSync(path.join(root, "blog/about.njk"), "utf8"), new RegExp(`src="${deliveryUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(fs.readFileSync(path.join(root, "blog/_includes/partials/author-card.njk"), "utf8"), new RegExp(`src="${deliveryUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(fs.readFileSync(path.join(root, "blog/_data/site.json"), "utf8"), new RegExp(`"image": "${deliveryUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
});

test("--dry-run uploads nothing and leaves every reference untouched", async () => {
  const root = setupProject();
  const baseline = fs.readFileSync(path.join(root, "blog/about.njk"), "utf8");

  await execFileAsync("node", ["scripts/migrate-template-content-media-to-r2.js", "--dry-run"], { cwd: root });

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "automation/media-manifest.json"), "utf8"));
  assert.deepEqual(manifest, {});
  assert.equal(fs.readFileSync(path.join(root, "blog/about.njk"), "utf8"), baseline);
});
