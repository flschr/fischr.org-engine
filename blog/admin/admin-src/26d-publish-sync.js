import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { renderPublishOverlay } from "./27f-publish-overlay.js";
import { showStatus } from "./03-status.js";
import { fetchMainTree, getBlobText } from "./04-drafts.js";
import { loadChanges } from "./04a-draft-writes.js";
import { fetchTree, hasGithubAccess } from "./05-github-auth.js";
import { isVideoPosterPath, publicMediaPath } from "./06-paths.js";
import { needsGithubImageNormalization, normalizeUploadedImage, prepareUploadedVideo } from "./26-media.js";
import { refreshMedia } from "./26a-media-library.js";
import { renderMedia } from "./26b-media-render.js";
import { parseVideoMetadata } from "./26c-media-cleanup.js";
import { videoPosterRepoPath } from "./26c-video-derivatives.js";
import { updateMediaProcessingState } from "./26e-media-recovery-state.js";
import { refreshCurrentSilent } from "./27a-publish-state.js";
import { renderQueue } from "./27c-queue-render.js";

// --- Sync ----------------------------------------------------------------

function publishElapsedLabel() {
  const startedAt = Date.parse(state.publishRequest?.startedAt || "");
  if (!Number.isFinite(startedAt)) return "";
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds} min`;
}

export function publishProgressMeta() {
  const status = state.publishStatus || {};
  const phase = status.phaseIndex != null && status.phaseCount
    ? `Schritt ${status.phaseIndex} von ${status.phaseCount}`
    : "";
  return [phase, publishElapsedLabel()].filter(Boolean).join(" · ");
}

function formatPublishDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "";
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min`;
}

export function publishTimingLabel() {
  const timings = state.publishStatus?.timings || {};
  return [
    ["Warten", timings.waitingMs],
    ["Vorbereitung", timings.preparationMs],
    ["Prüfung", timings.validationMs],
    ["Deployment", timings.deploymentMs]
  ].filter(([, value]) => Number.isFinite(value)).map(([label, value]) => `${label} ${formatPublishDuration(value)}`).join(" · ");
}

export function visibleQueueChanges(changes) {
  const allChanges = changes || Array.from(state.changes.values());
  const visibleChanges = allChanges.filter((change) => !isVideoPosterPath(change.path));
  if (visibleChanges.length || !allChanges.length) return visibleChanges;
  return [{
    path: "technical-video-poster-repair",
    kind: "technical-repair",
    collection: "media",
    label: "Technische Video-Reparatur",
    technicalPosterChanges: allChanges
  }];
}

export function renderSyncState(changes) {
  const count = visibleQueueChanges(changes).length;
  const countEl = els.syncButton.querySelector(".sync-count");
  const labelEl = els.syncButton.querySelector(".sync-label");
  if (countEl) countEl.textContent = String(count);
  if (labelEl) labelEl.textContent = state.publishInFlight
    ? (state.publishStatus?.message || "Wird veröffentlicht …")
    : "Veröffentlichen";
  els.syncButton.setAttribute("aria-label", state.publishInFlight
    ? "Änderungen werden veröffentlicht"
    : (count === 1 ? "1 Änderung veröffentlichen" : `${count} Änderungen veröffentlichen`));
  els.syncButton.classList.toggle("has-changes", count > 0);
  els.syncButton.classList.toggle("is-publishing", state.publishInFlight);
  // Der Knopf startet nichts, er führt nur in die Warteschlange — und die ist der einzige Ort,
  // der einen laufenden Vorgang zeigt. Deshalb bleibt er immer klickbar; gesperrt bleibt allein,
  // was schreibt: #pushButton und die Verwerfen-Aktionen in der Warteschlange selbst.
  els.syncButton.disabled = false;
  renderPublishOverlay();
  if (state.view === "queue") renderQueue();
}

function hasPendingMediaProcessing(changes = []) {
  return changes.some((change) => needsGithubImageNormalization(change));
}

export function hasActiveMediaWork() {
  return state.mediaProcessing;
}

async function videoNeedsPreparation(change) {
  if (change?.mediaKind !== "video" || change.kind !== "upsert") return false;
  const metadataEntry = (state.tree?.tree || []).find((item) => item.path === "blog/_data/videoMetadata.json");
  if (!metadataEntry?.sha) return true;
  try {
    const metadata = parseVideoMetadata(await getBlobText(metadataEntry.sha), "Video-Metadaten");
    const item = metadata[publicMediaPath(change.path)];
    // Poster bytes never become blobs on `drafts` since media moved to R2 (DB-1129): the
    // build renders them and publish-build-media.js uploads them after the deploy. Requiring
    // one in the tree left every video permanently "unprepared", which blocked publishing
    // and re-dispatched the preparation workflow on every admin load. What
    // admin-prepare-video.js actually produces — a metadata entry naming a valid poster — is
    // the completion signal.
    return !item?.sourceHash || !videoPosterRepoPath(item?.poster);
  } catch {
    return true;
  }
}

