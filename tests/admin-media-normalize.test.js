const assert = require("node:assert/strict");
const test = require("node:test");

let endpoint;
let transform;
test.before(async () => {
  endpoint = await import("../functions/api/admin/media/normalize.js");
  transform = await import("../functions/api/admin/media/_transform.js");
});

const VALID = {
  draftSha: "0123456789abcdef0123456789abcdef01234567",
  sourcePath: "blog/assets/images/uploads/2026-08-22-photo.heic",
  targetPath: "blog/assets/images/uploads/2026-08-22-photo.webp"
};

function webpBytes(payload = "fake-webp-body") {
  const body = new TextEncoder().encode(payload);
  const bytes = new Uint8Array(12 + body.length);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(body, 12);
  return bytes;
}

function fakeBucket(initial = {}, { failDeletes = 0 } = {}) {
  const objects = new Map(Object.entries(initial));
  let remainingDeleteFailures = failDeletes;
  return {
    objects,
    deletes: [],
    deleteAttempts: 0,
    async put(key, value, options) {
      objects.set(key, { value, options });
      return { key };
    },
    async head(key) {
      return objects.has(key) ? { key } : null;
    },
    async delete(key) {
      this.deleteAttempts += 1;
      if (remainingDeleteFailures > 0) {
        remainingDeleteFailures -= 1;
        throw new Error("R2 unavailable");
      }
      this.deletes.push(key);
      objects.delete(key);
    }
  };
}

function context(body, env = {}, headers = {}) {
  return {
    request: new Request("https://mysite.example/api/admin/media/normalize", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body)
    }),
    env: { MEDIA_BUCKET: fakeBucket(), ADMIN_GITHUB_REPO: "example/example-blog", ...env }
  };
}

const authenticated = { readSession: async () => ({ login: "rene", token: "gh-token" }) };

// Returns the raw upload for the happy path; a caller can override the response.
function githubReturning(response) {
  return async () => response;
}

const rawUpload = () => new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
  status: 200,
  headers: { "Content-Type": "image/heic" }
});

function deps(overrides = {}) {
  return {
    ...authenticated,
    fetch: githubReturning(rawUpload()),
    transformToWebp: async () => webpBytes(),
    now: () => "2026-08-22T12:00:00.000Z",
    ...overrides
  };
}

test("normalize endpoint requires an authenticated admin session", async () => {
  const response = await endpoint.handleNormalizeRequest(context(VALID), { readSession: async () => null });
  assert.equal(response.status, 401);
});

test("normalize endpoint rejects cross-origin requests", async () => {
  const response = await endpoint.handleNormalizeRequest(
    context(VALID, {}, { Origin: "https://evil.example" }),
    deps()
  );
  assert.equal(response.status, 403);
});

test("normalize endpoint reports a missing R2 binding instead of failing obscurely", async () => {
  const ctx = context(VALID, { MEDIA_BUCKET: undefined });
  const response = await endpoint.handleNormalizeRequest(ctx, deps());
  assert.equal(response.status, 503);
});

