import { t } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { istWirksam } from "./04c-queue-actions.js";
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

// Zeigt, was sich am öffentlichen Blog ändert — nicht jede Abweichung zwischen `drafts` und
// `main`. Warum das nicht dasselbe ist, steht bei der Ableitung in 04c-queue-actions.js.
export function visibleQueueChanges(changes) {
  const allChanges = changes || Array.from(state.changes.values());
  const ohnePoster = allChanges.filter((change) => !isVideoPosterPath(change.path));
  const visibleChanges = ohnePoster.filter((change) => istWirksam(change.aktion ?? "medien"));
  if (visibleChanges.length || !allChanges.length) return visibleChanges;

  // Die Ersatzkarte unten meint einen bestimmten Fall: Es liegt etwas an, aber es sind
  // ausschliesslich Video-Poster — technische Dateien, die niemand als Artikel wiedererkennt.
  //
  // Seit die Warteschlange auch wirkungslose Änderungen ausblendet, kann sie aus einem zweiten
  // Grund leer sein: Es liegt ein Entwurf an, der öffentlich nichts bewirkt. Ohne diese Zeile
  // bekäme der eine „Technische Video-Reparatur"-Karte — eine Erklärung für etwas, das gar
  // nicht der Fall ist.
  if (ohnePoster.length) return visibleChanges;
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
  // The label itself no longer carries the running step — that already lives
  // in the publish overlay's own text, in full and on every platform. Two
  // copies of the same progress drifted: this one truncated the message and
  // stopped updating for stretches of a slow step, reading as finished while
  // the deploy was still running.
  if (labelEl) labelEl.textContent = "Sync";
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

export function guardMediaIdle(action = t("action.thisAction")) {
  if (!hasActiveMediaWork()) return true;
  showStatus(t("media.actionWaitsForProcessing", { action }), "error");
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
