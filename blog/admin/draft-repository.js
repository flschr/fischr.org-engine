(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWDraftRepository = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function create({ github, branch = "drafts", publishBranch = "main", retries = 3 }) {
    let ready = null;

    function ensureBranch() {
      if (!ready) {
        ready = (async () => {
          try {
            await github(`git/ref/heads/${encodeURIComponent(branch)}`);
          } catch (error) {
            if (!/^GitHub 404\b/.test(String(error?.message || error))) throw error;
            const base = await github(`git/ref/heads/${encodeURIComponent(publishBranch)}`);
            await github("git/refs", {
              method: "POST",
              body: { ref: `refs/heads/${branch}`, sha: base.object.sha }
            });
          }
        })().catch((error) => {
          ready = null;
          throw error;
        });
      }
      return ready;
    }

    async function createBlob(content, encoding = "utf-8") {
      return github("git/blobs", {
        method: "POST",
        body: { content, encoding: encoding === "base64" ? "base64" : "utf-8" }
      });
    }

    // Compare-and-swap commit of a tree onto a branch, retrying if the head moved
    // meanwhile (another device). `branch` names the target: the working branch by
    // default, but the admin also writes single files straight onto the published
    // branch (the social configuration), and that path needs the same loop.
    async function commit(entries, message, { expectedBlobs = null, branch: target = branch } = {}) {
      // Only the working branch is created on demand; every other target must
      // already exist, and asking for it here would just hide a typo.
      if (target === branch) await ensureBranch();
      let lastError;
      for (let attempt = 0; attempt < retries; attempt += 1) {
        const ref = await github(`git/ref/heads/${encodeURIComponent(target)}`);
        const parentSha = ref.object.sha;
        const parent = await github(`git/commits/${parentSha}`);
        if (expectedBlobs) await assertExpectedBlobs(parent.tree.sha, expectedBlobs);
        const tree = await github("git/trees", {
          method: "POST",
          body: { base_tree: parent.tree.sha, tree: entries }
        });
        const next = await github("git/commits", {
          method: "POST",
          body: { message, tree: tree.sha, parents: [parentSha] }
        });
        try {
          await github(`git/refs/heads/${encodeURIComponent(target)}`, {
            method: "PATCH",
            body: { sha: next.sha, force: false }
          });
          return { commitSha: next.sha, treeSha: tree.sha, parentSha };
        } catch (error) {
          if (!isRefRace(error)) throw error;
          lastError = error;
        }
      }
      throw lastError || new Error("Entwurf konnte nicht gespeichert werden.");
    }

    async function assertExpectedBlobs(treeSha, expectedBlobs) {
      const tree = await github(`git/trees/${treeSha}?recursive=1`);
      const blobs = new Map((tree.tree || []).filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
      for (const [path, expectedSha] of Object.entries(expectedBlobs)) {
        if ((blobs.get(path) || null) === (expectedSha || null)) continue;
        const error = new Error(`Entwurfskonflikt bei ${path}. Bitte neu laden und die Änderungen prüfen.`);
        error.code = "DRAFT_CONFLICT";
        throw error;
      }
    }

    async function save({ path, content, encoding = "utf-8", previousPath = "", additionalEntries = [], expectedBlobs = null, message }) {
      const blob = await createBlob(content, encoding);
      const entries = [{ path, mode: "100644", type: "blob", sha: blob.sha }];
      if (previousPath && previousPath !== path) {
        entries.push({ path: previousPath, mode: "100644", type: "blob", sha: null });
      }
      entries.push(...additionalEntries);
      const result = await commit(entries, message || `Update ${path}`, { expectedBlobs });
      return { ...result, blobSha: blob.sha, entries };
    }

    return { branch, ensureBranch, createBlob, commit, save };
  }

  function isRefRace(error) {
    return /(?:GitHub\s+)?(?:409|422)\b/.test(String(error?.message || error));
  }

  async function reconcileTree({ currentTree, currentHeadSha, entries, result, loadTree }) {
    if (!currentTree?.tree || result.parentSha !== currentHeadSha) return loadTree(result.treeSha);
    const byPath = new Map(currentTree.tree.map((item) => [item.path, item]));
    entries.forEach((entry) => {
      if (entry.sha === null) byPath.delete(entry.path);
      else byPath.set(entry.path, { path: entry.path, mode: entry.mode, type: entry.type, sha: entry.sha });
    });
    return { ...currentTree, sha: result.treeSha, tree: Array.from(byPath.values()) };
  }

  async function reconcileTreeBestEffort(options) {
    try {
      return await reconcileTree(options);
    } catch {
      return null;
    }
  }

  return { create, isRefRace, reconcileTree, reconcileTreeBestEffort };
});
