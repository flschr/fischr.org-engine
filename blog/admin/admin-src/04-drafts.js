import { repo } from "./00-konstanten.js";
import { splitDocument } from "./09-frontmatter.js";
import { collections, draftRepository, github } from "./01-bootstrap.js";
import { state } from "./01c-state.js";
import { fetchTree, hasGithubAccess, sessionHasGithubAccess } from "./05-github-auth.js";
import { baseName, isEntryPath, isGpxPath, isMediaPath, isSourcePagePath, isVideoPath, publicMediaPath } from "./06-paths.js";
import { decodeBase64 } from "./08-encoding.js";
import { pendingUploadChanges } from "./26a1-media-manifest.js";
import { loadPublishedPostsIndex } from "./25e-posts-index.js";
import { beschrifteAktionen } from "./04c-queue-actions.js";

// --- Working branch ("drafts") as the cross-device outbox ----------------
// Saves commit straight to the `drafts` branch; the queue is the diff against
// the published `main` branch; publishing dispatches the admin-publish workflow,
// which validates the reviewed media and deploys one final main commit.

// Blob content cached by sha (a blob's content is immutable for its sha), so
// the diff enrichment, tag index, and reference index each fetch any given
// post only once — a save changes only one blob, not all 400+, which keeps
// us far under the GitHub API rate limit.
const BLOB_TEXT_CACHE_LIMIT = 500;
const ADMIN_SNAPSHOT_TIMEOUT_MS = 8000;
export const blobTextCache = new Map();

export function cacheBlobText(sha, value) {
  if (!sha) return;
  blobTextCache.delete(sha);
  blobTextCache.set(sha, value);
  while (blobTextCache.size > BLOB_TEXT_CACHE_LIMIT) {
    blobTextCache.delete(blobTextCache.keys().next().value);
  }
}

export async function getBlobText(sha) {
  if (!sha) return "";
  const cached = blobTextCache.get(sha);
  if (cached) {
    cacheBlobText(sha, cached);
    return cached.content;
  }
  const payload = await github(`git/blobs/${sha}`);
  const content = payload?.encoding === "base64" ? decodeBase64(payload.content || "") : String(payload?.content || "");
  cacheBlobText(sha, blobNotiz(content));
  return content;
}

// Was an einem Blob wiederholt gebraucht wird. Der Entwurfszustand steht hier, weil er so
// unveränderlich ist wie der Inhalt zu seiner sha — und weil ihn sonst jede Zeile der
// Warteschlange neu aus dem Frontmatter lesen müsste.
function blobNotiz(content) {
  const fields = splitDocument(content).fields || {};
  return { content, title: String(fields.title || "").trim(), draft: Boolean(fields.draft) };
}

async function istEntwurf(sha) {
  if (!sha) return false;
  const zwischengespeichert = blobTextCache.get(sha);
  if (zwischengespeichert) return Boolean(zwischengespeichert.draft);
  await getBlobText(sha);
  return Boolean(blobTextCache.get(sha)?.draft);
}

export function ensureDraftsBranch() {
  return draftRepository.ensureBranch();
}

export async function fetchBranchTree(branch, treeKey, headKey, force) {
  if (!force && state.startupSnapshotActive && state[treeKey]) return state[treeKey];
  const ref = await github(`git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref?.object?.sha || "";
  if (!force && state[treeKey]) {
    if (state[headKey] === headSha) return state[treeKey];
    if (treeKey === "tree" && state.treeParentHeadSha && state.treeParentHeadSha === headSha) {
      return state[treeKey];
    }
  }

  const commit = await github(`git/commits/${headSha}`);
  state[treeKey] = await github(`git/trees/${commit.tree.sha}?recursive=1`);
  state[headKey] = headSha;
  if (treeKey === "tree") state.treeParentHeadSha = "";
  return state[treeKey];
}

export async function fetchMainTree(force) {
  return fetchBranchTree(repo.publishBranch, "mainTree", "mainTreeHeadSha", force);
}

export function blobShaMap(tree) {
  return new Map((tree?.tree || []).filter((item) => item.type === "blob").map((item) => [item.path, item.sha]));
}

export async function loadAdminSnapshot() {
  if (!sessionHasGithubAccess()) return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ADMIN_SNAPSHOT_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("/api/admin/snapshot", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Admin-Snapshot ${response.status}`);
  const snapshot = await response.json();
  if (!snapshot?.drafts?.tree || !snapshot?.main?.tree) throw new Error("Admin-Snapshot ist unvollständig.");
  state.tree = snapshot.drafts.tree;
  state.treeHeadSha = snapshot.drafts.headSha || "";
  state.treeParentHeadSha = "";
  state.mainTree = snapshot.main.tree;
  state.mainTreeHeadSha = snapshot.main.headSha || "";
  Object.entries(snapshot.blobs || {}).forEach(([sha, blob]) => {
    const content = blob.encoding === "base64" ? decodeBase64(blob.content || "") : String(blob.content || "");
    cacheBlobText(sha, blobNotiz(content));
  });
  state.changeCache = null;
  state.startupSnapshotActive = true;
  return true;
}

