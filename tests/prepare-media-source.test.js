const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const projectRoot = path.join(__dirname, "..");

// A minimal stand-in for the public media.mysite.example delivery domain: serves whatever bytes the
// test registers for a given object key, or 404s. scripts/lib/r2-media.js's
// MEDIA_DELIVERY_BASE_URL override (test-only) points downloadMediaFile at this instead of the
// real host — no credentials involved, since the real domain is a public bucket too.
function startFakeDeliveryServer(objects) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const key = decodeURIComponent(req.url.replace(/^\//, ""));
    const body = objects[key];
    if (!body) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(body);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function setupProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-media-source-"));
  fs.mkdirSync(path.join(root, "automation"), { recursive: true });

  for (const relative of [
    "scripts/prepare-media-source.js",
    "scripts/lib/r2-media.js",
    "lib/eleventy/social.js",
    "lib/eleventy/html.js"
  ]) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, relative), destination);
  }

  fs.symlinkSync(path.join(projectRoot, "node_modules"), path.join(root, "node_modules"), "dir");
  return root;
}

function writeManifest(root, manifest) {
  fs.writeFileSync(path.join(root, "automation/media-manifest.json"), JSON.stringify(manifest));
}

async function runPrepare(root, env) {
  return execFileAsync("node", ["scripts/prepare-media-source.js"], { cwd: root, env: { ...process.env, ...env } });
}

test("restores a missing manifest-listed file from the delivery domain, leaves present files and build output alone", async () => {
  const root = setupProject();
  const missingBuffer = Buffer.from("missing-file-bytes");
  const presentBuffer = Buffer.from("already-here-bytes");

  fs.mkdirSync(path.join(root, "blog/assets/images/uploads"), { recursive: true });
  fs.writeFileSync(path.join(root, "blog/assets/images/uploads/present.webp"), presentBuffer);

  writeManifest(root, {
    "images/uploads/missing.webp": {
      sourcePath: "blog/assets/images/uploads/missing.webp",
      sha256: hash(missingBuffer)
    },
    "images/uploads/present.webp": {
      sourcePath: "blog/assets/images/uploads/present.webp",
      sha256: hash(presentBuffer)
    },
    // Responsive variants' sourcePath points at the ephemeral build output, not a Git source —
    // must never trigger a download, since it isn't something to "restore" in the first place.
    "images/responsive/foo-abc-680.webp": {
      sourcePath: "_site/assets/images/responsive/foo-abc-680.webp",
      sha256: "irrelevant"
    }
  });

  const fakeServer = await startFakeDeliveryServer({ "images/uploads/missing.webp": missingBuffer });
  try {
    await runPrepare(root, { MEDIA_DELIVERY_BASE_URL: fakeServer.baseUrl });
  } finally {
    await fakeServer.close();
  }

  assert.deepEqual(fakeServer.requests, ["/images/uploads/missing.webp"]);
  assert.equal(fs.readFileSync(path.join(root, "blog/assets/images/uploads/missing.webp")).toString(), missingBuffer.toString());
  assert.equal(fs.readFileSync(path.join(root, "blog/assets/images/uploads/present.webp")).toString(), presentBuffer.toString());
  assert.ok(!fs.existsSync(path.join(root, "_site")));
});

test("refuses to write a download whose bytes don't match the manifest's recorded sha256", async () => {
  const root = setupProject();

  writeManifest(root, {
    "images/uploads/tampered.webp": {
      sourcePath: "blog/assets/images/uploads/tampered.webp",
      sha256: hash(Buffer.from("expected-bytes"))
    }
  });

  const fakeServer = await startFakeDeliveryServer({ "images/uploads/tampered.webp": Buffer.from("wrong-bytes") });
  try {
    await assert.rejects(() => runPrepare(root, { MEDIA_DELIVERY_BASE_URL: fakeServer.baseUrl }));
  } finally {
    await fakeServer.close();
  }

  assert.ok(!fs.existsSync(path.join(root, "blog/assets/images/uploads/tampered.webp")));
});
