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
    // Der Abruf trägt den Inhalts-Hash als ?v=, damit ein ersetztes Bild eine eigene
    // Cache-Adresse bekommt. Der Schlüssel ist der Pfad davor.
    const key = decodeURIComponent(req.url.replace(/^\//, "").split("?")[0]);
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
    "lib/media-manifest.js",
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

  assert.deepEqual(fakeServer.requests, [`/images/uploads/missing.webp?v=${hash(missingBuffer).slice(0, 8)}`]);
  assert.equal(fs.readFileSync(path.join(root, "blog/assets/images/uploads/missing.webp")).toString(), missingBuffer.toString());
  assert.equal(fs.readFileSync(path.join(root, "blog/assets/images/uploads/present.webp")).toString(), presentBuffer.toString());
  assert.ok(!fs.existsSync(path.join(root, "_site")));
});

test("downloads multiple missing files concurrently instead of one at a time", async () => {
  const root = setupProject();
  const fileCount = 20;
  const manifest = {};
  const objects = {};

  for (let i = 0; i < fileCount; i += 1) {
    const key = `images/uploads/file-${i}.webp`;
    const buffer = Buffer.from(`bytes-${i}`);
    manifest[key] = { sourcePath: `blog/assets/images/uploads/file-${i}.webp`, sha256: hash(buffer) };
    objects[key] = buffer;
  }
  writeManifest(root, manifest);

  let inFlight = 0;
  let maxInFlight = 0;
  const server = http.createServer((req, res) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Der Abruf trägt den Inhalts-Hash als ?v=, damit ein ersetztes Bild eine eigene
    // Cache-Adresse bekommt. Der Schlüssel ist der Pfad davor.
    const key = decodeURIComponent(req.url.replace(/^\//, "").split("?")[0]);
    // Hold the response briefly so overlapping requests actually overlap in time — proves real
    // concurrency rather than requests that merely happen to be dispatched back-to-back.
    setTimeout(() => {
      inFlight -= 1;
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(objects[key]);
    }, 20);
  });
  const baseUrl = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });

  try {
    await runPrepare(root, { MEDIA_DELIVERY_BASE_URL: baseUrl });
  } finally {
    await new Promise((done) => server.close(done));
  }

  assert.ok(maxInFlight > 1, `expected overlapping requests, got a peak of ${maxInFlight}`);
  for (let i = 0; i < fileCount; i += 1) {
    assert.equal(fs.readFileSync(path.join(root, `blog/assets/images/uploads/file-${i}.webp`)).toString(), `bytes-${i}`);
  }
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
    // One attempt: a hash mismatch is retryable (a truncated body looks the same), and this
    // test is about the refusal to write, not about how many times the request is repeated.
    await assert.rejects(() =>
      runPrepare(root, { MEDIA_DELIVERY_BASE_URL: fakeServer.baseUrl, R2_REQUEST_ATTEMPTS: "1" })
    );
  } finally {
    await fakeServer.close();
  }

  assert.ok(!fs.existsSync(path.join(root, "blog/assets/images/uploads/tampered.webp")));
});

// A build that materializes ~1150 files from the network on every run meets a transient 5xx or
// a reset connection sooner or later. Before the retry these tests cover, exactly one of them
// failed the whole deploy.
test("retries a transient delivery failure instead of failing the build", async () => {
  const root = setupProject();
  const buffer = Buffer.from("eventually-served");

  writeManifest(root, {
    "images/uploads/flaky.webp": { sourcePath: "blog/assets/images/uploads/flaky.webp", sha256: hash(buffer) }
  });

  let attempts = 0;
  const server = http.createServer((req, res) => {
    attempts += 1;
    if (attempts < 3) {
      res.writeHead(503);
      res.end("try again");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(buffer);
  });
  const baseUrl = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });

  try {
    await runPrepare(root, { MEDIA_DELIVERY_BASE_URL: baseUrl });
  } finally {
    await new Promise((done) => server.close(done));
  }

  assert.equal(attempts, 3);
  assert.equal(fs.readFileSync(path.join(root, "blog/assets/images/uploads/flaky.webp")).toString(), buffer.toString());
});

