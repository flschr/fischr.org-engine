// Turns an admin upload into the same 1600 px WebP that scripts/admin-normalize-image.js
// produces with sharp today — but inside a request instead of a GitHub Actions run.
//
// Pages Functions do not support the Images binding (env.IMAGES), only Workers do, so this
// goes through the URL form of the same product: a fetch whose `cf.image` options transform
// the response. That form needs the source reachable by URL, and the upload only exists as
// bytes in this request, so it is staged in R2 under a random key, transformed through the
// public delivery domain, and deleted again.
//
// The staging object is publicly readable for the moment it exists. That is acceptable here
// (it is the author's own photo, on its way to being published anyway) but it is the reason
// the key is random and the delete runs in a finally block.

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

// Mirrors the sharp pipeline in scripts/admin-normalize-image.js:
//   .rotate() .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
//   .webp({ quality: 76 })
// "scale-down" is the fit that matches `inside` + `withoutEnlargement`: never upscale, keep
// the aspect ratio, bound both sides. EXIF orientation is applied by Images itself, which is
// what sharp's .rotate() with no argument does.
export const TRANSFORM_OPTIONS = {
  width: 1600,
  height: 1600,
  fit: "scale-down",
  format: "webp",
  quality: 76
};

const STAGING_PREFIX = "staging/admin-upload";

export function stagingKey(randomId) {
  return `${STAGING_PREFIX}-${randomId}`;
}

export async function transformToWebp(bytes, {
  bucket,
  deliveryBaseUrl,
  contentType = "application/octet-stream",
  fetchImpl = fetch,
  randomId = crypto.randomUUID(),
  attempts = 3,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    const error = new Error(`Bild ist zu groß (max. ${MAX_INPUT_BYTES / (1024 * 1024)} MB).`);
    error.code = "INPUT_TOO_LARGE";
    throw error;
  }

  const key = stagingKey(randomId);
  await bucket.put(key, bytes, { httpMetadata: { contentType, cacheControl: "no-store" } });

  let output;
  try {
    const response = await fetchImpl(`${deliveryBaseUrl}/${key}`, { cf: { image: TRANSFORM_OPTIONS } });
    if (!response.ok) {
      const error = new Error(`Bildumwandlung fehlgeschlagen (${response.status}).`);
      error.code = "TRANSFORM_FAILED";
      error.status = response.status;
      throw error;
    }
    output = new Uint8Array(await response.arrayBuffer());
    // A zone without Image Transformations enabled answers with the untouched original rather
    // than an error, which would silently store a HEIC under a .webp key and 404 every
    // responsive variant later. Verify the RIFF/WEBP magic before accepting the bytes.
    if (!isWebp(output)) {
      const error = new Error("Bildumwandlung lieferte kein WebP — sind Image Transformations für die Zone aktiv?");
      error.code = "TRANSFORM_NOT_APPLIED";
      throw error;
    }
  } catch (error) {
    // Best effort on the failure path: the transform error is the one worth reporting, and
    // rethrowing a cleanup failure from here would mask it.
    await removeStagedObject(bucket, key, { attempts, wait }).catch(() => {});
    throw error;
  }

  // On the success path a failed cleanup is *not* ignorable. The staged object is the
  // untouched original: full resolution, and carrying the EXIF (including GPS) that the
  // published WebP drops. Leaving it readable on the public delivery domain is worse than
  // failing an upload the writer can simply repeat, so this surfaces instead of passing.
  await removeStagedObject(bucket, key, { attempts, wait });
  return output;
}

async function removeStagedObject(bucket, key, { attempts, wait }) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt) await wait(200 * attempt);
    try {
      await bucket.delete(key);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  const error = new Error(
    `Zwischengespeichertes Original ${key} konnte nicht gelöscht werden: ${lastError?.message || "unbekannt"}`
  );
  error.code = "STAGING_CLEANUP_FAILED";
  throw error;
}

function isWebp(bytes) {
  if (!bytes || bytes.byteLength < 12) return false;
  // "RIFF" .... "WEBP"
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}
