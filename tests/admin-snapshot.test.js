const assert = require("node:assert/strict");
const test = require("node:test");

let snapshot;
test.before(async () => {
  snapshot = await import("../functions/api/admin/snapshot.js");
});

test("admin snapshot requires a session", async () => {
  const response = await snapshot.handleSnapshotRequest(
    { request: new Request("https://mysite.example/api/admin/snapshot"), env: {} },
    { readSession: async () => null }
  );
  assert.equal(response.status, 401);
});

test("admin snapshot returns filtered main and drafts trees", async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes("git/ref/heads/")) return Response.json({ object: { sha: url.includes("drafts") ? "draft-head" : "main-head" } });
    if (url.includes("git/commits/")) return Response.json({ tree: { sha: url.includes("draft-head") ? "draft-tree" : "main-tree" } });
    if (url.includes("git/trees/")) return Response.json({ sha: url.includes("draft-tree") ? "draft-tree" : "main-tree", tree: [
      { path: "blog/posts/post.md", type: "blob", sha: "post" },
      { path: "README.md", type: "blob", sha: "readme" }
    ] });
    throw new Error(`Unexpected ${url}`);
  };
  const response = await snapshot.handleSnapshotRequest(
    { request: new Request("https://mysite.example/api/admin/snapshot"), env: {} },
    { readSession: async () => ({ token: "secret" }), fetch }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.drafts.headSha, "draft-head");
  assert.equal(body.main.headSha, "main-head");
  assert.deepEqual(body.drafts.tree.tree.map((entry) => entry.path), ["blog/posts/post.md"]);
  assert.equal(calls.length, 6);
});

test("snapshot path filter retains every admin data family", () => {
  for (const path of ["blog/posts/a.md", "blog/pages/a.md", "blog/about.njk", "blog/projects.njk", "blog/assets/images/a.webp", "blog/assets/videos/a.mp4", "blog/assets/files/gpx/a.gpx", "blog/_data/videoMetadata.json", "automation/social-config.json", "automation/admin-rename-origins.json", "automation/media-manifest.json"]) {
    assert.equal(snapshot.isAdminPath({ path, type: "blob" }), true, path);
  }
  assert.equal(snapshot.isAdminPath({ path: "README.md", type: "blob" }), false);
  assert.equal(snapshot.isAdminPath({ path: "blog/archive.njk", type: "blob" }), false);
});

test("admin snapshot keeps working when one changed blob cannot be loaded", async () => {
  const fetch = async (url) => {
    if (url.includes("git/ref/heads/")) return Response.json({ object: { sha: url.includes("drafts") ? "draft-head" : "main-head" } });
    if (url.includes("git/commits/")) return Response.json({ tree: { sha: url.includes("draft-head") ? "draft-tree" : "main-tree" } });
    if (url.includes("git/trees/draft-tree")) return Response.json({ tree: [
      { path: "blog/posts/available.md", type: "blob", sha: "available" },
      { path: "blog/posts/missing.md", type: "blob", sha: "missing" },
      { path: "blog/posts/too-large.md", type: "blob", sha: "too-large" }
    ] });
    if (url.includes("git/trees/main-tree")) return Response.json({ tree: [] });
    if (url.endsWith("git/blobs/available")) return Response.json({ content: "IyBBdmFpbGFibGU=", encoding: "base64" });
    if (url.endsWith("git/blobs/missing")) return Response.json({ message: "temporary" }, { status: 503 });
    if (url.endsWith("git/blobs/too-large")) return Response.json({ content: "x".repeat(2 * 1024 * 1024 + 1), encoding: "base64" });
    throw new Error(`Unexpected ${url}`);
  };
  const response = await snapshot.handleSnapshotRequest(
    { request: new Request("https://mysite.example/api/admin/snapshot"), env: {} },
    { readSession: async () => ({ token: "secret" }), fetch, console: { warn() {}, error() {} } }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body.blobs), ["available"]);
  assert.deepEqual(body.metrics, {
    durationMs: body.metrics.durationMs,
    changedBlobCount: 3,
    loadedBlobCount: 1,
    omittedBlobCount: 2,
    blobErrors: 1
  });
  assert.match(response.headers.get("Server-Timing"), /^admin-snapshot;dur=\d+$/);
});

test("admin snapshot rejects a truncated branch tree", async () => {
  const fetch = async (url) => {
    if (url.includes("git/ref/heads/")) return Response.json({ object: { sha: "head" } });
    if (url.includes("git/commits/")) return Response.json({ tree: { sha: "tree" } });
    if (url.includes("git/trees/")) return Response.json({ tree: [], truncated: true });
    throw new Error(`Unexpected ${url}`);
  };
  const response = await snapshot.handleSnapshotRequest(
    { request: new Request("https://mysite.example/api/admin/snapshot"), env: {} },
    { readSession: async () => ({ token: "secret" }), fetch, console: { warn() {}, error() {} } }
  );
  assert.equal(response.status, 502);
});

test("snapshot helper bounds concurrent work and preserves result order", async () => {
  let active = 0;
  let maximum = 0;
  const results = await snapshot.mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
});