// The mirror image: a 404 means the manifest and the bucket disagree. Repeating the request
// cannot fix that, and burning the full retry budget on it only delays the report.
// Der Auslieferungsdomain-Cache erfährt von einem R2-PUT nichts: Wird ein Bild unter seinem
// alten Schlüssel ersetzt, liefert sie bis zu ein Jahr die alten Bytes weiter. Der Build prüft
// gegen den Hash im Manifest und scheiterte deshalb am 2026-08-23 bei jedem Push auf main —
// und weil die Prüfung vor dem Deploy läuft, ging gar nichts mehr live. Hängt die Adresse am
// Inhalt, zieht der Cache-Eintrag mit den Bytes um.
test("ein ersetztes Bild wird unter einer eigenen Adresse geholt, nicht unter der alten", async () => {
  const root = setupProject();
  const alt = Buffer.from("erste-fassung");
  const neu = Buffer.from("zweite-fassung");
  const key = "images/uploads/ersetzt.webp";
  const ziel = path.join(root, "blog/assets/images/uploads/ersetzt.webp");

  const holen = async (bytes) => {
    writeManifest(root, { [key]: { sourcePath: "blog/assets/images/uploads/ersetzt.webp", sha256: hash(bytes) } });
    fs.rmSync(ziel, { force: true });
    const server = await startFakeDeliveryServer({ [key]: bytes });
    try {
      await runPrepare(root, { MEDIA_DELIVERY_BASE_URL: server.baseUrl });
    } finally {
      await server.close();
    }
    return server.requests[0];
  };

  const vorher = await holen(alt);
  const nachher = await holen(neu);
  assert.notEqual(vorher, nachher, "gleiche Adresse hieße: der Cache liefert weiter die alten Bytes");
  assert.equal(fs.readFileSync(ziel).toString(), neu.toString());
});

test("does not retry a delivery 404, which means the manifest and the bucket disagree", async () => {
  const root = setupProject();

  writeManifest(root, {
    "images/uploads/gone.webp": { sourcePath: "blog/assets/images/uploads/gone.webp", sha256: hash(Buffer.from("x")) }
  });

  const fakeServer = await startFakeDeliveryServer({});
  try {
    await assert.rejects(() => runPrepare(root, { MEDIA_DELIVERY_BASE_URL: fakeServer.baseUrl }));
  } finally {
    await fakeServer.close();
  }

  assert.deepEqual(fakeServer.requests, [`/images/uploads/gone.webp?v=${hash(Buffer.from("x")).slice(0, 8)}`]);
  assert.ok(!fs.existsSync(path.join(root, "blog/assets/images/uploads/gone.webp")));
});

// Restoring is the only writer of these files and nothing else can tell a truncated one from a
// whole one afterwards: prepare-media-source.js skips whatever fs.existsSync already reports.
test("leaves no partial file behind when a download never succeeds", async () => {
  const root = setupProject();

  writeManifest(root, {
    "images/uploads/half.webp": { sourcePath: "blog/assets/images/uploads/half.webp", sha256: hash(Buffer.from("whole")) }
  });

  const fakeServer = await startFakeDeliveryServer({ "images/uploads/half.webp": Buffer.from("truncated") });
  try {
    await assert.rejects(() =>
      runPrepare(root, { MEDIA_DELIVERY_BASE_URL: fakeServer.baseUrl, R2_REQUEST_ATTEMPTS: "2" })
    );
  } finally {
    await fakeServer.close();
  }

  const uploads = path.join(root, "blog/assets/images/uploads");
  assert.deepEqual(fs.existsSync(uploads) ? fs.readdirSync(uploads) : [], []);
});
