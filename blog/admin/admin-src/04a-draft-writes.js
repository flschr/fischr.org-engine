import { renameOriginsPath } from "./00-konstanten.js";
import { draftRepository, github } from "./01-bootstrap.js";
import { preparePrunedRenameOriginsChange } from "./01a-rename-origins.js";
import { state } from "./01c-state.js";
import { blobNotiz, blobShaMap, blobTextCache, cacheBlobText, classifyChanges, diffChange, fetchMainTree, getAllChanges, getBlobText, isManagedPath } from "./04-drafts.js";
import { fetchTree, hasGithubAccess } from "./05-github-auth.js";
import { refreshMediaReferenceIndex } from "./15a-media-reference-index.js";
import { renderSyncState } from "./26d-publish-sync.js";

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
  // blobNotiz(), not a hand-rolled { content, title } — a manual copy here once left out
  // `draft`, so istEntwurf() read every freshly saved post as published (undefined is falsy),
  // and a never-published draft showed up in the sync queue as ready to publish.
  cacheBlobText(result.blobSha, blobNotiz(change.content));
  await refreshChangedPaths(result.entries.map((entry) => entry.path)).catch(() => {});
  return result.commitSha;
}

export async function refreshChangedPaths(paths) {
  const changed = new Set(paths);
  if (!state.tree?.tree) await fetchTree(true);
  const mainMap = blobShaMap(await fetchMainTree(false));
  const draftMap = blobShaMap(state.tree);
  // Collected, not written to state.changes yet — classifyChanges() below needs to run to
  // completion first. Writing each change to state.changes as it's built (as an earlier version
  // of this function did) exposed a window where a concurrent read (a background publish-status
  // poll, a second overlapping save) could see an unclassified change and — via the `?? "medien"`
  // fallback in visibleQueueChanges() — treat it as effective before it actually was.
  const removedPaths = [];
  const updated = [];
  for (const path of changed) {
    if (!isManagedPath(path)) {
      removedPaths.push(path);
      continue;
    }
    const draftSha = draftMap.get(path);
    const mainSha = mainMap.get(path);
    if (draftSha === mainSha) {
      removedPaths.push(path);
      continue;
    }
    const change = diffChange(path, draftSha ? "upsert" : "delete", draftSha || mainSha, Boolean(draftSha && !mainSha));
    if (change.type === "text" && change.kind === "upsert") {
      change.content = await getBlobText(change.sha);
      change.label = blobTextCache.get(change.sha)?.title || change.label;
    }
    updated.push(change);
  }
  if (updated.length) {
    try {
      await classifyChanges(updated, mainMap);
    } catch (error) {
      // A page whose published-branch blob isn't cached yet needs a real GitHub fetch to
      // classify (loadPublishedPostsIndex only covers posts) — if that fetch fails, still show
      // the save: an unclassified change is what this function always risked showing before it
      // classified anything at all, not a new, worse failure than swallowing the whole refresh.
    }
  }
  removedPaths.forEach((path) => state.changes.delete(path));
  updated.forEach((change) => state.changes.set(change.path, change));
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
