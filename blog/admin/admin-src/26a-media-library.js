import { collections } from "./01-bootstrap.js";
import { state } from "./01c-state.js";
import { loadChanges } from "./04a-draft-writes.js";
import { fetchTree, hasGithubAccess } from "./05-github-auth.js";
import { buildEntryLookup, isGpxPath, isMediaLibraryPath, isRepositoryMediaPath, isVideoPath, mediaDateSortValue, publicMediaPath } from "./06-paths.js";
import { mediaReferencesForItem, refreshMediaReferenceIndex } from "./15a-media-reference-index.js";
import { buildMediaItem, loadMediaManifest, manifestMediaItems, mediaFingerprint } from "./26a1-media-manifest.js";
import { renderMedia } from "./26b-media-render.js";
import { refreshRenderedMediaMetadata } from "./26d-media-metadata.js";

export async function refreshMedia(force) {
  if (!hasGithubAccess()) {
    const changes = await loadChanges();
    state.media = queuedMediaItems(changes, new Set()).sort(collections.media.sort);
    renderMedia();
    attachMediaReferences(null, changes);
    return;
  }
  const tree = await fetchTree(force);
  state.entryLookup = buildEntryLookup(tree.tree || []);
  const manifest = await loadMediaManifest(force);
  const changes = await loadChanges();
  const deleted = new Set(changes.filter((change) => change.kind === "delete").map((change) => change.path));
  const pendingByPath = new Map(changes.filter((change) => change.collection === "media").map((change) => [change.path, change]));

  // Manifest first, tree second: a path that still has a blob (legacy media, or an upload
  // GitHub has not normalized into R2 yet) must keep its blob sha, because that is what its
  // deletion stages.
  const published = new Map();
  manifestMediaItems(manifest, pendingByPath).forEach((item) => published.set(item.path, item));
  treeMediaItems(tree, deleted, pendingByPath).forEach((item) => published.set(item.path, item));
  const media = [...published.values(), ...queuedMediaItems(changes, new Set(published.keys()))];

  const fingerprints = countValues(media.map(mediaFingerprint).filter(Boolean));
  state.media = media
    .map((item) => ({ ...item, duplicate: fingerprints.get(mediaFingerprint(item)) > 1 }))
    .sort(collections.media.sort);
  renderMedia();
  attachMediaReferences(tree, changes);
}

function treeMediaItems(tree, deleted, pendingByPath) {
  return (tree.tree || [])
    .filter((item) => item.type === "blob")
    .filter((item) => isRepositoryMediaPath(item.path) && isMediaLibraryPath(item.path))
    .filter((item) => !deleted.has(item.path))
    .map((item) => buildMediaItem(item.path, {
      size: item.size || 0,
      sha: item.sha,
      pending: pendingByPath.has(item.path),
      preview: pendingByPath.get(item.path)?.preview || ""
    }));
}

// Uploads that are still only in the queue: they have no manifest entry yet (normalization
// writes it) and, without GitHub access, no tree either.
function queuedMediaItems(changes, knownPaths) {
  return changes
    .filter((change) => (
      change.collection === "media" &&
      change.kind === "upsert" &&
      change.mediaKind !== "gpx" &&
      !isGpxPath(change.path) &&
      isMediaLibraryPath(change.path) &&
      !knownPaths.has(change.path)
    ))
    .map((change) => buildMediaItem(change.path, {
      publicPath: change.publicPath || publicMediaPath(change.path),
      mediaKind: change.mediaKind || (isVideoPath(change.path) ? "video" : "image"),
      size: change.size || 0,
      pending: true,
      preview: change.preview || "",
      uploadSort: Date.parse(change.updatedAt || "") || mediaDateSortValue(change.path)
    }));
}

// Reference info ("which post uses this image") needs the body of every post,
// which is dozens of GitHub round-trips. It is purely informational, so we
// build it in the background and patch it onto the already-rendered media
// instead of blocking the gallery or the social-image picker on it.
async function attachMediaReferences(tree, changes) {
  try {
    await refreshMediaReferenceIndex(tree, changes);
  } catch {
    return;
  }
  if (!state.media.length) return;
  state.media = state.media
    .map((item) => ({ ...item, references: mediaReferencesForItem(item) }))
    .sort(collections.media.sort);
  refreshRenderedMediaMetadata();
}

function countValues(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return counts;
}
