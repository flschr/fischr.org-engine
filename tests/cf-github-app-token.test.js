const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const { fetchInstallationToken, withAuthenticatedRemote } = require("../scripts/lib/github-app-token");

function testKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
}

function decodeJwt(jwt) {
  const [headerB64, payloadB64, signatureB64] = jwt.split(".");
  const decode = (segment) => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  return { header: decode(headerB64), payload: decode(payloadB64), signingInput: `${headerB64}.${payloadB64}`, signatureB64 };
}

test("the minted JWT is signed with the app's own private key and verifies against its public key", async () => {
  const { publicKey, privateKey } = testKeyPair();
  let capturedAuth;

  await fetchInstallationToken({
    appId: "424242",
    installationId: "1",
    privateKey,
    fetchImpl: async (url, options) => {
      capturedAuth = options.headers.Authorization;
      return { ok: true, json: async () => ({ token: "ghs_stub", expires_at: "2026-01-01T00:00:00Z" }) };
    }
  });

  const jwt = capturedAuth.replace(/^Bearer /, "");
  const { header, payload, signingInput, signatureB64 } = decodeJwt(jwt);

  assert.equal(header.alg, "RS256");
  assert.equal(payload.iss, "424242");
  assert.ok(payload.exp > payload.iat, "expiry must be after issued-at");
  assert.ok(payload.exp - payload.iat <= 10 * 60, "GitHub caps App JWTs at 10 minutes");

  const verified = crypto.verify(
    "RSA-SHA256",
    Buffer.from(signingInput),
    publicKey,
    Buffer.from(signatureB64, "base64url")
  );
  assert.equal(verified, true, "signature must verify against the key's own public half");
});

test("a PEM pasted with literal \\n sequences (as Cloudflare secrets collapse it) still signs correctly", async () => {
  const { publicKey, privateKey } = testKeyPair();
  const collapsed = privateKey.replace(/\n/g, "\\n");
  let capturedAuth;

  await fetchInstallationToken({
    appId: "1",
    installationId: "1",
    privateKey: collapsed,
    fetchImpl: async (url, options) => {
      capturedAuth = options.headers.Authorization;
      return { ok: true, json: async () => ({ token: "ghs_stub" }) };
    }
  });

  const { signingInput, signatureB64 } = decodeJwt(capturedAuth.replace(/^Bearer /, ""));
  assert.equal(
    crypto.verify("RSA-SHA256", Buffer.from(signingInput), publicKey, Buffer.from(signatureB64, "base64url")),
    true
  );
});

test("a non-ok token exchange response surfaces GitHub's status and body", async () => {
  const { privateKey } = testKeyPair();

  await assert.rejects(
    fetchInstallationToken({
      appId: "1",
      installationId: "1",
      privateKey,
      fetchImpl: async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "bad credentials" })
    }),
    /401.*bad credentials/s
  );
});

test("withAuthenticatedRemote injects the token for the callback and always restores the original remote", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-app-token-test-"));
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/example-blog.git"], { cwd: dir });

  let seenDuringCallback;
  withAuthenticatedRemote("ghs_test123", dir, () => {
    seenDuringCallback = execFileSync("git", ["remote", "get-url", "origin"], { cwd: dir, encoding: "utf8" }).trim();
  });

  const restored = execFileSync("git", ["remote", "get-url", "origin"], { cwd: dir, encoding: "utf8" }).trim();

  assert.equal(seenDuringCallback, "https://x-access-token:ghs_test123@github.com/example/example-blog.git");
  assert.equal(restored, "https://github.com/example/example-blog.git");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("withAuthenticatedRemote restores the original remote even when the callback throws", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-app-token-test-"));
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/example-blog.git"], { cwd: dir });

  assert.throws(() => {
    withAuthenticatedRemote("ghs_test123", dir, () => {
      throw new Error("push failed");
    });
  }, /push failed/);

  const restored = execFileSync("git", ["remote", "get-url", "origin"], { cwd: dir, encoding: "utf8" }).trim();
  assert.equal(restored, "https://github.com/example/example-blog.git");

  fs.rmSync(dir, { recursive: true, force: true });
});