async function hasUnfinishedMediaProcessing(changes = []) {
  if (hasActiveMediaWork() || hasPendingMediaProcessing(changes)) return true;
  for (const change of changes) {
    if (await videoNeedsPreparation(change)) return true;
  }
  return false;
}

export function guardMediaIdle(action = "Diese Aktion") {
  if (!hasActiveMediaWork()) return true;
  showStatus(`${action} wartet, bis GitHub alle Medien verarbeitet hat.`, "error");
  return false;
}

export async function guardMediaReadyForPublish(changes) {
  if (!await hasUnfinishedMediaProcessing(changes)) return true;
  showStatus("Die Veröffentlichung wartet, bis GitHub alle Medien verarbeitet hat.", "error");
  return false;
}

export async function loadFreshChanges() {
  await Promise.all([fetchTree(true), fetchMainTree(true)]);
  state.changeCache = null;
  return loadChanges();
}

export function changeSetSignature(changes = []) {
  return changes
    .map((change) => `${change.kind}:${change.path}:${change.sha || ""}`)
    .sort()
    .join("|");
}

export function recoverPendingMediaOperations() {
  if (state.mediaRecoveryPromise) return state.mediaRecoveryPromise;
  const recovery = (async () => {
    state.mediaRecoveryJobs += 1;
    updateMediaProcessingState();
    renderSyncState(Array.from(state.changes.values()));
    try {
      const pendingImages = Array.from(state.changes.values()).filter(needsGithubImageNormalization);
      const pendingVideos = [];
      for (const change of state.changes.values()) {
        if (await videoNeedsPreparation(change)) pendingVideos.push(change);
      }
      if ((!pendingImages.length && !pendingVideos.length) || !state.treeHeadSha) return;
      showStatus(`${pendingImages.length + pendingVideos.length} unterbrochene Medienverarbeitung wird auf GitHub fortgesetzt …`);
      let expectedRecoveryStatus = els.statusBar.textContent;
      // Read back what was actually shown instead of predicting it. normalizeUploadedImage
      // now picks between a fast-path and a fallback message depending on which path ran,
      // and a duplicated guess here would quietly stop matching — swallowing the completion
      // notice below for no visible reason.
      for (const change of pendingImages) {
        await normalizeUploadedImage(change, state.treeHeadSha);
        expectedRecoveryStatus = els.statusBar.textContent;
      }
      for (const change of pendingVideos) {
        await prepareUploadedVideo(change, state.treeHeadSha);
        expectedRecoveryStatus = els.statusBar.textContent;
      }
      await refreshCurrentSilent();
      if (els.statusBar.textContent === expectedRecoveryStatus) {
        showStatus("Medienverarbeitung abgeschlossen. Nicht eingefügte Medien liegen in der Mediathek bereit.");
      }
    } finally {
      state.mediaRecoveryJobs = Math.max(0, state.mediaRecoveryJobs - 1);
      updateMediaProcessingState();
      renderSyncState(Array.from(state.changes.values()));
      if (state.view === "media") {
        renderMedia();
        try {
          await refreshMedia(false);
        } catch (error) {
          showStatus(`Mediathek konnte nach der Verarbeitung nicht aktualisiert werden: ${error.message}`, "error");
        }
      }
    }
  })();
  state.mediaRecoveryPromise = recovery;
  const clearRecovery = () => {
    if (state.mediaRecoveryPromise === recovery) state.mediaRecoveryPromise = null;
  };
  recovery.then(clearRecovery, clearRecovery);
  return recovery;
}

export async function refreshQueueFromGitHub() {
  if (!hasGithubAccess()) return;
  // Der Weg hierher steht immer offen, das Neuladen nicht: Es verwirft die Baum-Caches, mit
  // denen ein laufender Schreibvorgang gerade arbeitet (dieselbe Rücksicht nimmt
  // Pull-to-Refresh). Der lädt die Änderungen am Ende selbst neu und zeichnet die Ansicht mit.
  if (state.isBusy) return;
  const request = state.queueRefreshRequest + 1;
  state.queueRefreshRequest = request;
  state.tree = null;
  state.mainTree = null;
  state.changeCache = null;
  try {
    await loadChanges();
  } catch (error) {
    if (request === state.queueRefreshRequest) showStatus(`Warteschlange konnte nicht aktualisiert werden: ${error.message}`, "error");
  }
}
