import { github } from "./01-bootstrap.js";
import { blobShaMap, fetchMainTree, getBlobText } from "./04-drafts.js";
import { commitToDrafts, loadChanges } from "./04a-draft-writes.js";
import { fetchTree } from "./05-github-auth.js";
import { baseName, isVideoPath } from "./06-paths.js";
import { mediaManifestKeyFor } from "./26a1-media-manifest.js";
import { adoptMediaManifestChange, buildMediaManifestChange } from "./26a2-media-manifest-writes.js";
import { parseVideoMetadata } from "./26c-media-cleanup.js";

export function videoPosterRepoPath(value) {
  const publicPath = String(value || "");
  if (!publicPath.startsWith("/assets/images/video-posters/")) return "";
  const repoPath = `blog/${publicPath.slice(1)}`;
  return repoPath.split("/").includes("..") ? "" : repoPath;
}

export async function commitMediaDiscardPlan(videoOperations, fileChanges, message) {
  const metadataPath = "blog/_data/videoMetadata.json";
  const draftTree = await fetchTree(true);
  const mainTree = await fetchMainTree(true);
  const draftsMap = blobShaMap(draftTree);
  const mainMap = blobShaMap(mainTree);
  const entries = new Map();
  const expectedBlobs = {};
  const manifestKeys = [];
  let draftMetadata = null;
  let mainMetadata = {};

  const onlyNewDraftVideos = videoOperations.length > 0 && videoOperations.every(({ item, existing }) => (
    existing?.kind === "upsert" && !mainMap.has(item.path)
  ));

  if (videoOperations.length) {
    const draftMetadataEntry = (draftTree?.tree || []).find((entry) => entry.path === metadataPath);
    const mainMetadataEntry = (mainTree?.tree || []).find((entry) => entry.path === metadataPath);
    if (!draftMetadataEntry?.sha && !onlyNewDraftVideos) {
      throw new Error("Video-Metadaten fehlen. Bitte die Medienverarbeitung reparieren, bevor das Video gelöscht wird.");
    }
    draftMetadata = draftMetadataEntry?.sha ? parseVideoMetadata(await getBlobText(draftMetadataEntry.sha), "Entwurfs-Video-Metadaten") : null;
    mainMetadata = mainMetadataEntry?.sha ? parseVideoMetadata(await getBlobText(mainMetadataEntry.sha), "veröffentlichte Video-Metadaten") : {};
  }

  const addEntry = (path, sha) => {
    entries.set(path, { path, mode: "100644", type: "blob", sha });
    expectedBlobs[path] = draftsMap.get(path) || null;
  };

  for (const { item, existing } of videoOperations) {
    const discardPendingUpload = existing?.kind === "upsert";
    const draftVideoMetadata = draftMetadata?.[item.publicPath] || null;
    const mainVideoMetadata = mainMetadata[item.publicPath] || null;
    const draftPosterPath = videoPosterRepoPath(draftVideoMetadata?.poster);
    const mainPosterPath = videoPosterRepoPath(mainVideoMetadata?.poster);
    const draftHasVideo = draftsMap.has(item.path);
    const requiredPosterPath = draftHasVideo ? draftPosterPath : mainPosterPath;

    // Only the poster *path* can be verified here. The bytes live in R2 since DB-1129 and are
    // no longer blobs in either tree, so demanding one made every deletion fail.
    const incompleteNewUpload = discardPendingUpload && !mainMap.has(item.path);
    if (!requiredPosterPath && !incompleteNewUpload) {
      throw new Error(`Die Video-Metadaten für ${item.name || baseName(item.path)} enthalten kein gültiges Vorschaubild. Bitte die Medienverarbeitung reparieren.`);
    }

    if (draftMetadata) {
      if (discardPendingUpload && mainVideoMetadata) draftMetadata[item.publicPath] = mainVideoMetadata;
      else delete draftMetadata[item.publicPath];
    }

    const targetSha = (path) => discardPendingUpload ? (mainMap.get(path) || null) : null;
    // Same reasoning as the posters below: a video that only exists in R2 has no blob to
    // stage. Its record is the manifest entry, removed further down in this same commit.
    if (draftsMap.has(item.path) || mainMap.has(item.path)) addEntry(item.path, targetSha(item.path));
    else manifestKeys.push(mediaManifestKeyFor(item.path));
    for (const posterPath of new Set([draftPosterPath, mainPosterPath].filter(Boolean))) {
      // A poster that is not tracked in either tree lives only in R2 — there is no blob to
      // remove or restore, and staging one would ask the tree API to delete a path that does
      // not exist. Legacy posters that are still committed keep their exact handling.
      if (!draftsMap.has(posterPath) && !mainMap.has(posterPath)) continue;
      // Bis hierher kommt nur ein noch getracktes Alt-Poster. Der frühere Schutz gegen das
      // Entfernen eines von zwei Videos geteilten Posters ist entfallen: er konnte nur
      // greifen, solange Poster als Blobs im Baum liegen, und seit der R2-Migration liegt
      // dort keines mehr (null Dateien unter blog/assets/images/video-posters auf main und
      // drafts) und es entsteht auch keines mehr — der Build erzeugt Poster und
      // publish-build-media.js lädt sie nach R2. Ein Schutz, der nur noch für einen Zustand
      // gilt, den nichts mehr herstellt, verdeckt mehr als er sichert.
      addEntry(posterPath, targetSha(posterPath));
    }
  }

  for (const change of fileChanges) {
    // Same split as the videos above: an upload that already reached R2 has no blob to
    // restore or remove, only its record and manifest entry.
    if (change.recordPath || (!draftsMap.has(change.path) && !mainMap.has(change.path))) {
      manifestKeys.push(mediaManifestKeyFor(change.path));
      continue;
    }
    addEntry(change.path, mainMap.get(change.path) || null);
  }

  if (draftMetadata) {
    const metadataBlob = await github("git/blobs", {
      method: "POST",
      body: { content: `${JSON.stringify(draftMetadata, null, 2)}\n`, encoding: "utf-8" }
    });
    if (!metadataBlob?.sha) throw new Error("Video-Metadaten konnten nicht aktualisiert werden.");
    addEntry(metadataPath, metadataBlob.sha);
  }

  // One key can produce two entries — the rewritten manifest and a not-yet-folded upload
  // record — and both belong in this same commit as the metadata.
  const manifestChange = manifestKeys.length ? await buildMediaManifestChange(manifestKeys) : null;
  manifestChange?.entries.forEach((entry) => addEntry(entry.path, entry.sha));

  await commitToDrafts(Array.from(entries.values()), message, expectedBlobs);
  if (manifestChange) adoptMediaManifestChange(manifestChange);
  await loadChanges();
}

export async function queueVideoDelete(item, existing) {
  await commitMediaDiscardPlan(
    [{ item, existing }],
    [],
    `${existing?.kind === "upsert" ? "Discard" : "Delete"} ${item.path} with video derivatives`
  );
}

export async function discardUnusedMediaChanges(changes) {
  const videoOperations = changes
    .filter((change) => isVideoPath(change.path))
    .map((item) => ({ item, existing: { kind: "upsert" } }));
  const fileChanges = changes.filter((change) => !isVideoPath(change.path));
  await commitMediaDiscardPlan(
    videoOperations,
    fileChanges,
    `Discard ${changes.length} unused upload${changes.length === 1 ? "" : "s"}`
  );
}

export async function discardTechnicalPosterChanges(changes) {
  await commitMediaDiscardPlan(
    [],
    changes,
    `Discard ${changes.length} technical video poster repair${changes.length === 1 ? "" : "s"}`
  );
}