// The endpoint may only ever write under the uploads prefix, whatever a caller sends. These
// mirror validateRequest() in scripts/admin-normalize-image.js one for one.
test("normalize endpoint accepts only uploads-prefixed .webp targets", async () => {
  const cases = [
    [{ ...VALID, draftSha: "" }, "draftSha ist erforderlich."],
    [{ ...VALID, targetPath: "blog/assets/images/uploads/photo.png" }, "targetPath muss auf .webp enden."],
    [{ ...VALID, targetPath: "blog/posts/evil.webp" }, "Ungültiger Bildpfad."],
    [{ ...VALID, sourcePath: "blog/assets/images/uploads/../../../evil.heic" }, "Ungültiger Bildpfad."],
    [{ ...VALID, targetPath: "blog/assets/images/other/photo.webp" }, "Ungültiger Bildpfad."]
  ];
  for (const [payload, expected] of cases) {
    assert.equal(endpoint.validateNormalizeRequest({
      draftSha: payload.draftSha, sourcePath: payload.sourcePath, targetPath: payload.targetPath
    }), expected);
    const response = await endpoint.handleNormalizeRequest(context(payload), deps());
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(payload)}`);
  }
});

test("normalize endpoint stores the WebP in R2 and returns a foldable upload record", async () => {
  const ctx = context(VALID);
  const response = await endpoint.handleNormalizeRequest(ctx, deps());
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.status, "normalized");
  assert.equal(body.objectKey, "images/uploads/2026-08-22-photo.webp");
  assert.equal(body.publicPath, "/assets/images/uploads/2026-08-22-photo.webp");
  // The record path and shape have to match lib/media-manifest.js exactly, or the build will
  // not fold the upload in and the image resolves to a path that is no longer in Git.
  assert.equal(body.recordPath, "automation/media-uploads/images__uploads__2026-08-22-photo.webp.json");
  assert.equal(body.record.key, "images/uploads/2026-08-22-photo.webp");
  assert.equal(body.record.entry.sourcePath, VALID.targetPath);
  assert.equal(body.record.entry.contentType, "image/webp");
  assert.equal(body.record.entry.migratedAt, "2026-08-22T12:00:00.000Z");
  assert.match(body.record.entry.sha256, /^[0-9a-f]{64}$/);

  const stored = ctx.env.MEDIA_BUCKET.objects.get("images/uploads/2026-08-22-photo.webp");
  assert.ok(stored, "expected the normalized image in R2");
  assert.equal(stored.options.httpMetadata.contentType, "image/webp");
  assert.equal(stored.options.httpMetadata.cacheControl, "public, max-age=31536000");
});

test("the recorded hash and size describe the stored bytes, not the upload", async () => {
  const ctx = context(VALID);
  const output = webpBytes("distinct-body");
  const response = await endpoint.handleNormalizeRequest(ctx, deps({ transformToWebp: async () => output }));
  const body = await response.json();

  const digest = await crypto.subtle.digest("SHA-256", output);
  const expected = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(body.record.entry.sha256, expected);
  assert.equal(body.record.entry.size, output.byteLength);
});

// Retry idempotency: the admin re-sends the draft head its tab last saw, which no longer
// contains the raw upload once an earlier attempt finished. Reporting success is what keeps
// the user from being stuck behind a media error for work that is already done.
test("a retry after a finished run reports success instead of an error", async () => {
  const ctx = context(VALID, { MEDIA_BUCKET: fakeBucket({ "images/uploads/2026-08-22-photo.webp": {} }) });
  const response = await endpoint.handleNormalizeRequest(ctx, deps({
    fetch: githubReturning(new Response("", { status: 404 }))
  }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "already-processed");
});

test("a missing raw upload that never reached R2 is a conflict, not a silent success", async () => {
  const response = await endpoint.handleNormalizeRequest(context(VALID), deps({
    fetch: githubReturning(new Response("", { status: 404 }))
  }));
  assert.equal(response.status, 409);
});

test("an oversized input is a 413 so the admin can fall back to the workflow", async () => {
  const response = await endpoint.handleNormalizeRequest(context(VALID), deps({
    transformToWebp: async () => {
      throw Object.assign(new Error("Bild ist zu groß (max. 20 MB)."), { code: "INPUT_TOO_LARGE" });
    }
  }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "INPUT_TOO_LARGE");
});

test("nothing is written to R2 when the transform fails", async () => {
  const ctx = context(VALID);
  const response = await endpoint.handleNormalizeRequest(ctx, deps({
    transformToWebp: async () => {
      throw Object.assign(new Error("nope"), { code: "TRANSFORM_FAILED" });
    }
  }));
  assert.equal(response.status, 502);
  assert.equal(ctx.env.MEDIA_BUCKET.objects.size, 0);
});

// --- the transform itself -------------------------------------------------

test("the transform stages the original, converts it, and always removes the staging object", async () => {
  const bucket = fakeBucket();
  const seen = [];
  const output = await transform.transformToWebp(new Uint8Array([1, 2, 3]), {
    bucket,
    deliveryBaseUrl: "https://media.mysite.example",
    contentType: "image/heic",
    randomId: "fixed-id",
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(webpBytes().buffer, { status: 200 });
    }
  });

  assert.equal(seen[0].url, "https://media.mysite.example/staging/admin-upload-fixed-id");
  // Must match the sharp pipeline in scripts/admin-normalize-image.js.
  assert.deepEqual(seen[0].init.cf.image, {
    width: 1600, height: 1600, fit: "scale-down", format: "webp", quality: 76
  });
  assert.ok(output.byteLength > 0);
  assert.deepEqual(bucket.deletes, ["staging/admin-upload-fixed-id"]);
  assert.equal(bucket.objects.size, 0, "the staged original must not stay publicly readable");
});

test("the staging object is removed even when the transform fails", async () => {
  const bucket = fakeBucket();
  await assert.rejects(
    () => transform.transformToWebp(new Uint8Array([1, 2, 3]), {
      bucket,
      deliveryBaseUrl: "https://media.mysite.example",
      randomId: "fixed-id",
      fetchImpl: async () => new Response("boom", { status: 500 })
    }),
    /Bildumwandlung fehlgeschlagen \(500\)/
  );
  assert.deepEqual(bucket.deletes, ["staging/admin-upload-fixed-id"]);
});

// A zone without Image Transformations answers with the untouched original instead of an
// error. Storing that under a .webp key would 404 every responsive variant generated later,
// and the failure would only surface long after the upload looked successful.
test("an untransformed passthrough response is rejected rather than stored as WebP", async () => {
  const bucket = fakeBucket();
  await assert.rejects(
    () => transform.transformToWebp(new Uint8Array([1, 2, 3]), {
      bucket,
      deliveryBaseUrl: "https://media.mysite.example",
      randomId: "fixed-id",
      fetchImpl: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer, { status: 200 })
    }),
    /Image Transformations für die Zone aktiv/
  );
  assert.deepEqual(bucket.deletes, ["staging/admin-upload-fixed-id"]);
});

test("an input above the transform ceiling is refused before anything is staged", async () => {
  const bucket = fakeBucket();
  await assert.rejects(
    () => transform.transformToWebp(new Uint8Array(transform.MAX_INPUT_BYTES + 1), {
      bucket,
      deliveryBaseUrl: "https://media.mysite.example",
      fetchImpl: async () => new Response(webpBytes().buffer, { status: 200 })
    }),
    /Bild ist zu groß/
  );
  assert.equal(bucket.objects.size, 0);
  assert.deepEqual(bucket.deletes, []);
});

// The staged object is the untouched original: full resolution, and carrying the EXIF
// (including GPS) that the published WebP drops. A cleanup failure must not be swallowed
// into a successful-looking upload.
test("a transient delete failure is retried rather than leaking the staged original", async () => {
  const bucket = fakeBucket({}, { failDeletes: 2 });
  const output = await transform.transformToWebp(new Uint8Array([1, 2, 3]), {
    bucket,
    deliveryBaseUrl: "https://media.mysite.example",
    randomId: "fixed-id",
    wait: async () => {},
    fetchImpl: async () => new Response(webpBytes().buffer, { status: 200 })
  });

  assert.ok(output.byteLength > 0);
  assert.equal(bucket.deleteAttempts, 3);
  assert.deepEqual(bucket.deletes, ["staging/admin-upload-fixed-id"]);
  assert.equal(bucket.objects.size, 0);
});

test("a cleanup that keeps failing fails the request instead of reporting success", async () => {
  const bucket = fakeBucket({}, { failDeletes: Infinity });
  await assert.rejects(
    () => transform.transformToWebp(new Uint8Array([1, 2, 3]), {
      bucket,
      deliveryBaseUrl: "https://media.mysite.example",
      randomId: "fixed-id",
      wait: async () => {},
      fetchImpl: async () => new Response(webpBytes().buffer, { status: 200 })
    }),
    /konnte nicht gelöscht werden/
  );
  assert.equal(bucket.deleteAttempts, 3);
});

// On the failure path the transform error is the one worth reporting — a cleanup failure
// rethrown from there would mask it.
test("a cleanup failure never masks the transform error that caused it", async () => {
  const bucket = fakeBucket({}, { failDeletes: Infinity });
  await assert.rejects(
    () => transform.transformToWebp(new Uint8Array([1, 2, 3]), {
      bucket,
      deliveryBaseUrl: "https://media.mysite.example",
      randomId: "fixed-id",
      wait: async () => {},
      fetchImpl: async () => new Response("boom", { status: 500 })
    }),
    /Bildumwandlung fehlgeschlagen \(500\)/
  );
});

test("a failed cleanup surfaces to the endpoint as a 502", async () => {
  const response = await endpoint.handleNormalizeRequest(context(VALID), deps({
    transformToWebp: async () => {
      throw Object.assign(new Error("Zwischengespeichertes Original … konnte nicht gelöscht werden"), {
        code: "STAGING_CLEANUP_FAILED"
      });
    }
  }));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "STAGING_CLEANUP_FAILED");
});
