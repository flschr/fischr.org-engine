const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { publishMediaFile } = require("../scripts/lib/r2-media");

// Counts what actually reaches the endpoint. The retry budget for uploads is not this
// repository's own loop: aws4fetch's AwsClient brings one, and it already repeats 5xx and 429
// while returning everything else immediately. Wrapping that in a second loop multiplied the
// two budgets — a persistent 500 turned into 44 requests instead of 5 — and an outer timeout
// would have cut the inner backoff off mid-sequence. These tests exist to keep that from
// creeping back in.
function startCountingEndpoint(status) {
  let attempts = 0;
  const server = http.createServer((req, res) => {
    attempts += 1;
    res.writeHead(status);
    res.end("nope");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        endpoint: `http://127.0.0.1:${server.address().port}`,
        get attempts() {
          return attempts;
        },
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function stagedFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-transfer-"));
  const file = path.join(dir, "sample.webp");
  fs.writeFileSync(file, Buffer.from("bytes"));
  return file;
}

function envFor(endpoint, extra = {}) {
  return {
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_R2_ACCESS_KEY_ID: "key",
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret",
    R2_S3_ENDPOINT: endpoint,
    ...extra
  };
}

test("a failing upload is retried once by AwsClient's own budget, not by two nested loops", async () => {
  const server = await startCountingEndpoint(500);
  try {
    await assert.rejects(
      () =>
        publishMediaFile({
          localPath: stagedFile(),
          publicPath: "/assets/images/sample.webp",
          manifest: {},
          env: envFor(server.endpoint)
        }),
      /R2 upload failed for cas\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp: 500/
    );
  } finally {
    await server.close();
  }

  // One initial request plus the configured retries — the single budget, not a product of two.
  assert.equal(server.attempts, 5);
});

test("an upload rejected as unauthorized fails on the first request", async () => {
  const server = await startCountingEndpoint(403);
  try {
    await assert.rejects(
      () =>
        publishMediaFile({
          localPath: stagedFile(),
          publicPath: "/assets/images/sample.webp",
          manifest: {},
          env: envFor(server.endpoint)
        }),
      /R2 upload failed for cas\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp: 403/
    );
  } finally {
    await server.close();
  }

  // A wrong or expired token is not something repetition fixes; it has to surface at once.
  assert.equal(server.attempts, 1);
});

test("an upload whose content hash already matches the manifest never reaches the network", async () => {
  const server = await startCountingEndpoint(500);
  const file = stagedFile();
  const sha256 = require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");

  try {
    const result = await publishMediaFile({
      localPath: file,
      publicPath: "/assets/images/sample.webp",
      manifest: { "images/sample.webp": { sha256 } },
      env: envFor(server.endpoint)
    });
    assert.equal(result, "unchanged");
  } finally {
    await server.close();
  }

  assert.equal(server.attempts, 0);
});

// Nimmt jeden PUT an und merkt sich, unter welchem Schlüssel er ankam.
function startAcceptingEndpoint() {
  const puts = [];
  const server = http.createServer((req, res) => {
    puts.push(decodeURIComponent(req.url.replace(/^\/[^/]+\//, "")));
    res.writeHead(200);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        endpoint: `http://127.0.0.1:${server.address().port}`,
        puts,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

// Der Kern der Inhaltsadressierung, und bis hierher nur auf Helfer-Ebene geprüft: Wird eines der
// alten, pfadbenannten Bilder wirklich ersetzt, wandert dieser eine Eintrag auf eine
// Inhaltsadresse — und merkt sich die alte. Ohne dieses Gedächtnis meldete der Drift-Report das
// zurückbehaltene Objekt als Waise, obwohl veröffentlichte Feed-Items und rund 1.400 absolute
// URLs im Bestand es weiterhin ansteuern.
test("replacing a legacy path-keyed image moves it to a content address and remembers the old one", async () => {
  const server = await startAcceptingEndpoint();
  const manifest = {
    "images/sample.webp": {
      sourcePath: "blog/assets/images/sample.webp",
      sha256: "0".repeat(64),
      size: 1,
      contentType: "image/webp"
      // kein objectKey: genau die Form, die jeder Eintrag von vor der Umstellung hat
    }
  };

  try {
    const result = await publishMediaFile({
      localPath: stagedFile(),
      publicPath: "/assets/images/sample.webp",
      sourcePath: "blog/assets/images/sample.webp",
      manifest,
      env: envFor(server.endpoint)
    });

    assert.equal(result, "uploaded");

    // Der Manifest-Schlüssel bleibt die Identität; nur die Adresse hat sich bewegt.
    assert.deepEqual(Object.keys(manifest), ["images/sample.webp"]);

    const entry = manifest["images/sample.webp"];
    assert.match(entry.objectKey, /^cas\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/);
    assert.deepEqual(server.puts, [entry.objectKey], "die neuen Bytes dürfen nur unter der Inhaltsadresse landen");
    assert.deepEqual(entry.supersededObjectKeys, ["images/sample.webp"]);
    assert.equal(entry.sourcePath, "blog/assets/images/sample.webp");
  } finally {
    await server.close();
  }
});

// Und die Fortsetzung: Ein zweites Ersetzen darf die erste Adresse nicht vergessen. Sonst fiele
// das mittlere Objekt aus der Buchführung, und der Drift-Report zählte es als Waise.
test("a second replacement keeps every address the entry was ever served from", async () => {
  const server = await startAcceptingEndpoint();
  const first = "cas/ab/" + "ab".repeat(32) + ".webp";
  const manifest = {
    "images/sample.webp": {
      sourcePath: "blog/assets/images/sample.webp",
      objectKey: first,
      sha256: "0".repeat(64),
      supersededObjectKeys: ["images/sample.webp"],
      contentType: "image/webp"
    }
  };

  try {
    await publishMediaFile({
      localPath: stagedFile(),
      publicPath: "/assets/images/sample.webp",
      sourcePath: "blog/assets/images/sample.webp",
      manifest,
      env: envFor(server.endpoint)
    });

    const entry = manifest["images/sample.webp"];
    assert.notEqual(entry.objectKey, first);
    assert.deepEqual(entry.supersededObjectKeys, ["images/sample.webp", first]);
  } finally {
    await server.close();
  }
});

// Ohne diese Bewahrung schreibt ein Aufrufer, dessen lokale Datei ausserhalb des Repositories
// liegt, den eingetragenen sourcePath mit einer Kette von "../" nach /var/folders/… um. Kein
// heutiger Aufrufer tut das — admin-normalize-image.js und admin-prepare-video.js geben den Pfad
// ausdrücklich an, publish-build-media.js und migrate-media-to-r2.js arbeiten aus dem
// Repository heraus. Der Test hält fest, dass der nächste es auch nicht kaputtmachen kann.
test("replacing an entry keeps the source path it was recorded under", async () => {
  const server = await startAcceptingEndpoint();
  const manifest = {
    "images/sample.webp": {
      sourcePath: "blog/assets/images/sample.webp",
      sha256: "0".repeat(64),
      contentType: "image/webp"
    }
  };

  try {
    await publishMediaFile({
      // Absichtlich ohne sourcePath, und die Datei liegt in einem Temp-Verzeichnis.
      localPath: stagedFile(),
      publicPath: "/assets/images/sample.webp",
      manifest,
      env: envFor(server.endpoint)
    });

    assert.equal(manifest["images/sample.webp"].sourcePath, "blog/assets/images/sample.webp");
  } finally {
    await server.close();
  }
});

// Ein neuer Eintrag hat nichts zu bewahren und leitet weiterhin ab.
test("a new entry still derives its source path from the local file", async () => {
  const server = await startAcceptingEndpoint();
  const manifest = {};

  try {
    await publishMediaFile({
      localPath: stagedFile(),
      publicPath: "/assets/images/fresh.webp",
      sourcePath: "blog/assets/images/fresh.webp",
      manifest,
      env: envFor(server.endpoint)
    });

    assert.equal(manifest["images/fresh.webp"].sourcePath, "blog/assets/images/fresh.webp");
  } finally {
    await server.close();
  }
});
