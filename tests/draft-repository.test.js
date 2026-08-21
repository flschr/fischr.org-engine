const assert = require("node:assert/strict");
const test = require("node:test");
const { create, reconcileTree, reconcileTreeBestEffort } = require("../blog/admin/draft-repository.js");

test("renaming a draft writes the new blob and removes the old path atomically", async () => {
  const calls = [];
  const github = async (endpoint, options = {}) => {
    calls.push({ endpoint, options });
    if (endpoint === "git/ref/heads/drafts" && !options.method) return { object: { sha: "parent" } };
    if (endpoint === "git/commits/parent") return { tree: { sha: "base-tree" } };
    if (endpoint === "git/blobs") return { sha: "new-blob" };
    if (endpoint === "git/trees") return { sha: "new-tree" };
    if (endpoint === "git/commits") return { sha: "new-commit" };
    if (endpoint === "git/refs/heads/drafts") return {};
    throw new Error(`Unexpected ${endpoint}`);
  };

  const repository = create({ github });
  const result = await repository.save({
    path: "blog/posts/new.md",
    previousPath: "blog/posts/old.md",
    content: "content",
    additionalEntries: [{ path: "automation/admin-rename-origins.json", mode: "100644", type: "blob", sha: "rename-blob" }]
  });

  assert.equal(result.commitSha, "new-commit");
  const treeRequest = calls.find((call) => call.endpoint === "git/trees");
  assert.deepEqual(treeRequest.options.body.tree, [
    { path: "blog/posts/new.md", mode: "100644", type: "blob", sha: "new-blob" },
    { path: "blog/posts/old.md", mode: "100644", type: "blob", sha: null },
    { path: "automation/admin-rename-origins.json", mode: "100644", type: "blob", sha: "rename-blob" }
  ]);
  assert.equal(calls.filter((call) => call.endpoint === "git/commits").length, 1);
});

test("a raced draft update retries from the latest branch head", async () => {
  let refReads = 0;
  let patches = 0;
  const github = async (endpoint, options = {}) => {
    if (endpoint === "git/ref/heads/drafts" && !options.method) return { object: { sha: `parent-${++refReads}` } };
    if (endpoint.startsWith("git/commits/parent-")) return { tree: { sha: "base-tree" } };
    if (endpoint === "git/trees") return { sha: `tree-${refReads}` };
    if (endpoint === "git/commits") return { sha: `commit-${refReads}` };
    if (endpoint === "git/refs/heads/drafts" && ++patches === 1) throw new Error("GitHub 422 raced");
    if (endpoint === "git/refs/heads/drafts") return {};
    throw new Error(`Unexpected ${endpoint}`);
  };

  const result = await create({ github }).commit([{ path: "a", mode: "100644", type: "blob", sha: null }], "Delete a");
  assert.equal(result.commitSha, "commit-3");
  assert.equal(patches, 2);
});

test("a rename refuses to delete a concurrently edited source", async () => {
  const github = async (endpoint) => {
    if (endpoint === "git/blobs") return { sha: "new-blob" };
    if (endpoint === "git/ref/heads/drafts") return { object: { sha: "latest" } };
    if (endpoint === "git/commits/latest") return { tree: { sha: "latest-tree" } };
    if (endpoint === "git/trees/latest-tree?recursive=1") {
      return { tree: [{ path: "blog/posts/old.md", type: "blob", sha: "concurrent-blob" }] };
    }
    throw new Error(`Unexpected ${endpoint}`);
  };

  await assert.rejects(
    create({ github }).save({
      path: "blog/posts/new.md",
      previousPath: "blog/posts/old.md",
      expectedBlobs: { "blog/posts/old.md": "opened-blob", "blog/posts/new.md": null },
      content: "mine"
    }),
    (error) => error.code === "DRAFT_CONFLICT"
  );
});

test("a normal save refuses to overwrite a concurrently edited file", async () => {
  const github = async (endpoint) => {
    if (endpoint === "git/blobs") return { sha: "my-blob" };
    if (endpoint === "git/ref/heads/drafts") return { object: { sha: "latest" } };
    if (endpoint === "git/commits/latest") return { tree: { sha: "latest-tree" } };
    if (endpoint === "git/trees/latest-tree?recursive=1") {
      return { tree: [{ path: "blog/posts/post.md", type: "blob", sha: "other-blob" }] };
    }
    throw new Error(`Unexpected ${endpoint}`);
  };
  await assert.rejects(
    create({ github }).save({
      path: "blog/posts/post.md",
      expectedBlobs: { "blog/posts/post.md": "opened-blob" },
      content: "mine"
    }),
    (error) => error.code === "DRAFT_CONFLICT"
  );
});

test("delete and discard commits refuse a changed target blob", async () => {
  const github = async (endpoint) => {
    if (endpoint === "git/ref/heads/drafts") return { object: { sha: "latest" } };
    if (endpoint === "git/commits/latest") return { tree: { sha: "latest-tree" } };
    if (endpoint === "git/trees/latest-tree?recursive=1") {
      return { tree: [{ path: "asset.webp", type: "blob", sha: "other-blob" }] };
    }
    throw new Error(`Unexpected ${endpoint}`);
  };
  await assert.rejects(
    create({ github }).commit(
      [{ path: "asset.webp", mode: "100644", type: "blob", sha: null }],
      "Delete asset",
      { expectedBlobs: { "asset.webp": "opened-blob" } }
    ),
    (error) => error.code === "DRAFT_CONFLICT"
  );
});

test("a raced commit reloads the committed tree instead of patching stale cache state", async () => {
  const loaded = { sha: "tree-new", tree: [
    { path: "mine.md", type: "blob", mode: "100644", sha: "mine" },
    { path: "other-device.md", type: "blob", mode: "100644", sha: "other" }
  ] };
  const result = await reconcileTree({
    currentTree: { sha: "old-tree", tree: [] },
    currentHeadSha: "opened-head",
    entries: [{ path: "mine.md", type: "blob", mode: "100644", sha: "mine" }],
    result: { treeSha: "tree-new", parentSha: "concurrent-head" },
    loadTree: async (sha) => {
      assert.equal(sha, "tree-new");
      return loaded;
    }
  });
  assert.equal(result, loaded);
  assert.equal(result.tree.some((entry) => entry.path === "other-device.md"), true);
});

test("a failed local reconciliation cannot turn a durable commit into a failed mutation", async () => {
  const result = await reconcileTreeBestEffort({
    currentTree: null,
    currentHeadSha: "old-head",
    entries: [],
    result: { treeSha: "committed-tree", parentSha: "new-head" },
    loadTree: async () => { throw new Error("temporary read failure"); }
  });
  assert.equal(result, null);
});

test("non-conflict ref failures are not retried", async () => {
  let patches = 0;
  const github = async (endpoint, options = {}) => {
    if (endpoint === "git/ref/heads/drafts" && !options.method) return { object: { sha: "parent" } };
    if (endpoint === "git/commits/parent") return { tree: { sha: "base" } };
    if (endpoint === "git/trees") return { sha: "tree" };
    if (endpoint === "git/commits") return { sha: "commit" };
    if (endpoint === "git/refs/heads/drafts") {
      patches += 1;
      throw new Error("GitHub 403 forbidden");
    }
    throw new Error(`Unexpected ${endpoint}`);
  };
  await assert.rejects(create({ github }).commit([], "test"), /403/);
  assert.equal(patches, 1);
});
