const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { AwsClient } = require("aws4fetch");
const sharp = require("sharp");

const { imageMimeType, videoMimeType } = require("../../lib/eleventy/social");

const root = process.cwd();
const manifestPath = path.join(root, "automation/media-manifest.json");
const bucketName = "fischr-media";
// Single source of truth for the public delivery host — lib/eleventy/media-assets.js imports
// this instead of redefining it, so the two can't drift apart.
const deliveryHost = "media.mysite.example";
const rasterExtensions = new Set([".jpeg", ".jpg", ".png", ".webp"]);
// Media is optimized once on upload/normalize and rarely rewritten in place at the same key
// (only a later re-normalization of an already-referenced file would do that) — a long TTL is
// safe because publishMediaFile only PUTs when the content hash actually changed, and R2/
// Cloudflare Cache treat a changed PUT as a new representation (no immutable staleness risk
// beyond the edge cache's own TTL window).
const cacheControl = "public, max-age=31536000";

// Mirrors the delivery mapping in lib/eleventy/media-assets.js (toDeliveryUrl), minus the
// https://media.mysite.example origin — this is the R2 object key, not the public URL.
function objectKeyForPublicPath(publicPath = "") {
  if (publicPath.startsWith("/assets/images/")) return `images/${publicPath.slice("/assets/images/".length)}`;
  if (publicPath.startsWith("/assets/videos/")) return `videos/${publicPath.slice("/assets/videos/".length)}`;
  throw new Error(`Cannot derive an R2 object key for ${publicPath}`);
}

function contentTypeFor(localPath) {
  return imageMimeType(localPath) || videoMimeType(localPath) || "application/octet-stream";
}

function loadManifest() {
  if (!fs.existsSync(manifestPath)) return {};
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function saveManifest(manifest) {
  const sorted = Object.keys(manifest).sort().reduce((acc, key) => {
    acc[key] = manifest[key];
    return acc;
  }, {});
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function rasterDimensions(localPath) {
  if (!rasterExtensions.has(path.extname(localPath).toLowerCase())) return null;
  try {
    const metadata = await sharp(localPath).metadata();
    return metadata.width && metadata.height ? { width: metadata.width, height: metadata.height } : null;
  } catch {
    return null;
  }
}

// R2's S3-compatible API derives S3 credentials from a Cloudflare R2 API token: the token's
// id is the Access Key ID, and the SHA-256 hash of the token's secret value is the Secret
// Access Key (https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token).
// The S3 API (unlike the simpler native object-PUT endpoint) is what Cloudflare recommends for
// real workloads, is what accepts a bucket-scoped "R2 Storage Bucket Item" token in the first
// place, and is the only way to set Cache-Control on the object.
function credentialsFromEnv(env = process.env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const tokenId = env.CLOUDFLARE_R2_TOKEN_ID;
  const apiToken = env.CLOUDFLARE_R2_API_TOKEN;
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required to publish media to R2.");
  if (!tokenId) throw new Error("CLOUDFLARE_R2_TOKEN_ID is required to publish media to R2.");
  if (!apiToken) throw new Error("CLOUDFLARE_R2_API_TOKEN is required to publish media to R2.");
  return { accountId, tokenId, apiToken };
}

function s3Client({ accountId, tokenId, apiToken }) {
  const secretAccessKey = crypto.createHash("sha256").update(apiToken).digest("hex");
  return new AwsClient({ accessKeyId: tokenId, secretAccessKey, region: "auto", service: "s3" });
}

// R2_S3_ENDPOINT lets tests point this at a local stub server instead of the real Cloudflare
// endpoint; production never sets it, so this always defaults to the real R2 endpoint.
function s3Endpoint(accountId, env) {
  return env.R2_S3_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
}

async function putObject({ accountId, tokenId, apiToken, key, buffer, contentType, env }) {
  const client = s3Client({ accountId, tokenId, apiToken });
  const url = `${s3Endpoint(accountId, env)}/${bucketName}/${key}`;
  const response = await client.fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType, "Cache-Control": cacheControl },
    body: buffer
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`R2 upload failed for ${key}: ${response.status} ${detail}`.trim());
  }
}

// Uploads a single local file to R2 if its content differs from the manifest's last known
// hash for that key, then records the new manifest entry. Returns "uploaded" | "unchanged".
async function publishMediaFile({ localPath, publicPath, sourcePath, manifest, env = process.env }) {
  const key = objectKeyForPublicPath(publicPath);
  const buffer = fs.readFileSync(localPath);
  const hash = hashBuffer(buffer);
  const existing = manifest[key];

  if (existing && existing.sha256 === hash) return "unchanged";

  const { accountId, tokenId, apiToken } = credentialsFromEnv(env);
  const contentType = contentTypeFor(localPath);
  await putObject({ accountId, tokenId, apiToken, key, buffer, contentType, env });

  const dimensions = await rasterDimensions(localPath);
  manifest[key] = {
    sourcePath: sourcePath || path.relative(root, localPath).split(path.sep).join("/"),
    sha256: hash,
    size: buffer.length,
    contentType,
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
    migratedAt: new Date().toISOString()
  };

  return "uploaded";
}

// MEDIA_DELIVERY_BASE_URL lets tests point this at a local stub server instead of the real
// public delivery domain; production never sets it, so this always defaults to the live host.
function deliveryUrlForKey(key, env = process.env) {
  const base = env.MEDIA_DELIVERY_BASE_URL || `https://${deliveryHost}`;
  return `${base}/${key}`;
}

// Restores a manifest-listed file that is missing from the local checkout (once Git no longer
// carries migrated media) by fetching it back from the public delivery domain — R2 is a
// publicly-readable bucket via its Custom Domain, so this needs no credentials, unlike
// publishMediaFile's write path. Verifies the downloaded bytes against the manifest's recorded
// hash before writing, since a corrupt or unexpected response must never silently become the
// new "local original" for image-dimension reads / responsive-variant generation.
async function downloadMediaFile({ key, destinationPath, expectedSha256, env = process.env }) {
  const url = deliveryUrlForKey(key, env);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Media download failed for ${key}: ${response.status} ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (expectedSha256 && hashBuffer(buffer) !== expectedSha256) {
    throw new Error(`Downloaded content for ${key} does not match the manifest's sha256 — refusing to write ${destinationPath}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, buffer);
}

module.exports = {
  bucketName,
  contentTypeFor,
  deliveryHost,
  deliveryUrlForKey,
  downloadMediaFile,
  hashBuffer,
  loadManifest,
  objectKeyForPublicPath,
  publishMediaFile,
  saveManifest
};
