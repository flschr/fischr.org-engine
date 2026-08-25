// Mints a short-lived GitHub App installation access token, so the Cloudflare-native build
// path can push commits and dispatch workflows without a long-lived Personal Access Token
// sitting in Cloudflare's secret store. See docs/deployment.md for why that distinction
// matters: a PAT is a standing credential exposed to every `npm ci` in the build environment,
// while an installation token is minted fresh per build and expires within the hour — the same
// shape of exposure GitHub Actions' own GITHUB_TOKEN already gives the existing pipeline.
//
// Needs three environment variables, none of which is the private key pasted directly — the
// key itself only ever needs to reach Cloudflare's secret store, never this repository or this
// author:
//   GITHUB_APP_ID              — numeric, not secret
//   GITHUB_APP_INSTALLATION_ID — numeric, not secret
//   GITHUB_APP_PRIVATE_KEY     — PEM, secret. Cloudflare Pages secrets collapse newlines, so
//                                 this accepts the key with literal "\n" sequences and
//                                 unescapes them; a real multi-line PEM also works untouched.

const crypto = require("crypto");
const { execFileSync } = require("child_process");

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizePrivateKey(raw) {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function signAppJwt({ appId, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  // -60s: GitHub rejects a JWT issued in what it perceives as the future if this build's
  // clock runs even slightly ahead of GitHub's.
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), normalizePrivateKey(privateKey));
  return `${signingInput}.${base64Url(signature).replace(/=/g, "")}`;
}

async function fetchInstallationToken({ appId, installationId, privateKey, fetchImpl = fetch }) {
  const jwt = signAppJwt({ appId, privateKey });

  const response = await fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub App token exchange failed: ${response.status} ${response.statusText} ${body}`);
  }

  const data = await response.json();
  return { token: data.token, expiresAt: data.expires_at };
}

async function mintInstallationTokenFromEnv(env = process.env) {
  const appId = env.GITHUB_APP_ID;
  const installationId = env.GITHUB_APP_INSTALLATION_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;

  if (!appId) throw new Error("GITHUB_APP_ID is required to mint a GitHub App token.");
  if (!installationId) throw new Error("GITHUB_APP_INSTALLATION_ID is required to mint a GitHub App token.");
  if (!privateKey) throw new Error("GITHUB_APP_PRIVATE_KEY is required to mint a GitHub App token.");

  return fetchInstallationToken({ appId, installationId, privateKey });
}

// Points the local checkout's origin at an authenticated URL for exactly one push, then hands
// back a restore function — the token must not linger in .git/config after the build container
// is torn down and reused, if the platform ever reuses build containers between runs.
function withAuthenticatedRemote(token, workdir, fn) {
  const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], { cwd: workdir, encoding: "utf8" }).trim();
  const authenticated = remoteUrl.replace(/^https:\/\/(?:[^@]+@)?github\.com\//, `https://x-access-token:${token}@github.com/`);

  execFileSync("git", ["remote", "set-url", "origin", authenticated], { cwd: workdir });
  try {
    return fn();
  } finally {
    execFileSync("git", ["remote", "set-url", "origin", remoteUrl], { cwd: workdir });
  }
}

module.exports = { mintInstallationTokenFromEnv, fetchInstallationToken, withAuthenticatedRemote };
