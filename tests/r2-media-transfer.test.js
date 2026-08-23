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
      /R2 upload failed for images\/sample\.webp: 500/
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
      /R2 upload failed for images\/sample\.webp: 403/
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
