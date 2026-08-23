const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const projectRoot = path.join(__dirname, "..");

// Stands in for R2's S3 ListObjectsV2 endpoint. Paginates at two objects per page on purpose:
// the real bucket holds over 6000 and the continuation-token loop is the part most likely to
// silently truncate, which would turn every unlisted object into a false "missing".
function startBucket(objects) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const cursor = Number(url.searchParams.get("continuation-token") || "0");
    const page = objects.slice(cursor, cursor + 2);
    const next = cursor + 2;
    const truncated = next < objects.length;
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
${page
  .map(
    (object) =>
      `  <Contents><Key>${object.key.replace(/&/g, "&amp;")}</Key><Size>${object.size}</Size><LastModified>${object.lastModified}</LastModified></Contents>`
  )
  .join("\n")}
  <IsTruncated>${truncated}</IsTruncated>
${truncated ? `  <NextContinuationToken>${next}</NextContinuationToken>` : ""}
</ListBucketResult>`;
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(body);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        endpoint: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function setupProject(manifest, pending = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-drift-"));
  for (const relative of [
    "scripts/report-media-drift.js",
    "scripts/lib/r2-media.js",
    "lib/media-manifest.js",
    "lib/eleventy/social.js",
    "lib/eleventy/html.js"
  ]) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, relative), destination);
  }
  fs.symlinkSync(path.join(projectRoot, "node_modules"), path.join(root, "node_modules"), "dir");

  fs.mkdirSync(path.join(root, "automation"), { recursive: true });
  fs.writeFileSync(path.join(root, "automation/media-manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [name, record] of Object.entries(pending)) {
    fs.mkdirSync(path.join(root, "automation/media-uploads"), { recursive: true });
    fs.writeFileSync(path.join(root, `automation/media-uploads/${name}`), JSON.stringify(record));
  }
  return root;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

async function run(root, endpoint, extra = {}) {
  return execFileAsync("node", ["scripts/report-media-drift.js"], {
    cwd: root,
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_R2_ACCESS_KEY_ID: "key",
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret",
      R2_S3_ENDPOINT: endpoint,
      // The fixtures have no drafts branch; the tests that care about that guard set it back.
      MEDIA_DRIFT_ALLOW_MISSING_DRAFTS: "1",
      ...extra
    }
  });
}

function report(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "automation/media-drift-report.json"), "utf8"));
}

test("reports an object the manifest does not know, once it is past the grace period", async () => {
  const root = setupProject({ "images/known.webp": { size: 10 } });
  const bucket = await startBucket([
    { key: "images/known.webp", size: 10, lastModified: daysAgo(90) },
    { key: "images/forgotten.webp", size: 4096, lastModified: daysAgo(90) }
  ]);

  try {
    const { stdout } = await run(root, bucket.endpoint);
    assert.match(stdout, /Orphans \(older than 14 d\): 1/);
  } finally {
    await bucket.close();
  }

  assert.deepEqual(report(root).orphans.map((entry) => entry.key), ["images/forgotten.webp"]);
});

// The failure mode this whole report is designed against: an earlier orphan report in this
// repository had 30 of 55 findings wrong. An object the admin just uploaded is in R2 well
// before its record is published, and calling it an orphan would invite deleting live media.
test("never calls a freshly written object an orphan", async () => {
  const root = setupProject({});
  const bucket = await startBucket([{ key: "images/uploads/just-now.webp", size: 2048, lastModified: daysAgo(1) }]);

  try {
    const { stdout } = await run(root, bucket.endpoint);
    assert.match(stdout, /Orphans \(older than 14 d\): 0/);
  } finally {
    await bucket.close();
  }
});

// The same protection for the case where the record does exist but has not been folded into
// the committed manifest yet.
test("counts a pending upload record as known", async () => {
  const root = setupProject({}, {
    "images__uploads__fresh.webp.json": { key: "images/uploads/fresh.webp", entry: { size: 512 } }
  });
  const bucket = await startBucket([{ key: "images/uploads/fresh.webp", size: 512, lastModified: daysAgo(60) }]);

  try {
    const { stdout } = await run(root, bucket.endpoint);
    assert.match(stdout, /Orphans \(older than 14 d\): 0/);
  } finally {
    await bucket.close();
  }
});

// The direction with teeth: the site links these and they 404 silently. Responsive variants are
// never read back by any build, so nothing else would ever notice.
test("fails when the manifest promises an object the bucket does not have", async () => {
  const root = setupProject({ "images/responsive/gone-abc-680.webp": { size: 900, sourcePath: "_site/x" } });
  const bucket = await startBucket([]);

  try {
    await assert.rejects(() => run(root, bucket.endpoint), (error) => {
      assert.match(error.stderr, /missing: images\/responsive\/gone-abc-680\.webp/);
      return true;
    });
  } finally {
    await bucket.close();
  }

  assert.equal(report(root).totals.missing, 1);
});

test("fails when the manifest and the bucket disagree about a size", async () => {
  const root = setupProject({ "images/changed.webp": { size: 100 } });
  const bucket = await startBucket([{ key: "images/changed.webp", size: 250, lastModified: daysAgo(30) }]);

  try {
    await assert.rejects(() => run(root, bucket.endpoint), (error) => {
      assert.match(error.stderr, /differs: images\/changed\.webp \(manifest 100 B, bucket 250 B\)/);
      return true;
    });
  } finally {
    await bucket.close();
  }
});

test("walks every page of a truncated listing", async () => {
  const objects = Array.from({ length: 7 }, (_, index) => ({
    key: `images/page-${index}.webp`,
    size: 10,
    lastModified: daysAgo(90)
  }));
  const manifest = Object.fromEntries(objects.map((object) => [object.key, { size: 10 }]));
  const root = setupProject(manifest);
  const bucket = await startBucket(objects);

  try {
    const { stdout } = await run(root, bucket.endpoint);
    // All seven found across four pages: nothing truncated into a false "missing".
    assert.match(stdout, /7 objects, manifest knows 7 keys/);
  } finally {
    await bucket.close();
  }
});

// Staged originals belong to the bucket's lifecycle rule, not to the manifest — they must never
// be reported as orphans. One that outlives the rule is worth a warning of its own, because it
// is an untouched original with its EXIF, GPS included, on a public domain.
test("keeps staged originals out of the orphan list and flags one that outlived its rule", async () => {
  const root = setupProject({});
  const bucket = await startBucket([{ key: "staging/admin-upload-abc", size: 8_000_000, lastModified: daysAgo(3) }]);

  try {
    const { stdout, stderr } = await run(root, bucket.endpoint);
    assert.match(stdout, /Orphans \(older than 14 d\): 0/);
    assert.match(stdout, /Staged originals still present:     1/);
    assert.match(stderr, /lifecycle rule should have expired it/);
  } finally {
    await bucket.close();
  }
});

test("writes a report and deletes nothing", async () => {
  const root = setupProject({ "images/known.webp": { size: 10 } });
  const bucket = await startBucket([
    { key: "images/known.webp", size: 10, lastModified: daysAgo(90) },
    { key: "images/forgotten.webp", size: 20, lastModified: daysAgo(90) }
  ]);

  try {
    const { stdout } = await run(root, bucket.endpoint);
    assert.match(stdout, /this report never deletes/);
  } finally {
    await bucket.close();
  }

  const source = fs.readFileSync(path.join(projectRoot, "scripts/report-media-drift.js"), "utf8");
  assert.doesNotMatch(source, /DeleteObject|method: "DELETE"/, "the report must have no delete path at all");
  assert.equal(report(root).totals.objectsInBucket, 2);
});

// The guard that failed silently on the first production run: actions/checkout narrows the
// remote's fetch refspec, so `git fetch origin drafts` never creates `origin/drafts`. The
// report then falls back to the grace period alone and still looks authoritative.
test("refuses to report without the drafts branch instead of quietly weakening the result", async () => {
  const root = setupProject({});
  const bucket = await startBucket([{ key: "images/uploads/old.webp", size: 10, lastModified: daysAgo(90) }]);

  try {
    await assert.rejects(
      () => run(root, bucket.endpoint, { MEDIA_DRIFT_ALLOW_MISSING_DRAFTS: "" }),
      (error) => {
        assert.match(error.stderr, /Cannot read the drafts branch/);
        assert.match(error.stderr, /refs\/heads\/drafts:refs\/remotes\/origin\/drafts/);
        return true;
      }
    );
  } finally {
    await bucket.close();
  }
});

// The defect the first two production runs actually had. The drafts manifest is read with
// `git show`, and execFileSync buffers 1 MB by default while the real manifest is ~2.7 MB — the
// resulting ENOBUFS was indistinguishable from "the branch does not exist". This builds a repo
// whose drafts manifest is deliberately over that limit and checks the keys are seen.
test("reads a drafts manifest larger than the default exec buffer", async () => {
  const root = setupProject({ "images/on-main.webp": { size: 10 } });

  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "--quiet", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");

  // One key that only the drafts branch knows, padded well past 1 MB.
  const draftsManifest = { "images/uploads/only-on-drafts.webp": { size: 42, note: "x".repeat(1_500_000) } };
  fs.writeFileSync(path.join(root, "automation/media-manifest.json"), JSON.stringify(draftsManifest));
  git("add", "automation/media-manifest.json");
  git("commit", "--quiet", "-m", "drafts manifest");
  git("update-ref", "refs/remotes/origin/drafts", "HEAD");

  const manifestPath = path.join(root, "automation/media-manifest.json");
  assert.ok(fs.statSync(manifestPath).size > 1024 * 1024, "fixture must exceed the default 1 MB buffer");
  // Restore the working tree to the small main manifest; only the branch carries the big one.
  fs.writeFileSync(manifestPath, JSON.stringify({ "images/on-main.webp": { size: 10 } }));

  const bucket = await startBucket([
    { key: "images/on-main.webp", size: 10, lastModified: daysAgo(90) },
    { key: "images/uploads/only-on-drafts.webp", size: 42, lastModified: daysAgo(90) }
  ]);

  try {
    // No opt-out: the drafts branch must genuinely be readable for this to pass.
    const { stdout } = await run(root, bucket.endpoint, { MEDIA_DRIFT_ALLOW_MISSING_DRAFTS: "" });
    assert.match(stdout, /manifest knows 2 keys/);
    assert.match(stdout, /Orphans \(older than 14 d\): 0/);
  } finally {
    await bucket.close();
  }
});