export function isManagedPath(path) {
  const isEntry = isEntryPath(path);
  const isMedia = (path.startsWith(`${collections.media.dir}/`) || path.startsWith(`${collections.media.videoDir}/`)) && isMediaPath(path);
  const isGpx = path.startsWith(`${collections.media.gpxDir}/`) && isGpxPath(path);
  return isEntry || isMedia || isGpx;
}

function collectionForPath(path) {
  if (isSourcePagePath(path)) return "pages";
  if (path.startsWith(`${collections.posts.dir}/`)) return "posts";
  if (path.startsWith(`${collections.pages.dir}/`)) return "pages";
  return "media";
}

export function diffChange(path, kind, sha, isNew) {
  const collection = collectionForPath(path);
  const isMedia = collection === "media";
  return {
    path,
    kind,
    collection,
    sha,
    isNew,
    type: isMedia ? "binary" : "text",
    mediaKind: isMedia ? (isGpxPath(path) ? "gpx" : (isVideoPath(path) ? "video" : "image")) : undefined,
    publicPath: isMedia ? publicMediaPath(path) : undefined,
    label: baseName(path).replace(/^\d{4}-\d{2}-\d{2}-/, "")
  };
}

// The pending change set = the diff between the drafts and main trees.
export async function getAllChanges() {
  if (!hasGithubAccess()) return [];
  const [drafts, main] = await Promise.all([fetchTree(false), fetchMainTree(false)]);
  const cacheKey = `${drafts?.sha || ""}:${main?.sha || ""}`;
  if (state.changeCache?.key === cacheKey) return state.changeCache.changes;

  const mainMap = blobShaMap(main);
  const draftsMap = blobShaMap(drafts);
  const changes = [];
  for (const [path, sha] of draftsMap) {
    if (!isManagedPath(path) || mainMap.get(path) === sha) continue;
    changes.push(diffChange(path, "upsert", sha, !mainMap.has(path)));
  }
  for (const [path, sha] of mainMap) {
    if (!isManagedPath(path) || draftsMap.has(path)) continue;
    changes.push(diffChange(path, "delete", sha, false));
  }
  changes.push(...await pendingUploadChanges(draftsMap, mainMap));

  // Pending posts/pages aren't in the published index, so pull their real
  // title/date/draft straight from the drafts blob (few files, then cached).
  await Promise.all(changes
    .filter((change) => change.type === "text" && change.kind === "upsert")
    .map(async (change) => {
      change.content = await getBlobText(change.sha);
      const title = blobTextCache.get(change.sha)?.title;
      if (title) change.label = title;
    }));

  await beschrifteAktionen(changes, mainMap, { index: await loadPublishedPostsIndex(), istEntwurf });

  changes.sort((a, b) => a.path.localeCompare(b.path));
  state.changeCache = { key: cacheKey, changes };
  return changes;
}

export async function getChange(path) {
  return (await getAllChanges()).find((change) => change.path === path) || null;
}

// Commit raw tree entries onto drafts, retrying if the head moved meanwhile
// (another device) — last write wins per file.
// Compare-and-swap commit of a tree onto a branch, retrying if the head moved
// meanwhile (another device). Returns the new commit sha; throws after 3 tries.
