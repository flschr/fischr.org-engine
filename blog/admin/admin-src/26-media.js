import { maxVideoUploadBytes } from "./00-konstanten.js";
import { t, tn } from "./00a-i18n.js";
import { collections, draftRepository, gpxUploadService, mediaService } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { commitToDrafts, loadChanges, putChange } from "./04a-draft-writes.js";
import { requireGithubAccess } from "./05-github-auth.js";
import { baseName, extension, fileName, isMediaPath, isVideoPath, publicMediaPath } from "./06-paths.js";
import { slugify, todayPrefix, uploadStamp } from "./08-encoding.js";
import { insertGpxMarkdown, insertMediaMarkdown } from "./17-editor.js";
import { docKeyFor, writeAutosave } from "./19-recovery.js";
import { startMediaJobs } from "./26c-media-jobs.js";
import { formatBytes } from "./26d-media-metadata.js";
import { waitForMediaCommits } from "./26e-media-recovery-state.js";

// --- Media ---------------------------------------------------------------

function isVideoFile(file) {
  return Boolean(file) && ((file.type || "").startsWith("video/") || isVideoPath(file.name || ""));
}

function isUploadableMediaFile(file) {
  return Boolean(file) && (
    (file.type || "").startsWith("image/") ||
    (file.type || "").startsWith("video/") ||
    isMediaPath(file.name || "")
  );
}

function videoUploadLimitMessage(files = []) {
  if (files.length === 1) {
    const file = files[0];
    return t("media.videoTooLarge", { name: file.name || t("media.selectedVideo"), size: formatBytes(file.size), max: formatBytes(maxVideoUploadBytes) });
  }
  return t("media.videosSkippedOverLimit", { count: files.length, max: formatBytes(maxVideoUploadBytes) });
}

function pendingFileChange(file) {
  const isVideo = isVideoFile(file);
  const ext = extension(file.name) || (isVideo ? "webm" : "jpg");
  const unique = Math.random().toString(36).slice(2, 6);
  const name = `${todayPrefix()}-${uploadStamp()}-${slugify(baseName(file.name))}-${unique}.${ext}`;
  const path = `${isVideo ? collections.media.videoDir : collections.media.dir}/uploads/${name}`;
  return {
    path,
    kind: "upsert",
    type: "binary",
    encoding: "base64",
    collection: "media",
    label: file.name,
    content: "",
    preview: "",
    publicPath: publicMediaPath(path),
    mediaKind: isVideo ? "video" : "image",
    size: file.size,
    updatedAt: new Date().toISOString(),
    summary: "Upload"
  };
}

export async function fileToChange(file, pending = pendingFileChange(file)) {
  const dataUrl = await readFileAsDataUrl(file);
  return {
    ...pending,
    content: dataUrl.split(",")[1] || "",
    preview: dataUrl
  };
}

export function needsGithubImageNormalization(change) {
  return change?.mediaKind === "image" && !["gif", "svg", "webp"].includes(extension(change.path));
}

export function preparedMediaChange(change) {
  if (change?.mediaKind !== "image" || ["gif", "svg"].includes(extension(change.path))) return change;
  const path = change.path.replace(/\.[^.\/]+$/, ".webp");
  return { ...change, path, publicPath: publicMediaPath(path) };
}

export async function normalizeUploadedImage(change, draftSha, force = false) {
  const isProcessableImage = change?.mediaKind === "image" && !["gif", "svg"].includes(extension(change.path));
  if (!isProcessableImage || (!force && !needsGithubImageNormalization(change))) return change;
  const targetPath = change.path.replace(/\.[^.\/]+$/, ".webp");
  // Two distinct messages, because the two paths differ by a factor of ~20 in waiting time
  // and the writer should be able to tell from the status bar alone which one is running.
  showStatus(`Bild wird verarbeitet: ${change.label} …`);
  const normalized = await mediaService.normalizeImage(draftSha, change.path, targetPath, {
    onFallback: () => showStatus(`GitHub verarbeitet ${change.label} … (langsamer Rückfallweg)`)
  });
  // The endpoint deliberately does not write to Git — it hands back the upload record and
  // the raw upload's removal is ours to commit, through the same compare-and-swap path
  // every other draft write uses. The workflow path already committed both itself.
  if (normalized?.via === "endpoint" && normalized.status === "normalized") {
    await commitNormalizedUpload(normalized, change, targetPath);
  }
  state.tree = null;
  state.changeCache = null;
  await loadChanges();
  return {
    ...change,
    path: targetPath,
    publicPath: publicMediaPath(targetPath),
    content: "",
    encoding: "",
    preview: change.preview
  };
}

