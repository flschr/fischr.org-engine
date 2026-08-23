const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { AwsClient } = require("aws4fetch");
const sharp = require("sharp");

const { imageMimeType, videoMimeType } = require("../../lib/eleventy/social");
const {
  pendingUploadFileName,
  pendingUploadsRelativeDir,
  readBaseManifest,
  readMergedManifest,
  readPendingUploads
} = require("../../lib/media-manifest");

const root = process.cwd();
const manifestPath = path.join(root, "automation/media-manifest.json");
// One small JSON record per freshly uploaded object, folded into the manifest by the next
// production build (saveManifest + removePendingUploads). The manifest itself is ~2.7 MB across 6000+
// entries, so anything that records an upload by rewriting the whole file has to read and
// push those bytes every single time. A writer that only ever *creates* a small file — the
// admin media endpoint, which runs inside a request rather than on a CI runner with a
// checkout — pays a few hundred bytes instead.
const pendingUploadsDir = path.join(root, pendingUploadsRelativeDir);
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

// A malformed override must not turn every transfer into a confusing failure: parseInt("x") is
// NaN, and a NaN attempt count would skip the retry loop entirely while a NaN timeout makes
// AbortSignal.timeout throw. Fall back to the default instead.
function positiveIntEnv(name, fallback, env = process.env) {
  const parsed = Number.parseInt(env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// The download side is a plain global fetch with no retry of its own, and every production
// build pulls ~1150 files through it before Eleventy can read a single image dimension. One
// connection reset used to fail the whole deploy.
//
// The upload side needs none of this: AwsClient brings its own retry loop (see s3Client) whose
// classification — repeat 5xx and 429, surface everything else at once — is exactly the one an
// upload wants. Wrapping it again would multiply the two budgets together.
const downloadAttempts = positiveIntEnv("R2_REQUEST_ATTEMPTS", 4);
// Node's fetch has no default timeout: without one a stalled connection hangs the job until the
// runner's own limit, which looks like a frozen build rather than a failed request.
const downloadTimeoutMs = positiveIntEnv("R2_REQUEST_TIMEOUT_MS", 60000);
// Bounds the whole upload including AwsClient's internal retries, so it has to leave room for
// them — and for a 20 MB video on a slow link.
const uploadTimeoutMs = positiveIntEnv("R2_UPLOAD_TIMEOUT_MS", 120000);
const uploadRetries = positiveIntEnv("R2_UPLOAD_RETRIES", 4);

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Runs `attempt()` until it reports success. `attempt` returns { ok, retryable, error } so the
// caller can classify an HTTP status itself — a 404 means the manifest and the bucket disagree
// and must surface at once, not after four identical retries.
async function withRetry(label, attempt) {
  let lastError;

  for (let tryNumber = 1; tryNumber <= downloadAttempts; tryNumber += 1) {
    if (tryNumber > 1) await sleep(Math.min(2000, 250 * 2 ** (tryNumber - 2)) + Math.random() * 250);

    let outcome;
    try {
      outcome = await attempt();
    } catch (error) {
      // Network-level failures (reset, DNS, abort on timeout) are exactly the transient class
      // this exists for, so they are always worth another try.
      outcome = { ok: false, retryable: true, error };
    }

    if (outcome.ok) return outcome.value;
    lastError = outcome.error;
    if (!outcome.retryable) break;
    if (tryNumber < downloadAttempts) {
      console.warn(`${label} failed (attempt ${tryNumber}/${downloadAttempts}): ${lastError?.message || lastError}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

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

// The committed manifest alone, without any not-yet-folded upload records. Only compaction
// and the migration scripts want this; every reader that resolves a media reference wants
// loadManifest(), or it will miss uploads that happened since the last production build.
function loadBaseManifest() {
  return readBaseManifest(root);
}

function loadPendingUploads() {
  return readPendingUploads(root);
}

function loadManifest() {
  return readMergedManifest(root);
}

function savePendingUpload(key, entry) {
  fs.mkdirSync(pendingUploadsDir, { recursive: true });
  const file = path.join(pendingUploadsDir, pendingUploadFileName(key));
  fs.writeFileSync(file, `${JSON.stringify({ key, entry }, null, 2)}\n`);
  return `${pendingUploadsRelativeDir}/${pendingUploadFileName(key)}`;
}

// Deletes the upload records. Only correct once their entries are actually in the committed
// manifest — loadManifest() already merges them in, so a `saveManifest(loadManifest())` is
// the fold, and this is the second half of it. Returns the relative paths it removed so the
// caller can stage the deletions: a fold committed without them resurrects the records.
function removePendingUploads() {
  const keys = Object.keys(loadPendingUploads());
  return keys.map((key) => {
    const name = pendingUploadFileName(key);
    fs.rmSync(path.join(pendingUploadsDir, name), { force: true });
    return `${pendingUploadsRelativeDir}/${name}`;
  });
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

// R2's dedicated "Manage R2 API Tokens" dashboard flow (the recommended way to create a
// bucket-scoped token: https://developers.cloudflare.com/r2/api/tokens/) hands back a ready-to-
// use Access Key ID and Secret Access Key pair directly — no separate hashing step needed, unlike
// deriving S3 credentials from a generic Cloudflare API token's raw value.
// The S3 API (unlike the simpler native object-PUT endpoint) is what Cloudflare recommends for
// real workloads, is what accepts a bucket-scoped "R2 Storage Bucket Item" token in the first
// place, and is the only way to set Cache-Control on the object.
function credentialsFromEnv(env = process.env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required to publish media to R2.");
  if (!accessKeyId) throw new Error("CLOUDFLARE_R2_ACCESS_KEY_ID is required to publish media to R2.");
  if (!secretAccessKey) throw new Error("CLOUDFLARE_R2_SECRET_ACCESS_KEY is required to publish media to R2.");
  return { accountId, accessKeyId, secretAccessKey };
}

// AwsClient retries 5xx and 429 itself and returns anything else straight away — exactly the
// classification an upload wants, so this needs no retry wrapper of its own. Its default of 10
// retries is more than this pipeline has any use for: the exponential backoff alone would spend
// close to a minute asleep before giving up. Four rides out a blip and still fails while the
// operator is watching.
function s3Client({ accessKeyId, secretAccessKey }) {
  return new AwsClient({ accessKeyId, secretAccessKey, region: "auto", service: "s3", retries: uploadRetries });
}

// R2_S3_ENDPOINT lets tests point this at a local stub server instead of the real Cloudflare
// endpoint; production never sets it, so this always defaults to the real R2 endpoint.
function s3Endpoint(accountId, env) {
  return env.R2_S3_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
}

async function putObject({ accountId, accessKeyId, secretAccessKey, key, buffer, contentType, env }) {
  const client = s3Client({ accessKeyId, secretAccessKey });
  const url = `${s3Endpoint(accountId, env)}/${bucketName}/${key}`;

  // The signal bounds the whole call including AwsClient's internal retries, which is the
  // semantic we want: an upload that cannot finish within the budget is a failure, not
  // something to keep restarting from the top. Verified to be honoured — aws4fetch forwards
  // `signal` through its signing step to the underlying fetch.
  const response = await client.fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType, "Cache-Control": cacheControl },
    body: buffer,
    signal: AbortSignal.timeout(uploadTimeoutMs)
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

  const { accountId, accessKeyId, secretAccessKey } = credentialsFromEnv(env);
  const contentType = contentTypeFor(localPath);
  await putObject({ accountId, accessKeyId, secretAccessKey, key, buffer, contentType, env });

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

  const buffer = await withRetry(`Media download ${key}`, async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(downloadTimeoutMs) });
    if (!response.ok) {
      return {
        ok: false,
        // A 404 is the manifest and the bucket disagreeing — a real defect worth surfacing at
        // once, not something another request will fix.
        retryable: isRetryableStatus(response.status),
        error: new Error(`Media download failed for ${key}: ${response.status} ${url}`)
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (expectedSha256 && hashBuffer(bytes) !== expectedSha256) {
      return {
        ok: false,
        // A truncated body reads as a hash mismatch, and that is the common case here — worth
        // one more try before declaring the object itself wrong.
        retryable: true,
        error: new Error(
          `Downloaded content for ${key} does not match the manifest's sha256 — refusing to write ${destinationPath}`
        )
      };
    }

    return { ok: true, value: bytes };
  });

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  // Write-then-rename, because the half-written file an interrupted run leaves behind would
  // otherwise be indistinguishable from a complete one: prepare-media-source.js decides what to
  // restore with fs.existsSync, so a truncated image would silently become the source every
  // later build reads dimensions and responsive variants from.
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(temporaryPath, buffer);
    fs.renameSync(temporaryPath, destinationPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

module.exports = {
  bucketName,
  // Exported for scripts/report-media-drift.js, which signs its own ListObjectsV2 request
  // rather than going through publishMediaFile.
  credentialsFromEnv,
  s3Endpoint,
  removePendingUploads,
  contentTypeFor,
  deliveryHost,
  deliveryUrlForKey,
  downloadMediaFile,
  hashBuffer,
  loadBaseManifest,
  loadManifest,
  loadPendingUploads,
  objectKeyForPublicPath,
  pendingUploadFileName,
  pendingUploadsRelativeDir,
  publishMediaFile,
  savePendingUpload,
  saveManifest
};
