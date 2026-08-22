// Normalizes an admin image upload in-request instead of through a GitHub Actions run.
//
// Same contract as the admin-normalize-image.yml workflow it replaces — { draftSha,
// sourcePath, targetPath } in, the normalized WebP in R2 out — with one deliberate
// difference: this endpoint never writes to Git. It returns the upload record and lets the
// admin commit it through blog/admin/draft-repository.js, the compare-and-swap path that
// already handles concurrent draft saves. A second writer racing the browser against
// `drafts` is the one part of the media flow that has broken repeatedly (see the
// transactional-publishing learning); keeping it single-writer is worth the round trip.
//
// The workflow stays in place as a fallback and still owns anything this cannot do — inputs
// over the transform's 20 MB ceiling, most obviously.

import { adminRepository, githubHeaders, jsonResponse, readSession } from "../../../_admin-auth.js";
import { transformToWebp } from "./_transform.js";

const UPLOAD_PATH = /^blog\/assets\/images\/uploads\/[a-zA-Z0-9._-]+$/;
const DEFAULT_DELIVERY_BASE_URL = "https://media.mysite.example";

export async function onRequestPost(context) {
  return handleNormalizeRequest(context);
}

export async function handleNormalizeRequest(context, dependencies = {}) {
  const readSessionFn = dependencies.readSession || readSession;
  const fetchFn = dependencies.fetch || fetch;
  const transform = dependencies.transformToWebp || transformToWebp;
  const now = dependencies.now || (() => new Date().toISOString());

  const session = await readSessionFn(context.request, context.env);
  if (!session) return jsonResponse({ message: "Nicht angemeldet." }, { status: 401 });

  const origin = context.request.headers.get("Origin");
  if (origin && origin !== new URL(context.request.url).origin) {
    return jsonResponse({ message: "Ungültiger Ursprung." }, { status: 403 });
  }

  const bucket = context.env.MEDIA_BUCKET;
  if (!bucket) return jsonResponse({ message: "Medien-Endpunkt ist nicht konfiguriert." }, { status: 503 });

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ message: "Ungültige Anfrage." }, { status: 400 });
  }

  const request = {
    draftSha: String(payload?.draftSha || ""),
    sourcePath: String(payload?.sourcePath || ""),
    targetPath: String(payload?.targetPath || "")
  };
  const invalid = validateNormalizeRequest(request);
  if (invalid) return jsonResponse({ message: invalid }, { status: 400 });

  const objectKey = objectKeyForUploadPath(request.targetPath);
  const raw = await readUploadBlob(context.env, session.token, request, fetchFn);

  // The admin retries a failed upload with whatever drafts head its tab last saw. Once an
  // earlier attempt finished, the raw upload is no longer in that commit — the same
  // idempotency the workflow's reportAlreadyProcessed() provides, so a retry of completed
  // work reports success instead of resurfacing a media error the user cannot clear.
  if (raw === null) {
    const stored = await bucket.head(objectKey);
    if (stored) {
      return jsonResponse({ status: "already-processed", objectKey, publicPath: publicPathFor(request.targetPath) });
    }
    return jsonResponse(
      { message: `${request.sourcePath} fehlt in ${request.draftSha} und erreichte R2 nie.` },
      { status: 409 }
    );
  }

  let webp;
  try {
    webp = await transform(raw.bytes, {
      bucket,
      deliveryBaseUrl: context.env.MEDIA_DELIVERY_BASE_URL || DEFAULT_DELIVERY_BASE_URL,
      contentType: raw.contentType,
      fetchImpl: fetchFn
    });
  } catch (error) {
    // 413 keeps the admin's "fall back to the workflow" branch distinguishable from a real
    // failure: an oversized input is the workflow's job, everything else is a defect.
    const status = error?.code === "INPUT_TOO_LARGE" ? 413 : 502;
    return jsonResponse({ message: error?.message || "Bildumwandlung fehlgeschlagen.", code: error?.code }, { status });
  }

  await bucket.put(objectKey, webp, {
    httpMetadata: {
      contentType: "image/webp",
      // Matches cacheControl in scripts/lib/r2-media.js — a key's bytes only ever change on a
      // deliberate re-normalization, and publishMediaFile skips the PUT when the hash matches.
      cacheControl: "public, max-age=31536000"
    }
  });

  const entry = {
    sourcePath: request.targetPath,
    sha256: await sha256Hex(webp),
    size: webp.byteLength,
    contentType: "image/webp",
    migratedAt: now()
  };

  // Deliberately no width/height: nothing reads them back out of the manifest (the build
  // measures the real file with sharp), and this runtime has no image decoder to produce
  // them honestly. An invented value would be worse than an absent one.
  return jsonResponse({
    status: "normalized",
    objectKey,
    publicPath: publicPathFor(request.targetPath),
    recordPath: uploadRecordPath(objectKey),
    record: { key: objectKey, entry }
  });
}

// Mirrors validateRequest() in scripts/admin-normalize-image.js. Both guard the same thing:
// this endpoint may only ever write under the uploads prefix, whatever a caller sends.
export function validateNormalizeRequest({ draftSha, sourcePath, targetPath }) {
  if (!draftSha) return "draftSha ist erforderlich.";
  if (!UPLOAD_PATH.test(sourcePath) || !UPLOAD_PATH.test(targetPath)) return "Ungültiger Bildpfad.";
  if (!targetPath.endsWith(".webp")) return "targetPath muss auf .webp enden.";
  if (directoryOf(sourcePath) !== directoryOf(targetPath)) return "Bildpfade müssen im selben Verzeichnis liegen.";
  return "";
}

// Mirrors pendingUploadFileName in lib/media-manifest.js.
export function uploadRecordPath(objectKey) {
  return `automation/media-uploads/${objectKey.replace(/[^a-zA-Z0-9._-]+/g, "__")}.json`;
}

// Mirrors objectKeyForPublicPath in scripts/lib/r2-media.js, for the uploads prefix only.
function objectKeyForUploadPath(targetPath) {
  return `images/${targetPath.slice("blog/assets/images/".length)}`;
}

function publicPathFor(targetPath) {
  return `/${targetPath.replace(/^blog\//, "")}`;
}

function directoryOf(value) {
  return value.slice(0, value.lastIndexOf("/"));
}

// Returns null when the blob is not in that commit — the caller treats it as "already
// processed or genuinely lost", exactly as the workflow does.
async function readUploadBlob(env, token, { draftSha, sourcePath }, fetchFn) {
  const url = `https://api.github.com/repos/${adminRepository(env)}/contents/${encodeURI(sourcePath)}?ref=${encodeURIComponent(draftSha)}`;
  const response = await fetchFn(url, {
    headers: githubHeaders(token, { Accept: "application/vnd.github.raw" })
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw Object.assign(new Error(`GitHub ${response.status}`), { code: "GITHUB_READ_FAILED" });
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("Content-Type") || "application/octet-stream"
  };
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