// One commit, same shape the normalize workflow produces: add the upload record, drop the
// raw upload. Both in a single compare-and-swap commit so a concurrent draft save is
// rejected and retried rather than lost, and so drafts is never left holding a raw upload
// whose record has already been written.
// The raw upload's blob is pinned: on a ref race draftRepository.commit() retries against
// the newest drafts tree, and an unpinned delete would drop whatever sits at that path by
// then — a replacement upload included — while recording the R2 bytes of the older one.
// scripts/admin-normalize-image.js guards the same invariant ("refusing to process
// different bytes"); a mismatch has to surface as a draft conflict, not a silent loss.
async function commitNormalizedUpload(normalized, change, targetPath) {
  const blob = await draftRepository.createBlob(`${JSON.stringify(normalized.record, null, 2)}\n`);
  await commitToDrafts([
    { path: normalized.recordPath, mode: "100644", type: "blob", sha: blob.sha },
    { path: change.path, mode: "100644", type: "blob", sha: null }
  ], `Normalize admin upload ${fileName(targetPath)} [skip ci]`,
  // Only guard when the upload's blob sha is known. Passing a falsy sha would assert the
  // path is *absent* and turn every normal run into a conflict.
  change.sha ? { [change.path]: change.sha } : null);
}

export async function prepareUploadedVideo(change, draftSha) {
  if (change?.mediaKind !== "video") return change;
  showStatus(`GitHub erstellt Videometadaten für ${change.label} …`);
  await mediaService.prepareVideo(draftSha, change.path);
  state.tree = null;
  state.changeCache = null;
  await loadChanges();
  return change;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function queueUploads(files, insertIntoEditor) {
  const mediaFiles = Array.from(files || []).filter(isUploadableMediaFile);
  const rejectedVideos = mediaFiles.filter((file) => isVideoFile(file) && file.size > maxVideoUploadBytes);
  const selected = mediaFiles.filter((file) => !(isVideoFile(file) && file.size > maxVideoUploadBytes));
  if (rejectedVideos.length && !selected.length) {
    showStatus(videoUploadLimitMessage(rejectedVideos), "error");
    return;
  }
  if (!selected.length) return;
  if (!requireGithubAccess(t("action.uploadingMedia"))) {
    els.imageUploadInput.value = "";
    els.mediaUploadInput.value = "";
    return;
  }

  try {
    const docKey = docKeyFor(state.current);
    const pending = selected.map((file) => {
      const change = pendingFileChange(file);
      return { file, change, trackingPath: change.path, docKey, committed: false };
    });

    // Insert the permanent target path immediately. Uploading, committing and
    // GitHub-side conversion continue independently, so the writer can keep
    // typing instead of staring at a locked editor for the whole workflow.
    if (insertIntoEditor && state.current && ["posts", "pages"].includes(state.current.collection)) {
      pending.forEach(({ change }) => insertMediaMarkdown(preparedMediaChange(change)));
    }
    pending.forEach((item) => {
      state.pendingMediaUploads.set(item.change.path, item);
      state.mediaUploadItems.set(item.change.path, item);
    });
    writeAutosave();
    const skipped = rejectedVideos.length ? tn("media.videosSkipped", rejectedVideos.length) : "";
    const processing = tn("media.uploadsProcessing", selected.length);
    showStatus(`${processing}${skipped}`, rejectedVideos.length ? "error" : undefined);

    startMediaJobs(pending);
  } catch (error) {
    showStatus(t("media.uploadFailed", { error: error.message }), "error");
  } finally {
    els.imageUploadInput.value = "";
    els.mediaUploadInput.value = "";
  }
}

export async function queueGpxUpload(files) {
  const file = Array.from(files || [])[0];
  if (!requireGithubAccess(t("action.uploadingGpxTour"))) {
    els.gpxUploadInput.value = "";
    return;
  }

  setBusy(true);
  try {
    await waitForMediaCommits();
    const change = await gpxUploadService.prepare(file);
    await putChange(change);
    insertGpxMarkdown(change.publicPath);
    showStatus("GPX hochgeladen und Markdown eingefügt.");
  } catch (error) {
    showStatus(`GPX-Upload fehlgeschlagen: ${error.message}`, "error");
  } finally {
    setBusy(false);
    els.gpxUploadInput.value = "";
  }
}
