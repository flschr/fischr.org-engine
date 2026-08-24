const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { AwsClient } = require("aws4fetch");
const sharp = require("sharp");

const { imageMimeType, videoMimeType } = require("../../lib/eleventy/social");
const {
  contentAddressedKey,
  storedObjectKey,
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
// Die Wartezeit zwischen zwei Versuchen, als Grundwert für den exponentiellen Backoff.
//
// Einstellbar aus demselben Grund wie die Versuchszahl darüber — nur zieht dieser Wert an einer
// anderen Stelle: Tests, die belegen, *dass* wiederholt wird, warten sonst die echten Pausen ab.
// Zwei davon kosteten je gut 6 s, und weil der Engine-Export dieselbe Testdatei im Snapshot
// nochmal fährt, zahlte das Gate sie doppelt — rund ein Viertel des gesamten Testlaufs für
// reines Schlafen. Am Verhalten in Produktion ändert der Vorgabewert nichts.
const retryBaseDelayMs = positiveIntEnv("R2_RETRY_BASE_DELAY_MS", 250);

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
    if (tryNumber > 1) {
      const gedeckelt = Math.min(8 * retryBaseDelayMs, retryBaseDelayMs * 2 ** (tryNumber - 2));
      await sleep(gedeckelt + Math.random() * retryBaseDelayMs);
    }

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

// Der unscharfe Platzhalter, einmal beim Hochladen gerechnet statt bei jedem Bau.
//
// Er wird als data:-URI in die HTML-Seite eingebettet und zeigt dort etwas an, solange das
// eigentliche Bild noch lädt. Gerechnet wird er aus den Bytes — und weil die seit der
// Auslagerung nach R2 nicht mehr im Checkout liegen, zwang genau dieser eine Wert jeden Bau
// dazu, 294 MB in 1158 Dateien herunterzuladen.
//
// Rund 200 Zeichen je Bild, für den ganzen Bestand etwa 222 KB im Manifest. Die Abmessungen
// stehen aus demselben Grund schon dort.
async function rasterLqip(localPath) {
  if (!rasterExtensions.has(path.extname(localPath).toLowerCase())) return null;
  try {
    const buffer = await sharp(localPath, { failOn: "none" })
      .rotate()
      .resize({ width: 24 })
      .blur()
      .webp({ quality: 40 })
      .toBuffer();
    return `data:image/webp;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

// Wann das Manifest alles über ein Bild weiss, was der Bau daraus braucht: Abmessungen,
// Durchsichtigkeit und — sofern das Bild überhaupt einen bekommt — den Platzhalter. Steht das
// alles da, müssen die Bytes für den Bau nicht mehr geholt werden. Die Regel steht einmal, weil
// Erzeuger, Nachtrag und Download sonst auseinanderlaufen können, ohne dass es auffällt.
function vollstaendigBeschrieben(entry) {
  if (!entry?.sha256 || !entry?.width || !entry?.height) return false;
  if (typeof entry.hasAlpha !== "boolean") return false;
  return entry.hasAlpha ? true : Boolean(entry.lqip);
}

async function rasterDimensions(localPath) {
  if (!rasterExtensions.has(path.extname(localPath).toLowerCase())) return null;
  try {
    const metadata = await sharp(localPath).metadata();
    return metadata.width && metadata.height
      ? { width: metadata.width, height: metadata.height, hasAlpha: Boolean(metadata.hasAlpha) }
      : null;
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

// The same three variables, but absence is an expected state rather than a defect: only CI
// holds them. Every other caller — a fresh clone, local `npm start` — is meant to read media
// from the public delivery domain, so an incomplete set means "use the public path", not
// "fail". Kept separate from credentialsFromEnv so the write path keeps throwing a named error
// for each missing variable; silently degrading an *upload* to some other route is never right.
function optionalCredentialsFromEnv(env = process.env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
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

// The read half of putObject, against the same bucket over the same signed S3 API. This is the
// path CI takes, and the point of it is what it does *not* go through: the public delivery
// domain answers from an edge cache holding `max-age=31536000`, so it can serve bytes that no
// longer match the object behind it. A build that verifies against the manifest then fails on a
// cache entry rather than on anything real — see downloadMediaFile.
//
// Needs no retry wrapper of its own: AwsClient repeats 5xx and 429 and surfaces everything else
// at once, the same classification the upload side relies on.
async function getObject({ accountId, accessKeyId, secretAccessKey, key, env }) {
  const client = s3Client({ accessKeyId, secretAccessKey });
  const url = `${s3Endpoint(accountId, env)}/${bucketName}/${key}`;

  const response = await client.fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(downloadTimeoutMs)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`R2 download failed for ${key}: ${response.status} ${detail}`.trim());
    // Markiert diesen Fehler als "die Gegenstelle hat geantwortet". Der Aufrufer unterscheidet
    // daran eine Ablehnung von einem Transportfehler — siehe downloadFromBucket.
    error.httpStatus = response.status;
    throw error;
  }

  return Buffer.from(await response.arrayBuffer());
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
  const objectKey = contentAddressedKey(key, hash);
  await putObject({ accountId, accessKeyId, secretAccessKey, key: objectKey, buffer, contentType, env });

  // What this entry used to be served from, if that was a different object. An entry replacing
  // one of the original path-keyed uploads leaves that object in the bucket deliberately: its
  // address is baked into published feed items, syndicated posts and the absolute URLs in the
  // post archive, and all of those have to keep resolving. Recording it here is what keeps the
  // drift report from calling it an orphan.
  const previousObjectKey = existing ? storedObjectKey(existing, key) : null;
  const superseded = [
    ...(existing && Array.isArray(existing.supersededObjectKeys) ? existing.supersededObjectKeys : []),
    ...(previousObjectKey && previousObjectKey !== objectKey ? [previousObjectKey] : [])
  ].filter((value, index, all) => all.indexOf(value) === index);

  const dimensions = await rasterDimensions(localPath);
  // Der Platzhalter wird bei durchsichtigen Bildern nicht angezeigt — er schiene durch die
  // durchsichtigen Stellen und liesse das Bild aussehen, als habe es seine Transparenz verloren.
  // Also wird für sie auch keiner erzeugt: was im Manifest steht, ist damit immer einer, der
  // gezeigt werden darf.
  const lqip = dimensions && !dimensions.hasAlpha ? await rasterLqip(localPath) : null;
  manifest[key] = {
    // Reihenfolge mit Absicht: ausdrückliche Angabe, dann der bereits eingetragene Wert, dann
    // die Ableitung aus dem lokalen Pfad. Ohne die mittlere Stufe überschreibt ein Aufrufer, der
    // aus einem Arbeitsverzeichnis ausserhalb des Repositories heraus hochlädt, einen richtigen
    // Eintrag mit einer Kette von "../". Für die beiden Aufrufer ohne ausdrückliche Angabe
    // (publish-build-media.js, migrate-media-to-r2.js) ändert sich nichts: ihre lokalen Pfade
    // liegen im Repository, die Ableitung ergibt dort denselben Wert, der schon eingetragen ist.
    sourcePath: sourcePath || existing?.sourcePath || path.relative(root, localPath).split(path.sep).join("/"),
    objectKey,
    sha256: hash,
    size: buffer.length,
    contentType,
    ...(dimensions ? { width: dimensions.width, height: dimensions.height, hasAlpha: dimensions.hasAlpha } : {}),
    ...(lqip ? { lqip } : {}),
    ...(superseded.length ? { supersededObjectKeys: superseded } : {}),
    migratedAt: new Date().toISOString()
  };

  return "uploaded";
}

// MEDIA_DELIVERY_BASE_URL lets tests point this at a local stub server instead of the real
// public delivery domain; production never sets it, so this always defaults to the live host.
//
// `sha256` appends the same content-hash query the pages use for replaceable assets
// (`?v=<first eight hex>`). The delivery domain serves media with `max-age=31536000`, and the
// edge cache learns nothing from an R2 PUT: replacing an object under an existing key leaves
// the old bytes being served for up to a year. The build downloads through this domain and
// verifies against the manifest's hash, so on 2026-08-23 a replaced apple-touch-icon.png made
// every push to main fail with "does not match the manifest's sha256" — and because validation
// runs before the deploy step, nothing shipped at all until the URL was purged by hand.
//
// Keying the request on the content moves the cache entry whenever the bytes move, so a
// replacement can no longer strand the build on a stale copy. It also means the build checks
// the very URL visitors are sent to, rather than one nobody requests.
function deliveryUrlForKey(key, env = process.env, sha256 = null) {
  const base = env.MEDIA_DELIVERY_BASE_URL || `https://${deliveryHost}`;
  const version = sha256 ? `?v=${sha256.slice(0, 8)}` : "";
  return `${base}/${key}${version}`;
}

// Restores a manifest-listed file that is missing from the local checkout (once Git no longer
// carries migrated media). Verifies the bytes against the manifest's recorded hash before
// writing, since a corrupt or unexpected response must never silently become the new "local
// original" for image-dimension reads / responsive-variant generation.
//
// Two routes, and which one is taken matters more than it looks:
//
//   * With R2 credentials (CI) the bytes come from the bucket over the signed S3 API. The
//     bucket is the thing the manifest actually describes, so this compares like with like.
//   * Without them (a fresh clone, local dev) they come from the public delivery domain, which
//     needs no credentials — the property that lets `npm run media:source` turn any clone into
//     a buildable copy, and worth keeping for exactly that.
//
// The public route reads through an edge cache serving `max-age=31536000`, and that cache
// learns nothing from an R2 PUT. Replacing an object under an existing key therefore leaves the
// old bytes being served for up to a year, and a build verifying against the manifest fails on
// the cache rather than on anything real. That is not hypothetical: on 2026-08-23 a replaced
// apple-touch-icon.png made every push to main fail with "does not match the manifest's sha256",
// and because validation runs before the deploy step, nothing shipped at all. The `?v=` below
// moves the cache entry with the bytes and keeps that from stranding a clone; taking CI off the
// cached path altogether is what keeps it from ever stranding a deploy.
async function downloadMediaFile({ key, objectKey, destinationPath, expectedSha256, env = process.env }) {
  // `key` identifies the entry, `objectKey` addresses its bytes. They are the same for every
  // original upload and diverge for anything written since — see lib/media-manifest.js.
  const address = objectKey || key;
  const credentials = optionalCredentialsFromEnv(env);
  const buffer = credentials
    ? await downloadFromBucket({ credentials, key: address, destinationPath, expectedSha256, env })
    : await downloadFromDeliveryDomain({ key: address, destinationPath, expectedSha256, env });

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

// Shared by both routes so neither can quietly skip the check. Returns an error to hand back to
// withRetry rather than throwing, because the caller decides whether this attempt is worth
// repeating.
function hashMismatch(key, bytes, expectedSha256, destinationPath) {
  if (!expectedSha256 || hashBuffer(bytes) === expectedSha256) return null;
  return new Error(
    `Downloaded content for ${key} does not match the manifest's sha256 — refusing to write ${destinationPath}`
  );
}

async function downloadFromBucket({ credentials, key, destinationPath, expectedSha256, env }) {
  return withRetry(`Media download ${key}`, async () => {
    // Zwei Fehlerarten, und sie dürfen nicht gleich behandelt werden.
    //
    // Hat die Gegenstelle geantwortet (`httpStatus` gesetzt), ist die Sache erledigt: AwsClient
    // hat 5xx und 429 zu diesem Zeitpunkt schon abgearbeitet, und ein 403 oder 404 wird von
    // keiner Wiederholung besser. Nochmal drüberzugehen multiplizierte nur die beiden Budgets.
    //
    // Kam gar keine Antwort — Verbindungsabbruch, DNS, abgelaufene Zeitschranke —, dann hat
    // AwsClient nichts wiederholt: seine Schleife prüft `res.status`, und ein geworfener
    // fetch-Fehler verlässt sie, bevor sie dazu kommt. Genau das ist der Fall, für den der
    // Wiederholungs-Rahmen oben überhaupt existiert (siehe den Kommentar bei
    // downloadAttempts): ein Build zieht über tausend Dateien hier durch, und ein einzelner
    // Abbruch hat früher den ganzen Deploy scheitern lassen. Seit der Bucket der Weg des CI
    // ist, gilt das für ihn erst recht.
    let bytes;
    try {
      bytes = await getObject({ ...credentials, key, env });
    } catch (error) {
      return { ok: false, retryable: !error?.httpStatus, error };
    }

    // A truncated body reads as a hash mismatch, and against the bucket that is the only way
    // this can fire at all — the stale-cache case cannot reach here.
    const mismatch = hashMismatch(key, bytes, expectedSha256, destinationPath);
    if (mismatch) return { ok: false, retryable: true, error: mismatch };

    return { ok: true, value: bytes };
  });
}

async function downloadFromDeliveryDomain({ key, destinationPath, expectedSha256, env }) {
  const url = deliveryUrlForKey(key, env, expectedSha256);

  return withRetry(`Media download ${key}`, async () => {
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
    const mismatch = hashMismatch(key, bytes, expectedSha256, destinationPath);
    if (mismatch) {
      // A truncated body reads as a hash mismatch too, so one more try is worth it before
      // declaring the object wrong. A genuinely stale edge copy survives the retries and fails
      // the run, which is the correct outcome for a route that cannot tell the two apart.
      return { ok: false, retryable: true, error: mismatch };
    }

    return { ok: true, value: bytes };
  });
}

module.exports = {
  bucketName,
  // Exported for scripts/report-media-drift.js, which signs its own ListObjectsV2 request
  // rather than going through publishMediaFile.
  credentialsFromEnv,
  optionalCredentialsFromEnv,
  s3Endpoint,
  removePendingUploads,
  contentAddressedKey,
  contentTypeFor,
  rasterDimensions,
  rasterLqip,
  vollstaendigBeschrieben,
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
