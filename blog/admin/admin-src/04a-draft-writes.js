import { renameOriginsPath } from "./00-konstanten.js";
import { draftRepository, github } from "./01-bootstrap.js";
import { preparePrunedRenameOriginsChange } from "./01a-rename-origins.js";
import { state } from "./01c-state.js";
import { blobShaMap, blobTextCache, cacheBlobText, diffChange, fetchMainTree, getAllChanges, getBlobText, isManagedPath } from "./04-drafts.js";
import { fetchTree, hasGithubAccess } from "./05-github-auth.js";
import { refreshMediaReferenceIndex } from "./15a-media-reference-index.js";
import { renderSyncState } from "./26d-publish-sync.js";
import { renderQueue } from "./27c-queue-render.js";

export async function commitToDrafts(treeEntries, message, expectedBlobs = null) {
  if (!state.tree?.tree) await fetchTree(false);
  const result = await draftRepository.commit(treeEntries, message, { expectedBlobs });
  await patchDraftTree(treeEntries, result);
  state.changeCache = null;
  return result.commitSha;
}

async function patchDraftTree(entries, result) {
  const tree = await window.RWDraftRepository.reconcileTreeBestEffort({
    currentTree: state.tree,
    currentHeadSha: state.treeHeadSha,
    entries,
    result,
    loadTree: (treeSha) => github(`git/trees/${treeSha}?recursive=1`)
  });
  if (!tree) {
    state.tree = null;
    state.treeHeadSha = "";
    state.treeParentHeadSha = "";
    return false;
  }
  state.tree = tree;
  state.treeHeadSha = result.commitSha;
  state.treeParentHeadSha = result.parentSha;
  return true;
}

// Save: write the file straight to drafts.
export async function putChange(change) {
  if (!hasGithubAccess()) throw new Error("GitHub-Verbindung fehlt.");
  if (!state.tree?.tree) await fetchTree(false);

  if (change.kind === "delete") {
    const draftSha = await commitToDrafts(
      [{ path: change.path, mode: "100644", type: "blob", sha: null }],
      `Delete ${change.path}`,
      { [change.path]: change.expectedSha || change.sha || null }
    );
    await refreshChangedPaths([change.path]).catch(() => {});
    return draftSha;
  }
  const result = await draftRepository.save({
    path: change.path,
    previousPath: change.previousPath,
    content: change.content,
    encoding: change.encoding,
    additionalEntries: change.additionalEntries || [],
    expectedBlobs: change.expectedBlobs || { [change.path]: change.sha || null },
    message: `Update ${change.path}`
  });
  await patchDraftTree(result.entries, result);
  state.changeCache = null;
  change.sha = result.blobSha;
  cacheBlobText(result.blobSha, { content: change.content, title: String(change.label || "").trim() });
  await refreshChangedPaths(result.entries.map((entry) => entry.path)).catch(() => {});
  return result.commitSha;
}

export async function refreshChangedPaths(paths) {
  const changed = new Set(paths);
  if (!state.tree?.tree) await fetchTree(true);
  const mainMap = blobShaMap(await fetchMainTree(false));
  const draftMap = blobShaMap(state.tree);
  for (const path of changed) {
    if (!isManagedPath(path)) {
      state.changes.delete(path);
      continue;
    }
    const draftSha = draftMap.get(path);
    const mainSha = mainMap.get(path);
    if (draftSha === mainSha) {
      state.changes.delete(path);
      continue;
    }
    const change = diffChange(path, draftSha ? "upsert" : "delete", draftSha || mainSha, Boolean(draftSha && !mainSha));
    if (change.type === "text" && change.kind === "upsert") {
      change.content = await getBlobText(change.sha);
      change.label = blobTextCache.get(change.sha)?.title || change.label;
    }
    state.changes.set(path, change);
  }
  const changes = Array.from(state.changes.values()).sort((a, b) => a.path.localeCompare(b.path));
  await refreshMediaReferenceIndex(null, changes);
  renderSyncState(changes);
  return changes;
}

// Discard a pending change: restore main's version on drafts (or drop it if new).
export async function deleteChange(path, expectedSha) {
  const mainSha = blobShaMap(await fetchMainTree(true)).get(path);
  const entry = mainSha
    ? { path, mode: "100644", type: "blob", sha: mainSha }
    : { path, mode: "100644", type: "blob", sha: null };
  const renameOrigin = await preparePrunedRenameOriginsChange([entry]);
  const entries = renameOrigin ? [entry, renameOrigin.entry] : [entry];
  const expectedBlobs = { [path]: expectedSha || null };
  if (renameOrigin) expectedBlobs[renameOriginsPath] = renameOrigin.expectedSha;
  await commitToDrafts(entries, `Discard ${path}`, expectedBlobs);
  if (renameOrigin) {
    state.renameOrigins = renameOrigin.origins;
    state.renameOriginsLoadedSha = renameOrigin.entry.sha || "";
  }
  await loadChanges();
}

export async function loadChanges() {
  const changes = await getAllChanges();
  state.changes = new Map(changes.map((change) => [change.path, change]));
  // Keep the media-reference index in sync with the queue so the orphan
  // markers in renderQueue reflect the pending posts, not a stale media view.
  await refreshMediaReferenceIndex(null, changes).catch(() => {});
  renderSyncState(changes);
  return changes;
}
