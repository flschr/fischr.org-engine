import { publishRequestKey } from "./00-konstanten.js";

import { els } from "./01b-elements.js";
import { AKTIONS_TEXTE } from "./04c-queue-actions.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { deleteChange } from "./04a-draft-writes.js";
import { hasGithubAccess } from "./05-github-auth.js";
import { baseName, isVideoPath } from "./06-paths.js";
import { isOrphanMediaChange, orphanMediaChanges } from "./15a-media-reference-index.js";
import { escapeHtml } from "./16a-alt-text-actions.js";
import { askDiscardAction } from "./19a-editor-dialogs.js";
import { showView } from "./23-routing.js";
import { replaceNav } from "./24-history.js";
import { commitMediaManifestDelete } from "./26a2-media-manifest-writes.js";
import { discardTechnicalPosterChanges, queueVideoDelete } from "./26c-video-derivatives.js";
import { guardMediaIdle, hasActiveMediaWork, loadFreshChanges, refreshQueueFromGitHub, visibleQueueChanges } from "./26d-publish-sync.js";
import { publishProgressMeta, publishTimingLabel } from "./26g-publish-progress-text.js";
import { refreshCurrentSilent } from "./27a-publish-state.js";

export async function openQueue() {
  showView("queue");
  renderQueue();
  replaceNav();
  await refreshQueueFromGitHub();
}

// Was diese Zeile am öffentlichen Blog bewirkt.
//
// Vorher stand hier „Neu", „Geändert", „Löschen", „Upload" — eine Beschreibung der Datei, nicht
// ihrer Wirkung. „Neu" konnte ein Artikel sein, der gleich erscheint, oder ein Entwurf, der
// unsichtbar bleibt; „Geändert" konnte eine Aktualisierung sein oder ein Zurückziehen. Die
// Aktion steht seit der Ableitung in 04c-queue-actions.js an der Änderung selbst.
function queueChangeLabel(change) {
  if (change.kind === "technical-repair") return "Reparatur";
  if (change.aktion === "medien") return change.kind === "delete" ? "Medium löschen" : "Upload";
  return AKTIONS_TEXTE[change.aktion] || (change.kind === "delete" ? "Löschen" : "Geändert");
}

export function changeSignature(change) {
  if (change.technicalPosterChanges) {
    const repairs = change.technicalPosterChanges
      .map((item) => `${item.kind}:${item.path}:${item.sha || ""}`)
      .sort()
      .join("|");
    return `${change.kind}:${change.path}:${repairs}`;
  }
  return `${change.kind}:${change.path}:${change.sha || ""}`;
}

export function clearPublishTracking() {
  state.publishPollController?.abort();
  state.publishPollController = null;
  state.publishInFlight = false;
  state.publishStartedCount = 0;
  state.publishStartedSignatures = new Set();
  state.publishAnnouncementKey = "";
  state.publishRequest = null;
  window.RWPublishService.clearRequest(localStorage, publishRequestKey);
}

export function renderQueue() {
  const changes = Array.from(state.changes.values()).sort((a, b) => {
    return (a.collection || "").localeCompare(b.collection || "") || a.path.localeCompare(b.path);
  });
  const visibleChanges = visibleQueueChanges(changes);
  const publishLocked = state.isBusy || state.publishInFlight;
  const mediaProcessing = hasActiveMediaWork();
  const publishCount = state.publishStartedCount || visibleChanges.length;
  const publishPlan = window.RWPublishPlan.plan(changes);

  if (els.publishPlan) {
    els.publishPlan.textContent = changes.length ? `${publishPlan.label}: ${publishPlan.detail}` : "";
    els.publishPlan.hidden = changes.length === 0;
  }

  els.pushButton.disabled = changes.length === 0 || publishLocked || mediaProcessing || !hasGithubAccess();
  els.discardAllButton.disabled = changes.length === 0 || publishLocked || mediaProcessing;

  const orphanCount = state.publishInFlight ? 0 : orphanMediaChanges().length;
  if (els.cleanupOrphansButton) {
    els.cleanupOrphansButton.hidden = orphanCount === 0;
    els.cleanupOrphansButton.disabled = orphanCount === 0 || publishLocked || mediaProcessing;
    if (els.cleanupOrphansCount) els.cleanupOrphansCount.textContent = String(orphanCount);
  }
  els.pushButtonLabel.textContent = state.publishInFlight ? "Wird veröffentlicht …" : "Veröffentlichen";
  els.pushButtonCount.textContent = String(state.publishInFlight ? publishCount : visibleChanges.length);
  els.pushButtonCount.hidden = !state.publishInFlight && visibleChanges.length === 0;

  els.queueList.innerHTML = "";

  if (state.publishInFlight) {
    const item = document.createElement("li");
    const card = document.createElement("div");
    card.className = "queue-progress";
    const label = publishCount === 1 ? "1 Änderung wird veröffentlicht" : `${publishCount} Änderungen werden veröffentlicht`;
    const progressMeta = [publishProgressMeta(), publishTimingLabel()].filter(Boolean).join(" · ");
    const announcementKey = `${state.publishStatus?.state || "queued"}:${state.publishStatus?.step || state.publishStatus?.message || ""}`;
    const shouldAnnounce = announcementKey !== state.publishAnnouncementKey;
    state.publishAnnouncementKey = announcementKey;
    const progressValue = state.publishStatus?.phaseIndex != null && state.publishStatus?.phaseCount
      ? Math.round((state.publishStatus.phaseIndex / state.publishStatus.phaseCount) * 100)
      : null;
    const progressText = state.publishStatus?.phaseIndex != null && state.publishStatus?.phaseCount
      ? `Schritt ${state.publishStatus.phaseIndex} von ${state.publishStatus.phaseCount}`
      : "Fortschritt wird ermittelt";
    card.innerHTML = [
      '<span class="queue-progress-spinner" aria-hidden="true"></span>',
      '<span class="queue-progress-text">',
      `<strong>${escapeHtml(label)}${state.publishRequest?.validationMode ? ` · ${escapeHtml(state.publishRequest.validationMode === "content" ? "Schneller Content-Publish" : "Publish mit Codeprüfung")}` : ""}</strong>`,
      `<span${shouldAnnounce ? ' role="status" aria-live="polite"' : ""}>${escapeHtml(state.publishStatus?.message || "Warten auf den Start durch GitHub")}</span>`,
      progressMeta ? `<span class="queue-progress-meta" aria-hidden="true">${escapeHtml(progressMeta)}</span>` : "",
      state.publishStatus?.slowContent ? '<span class="queue-progress-meta">Warnung: Dieser Content-Publish dauert länger als 90 Sekunden.</span>' : "",
      `<span class="queue-progress-track" role="progressbar" aria-label="Veröffentlichungsfortschritt" aria-valuetext="${escapeHtml(progressText)}"${progressValue == null ? "" : ` aria-valuenow="${progressValue}"`} aria-valuemin="0" aria-valuemax="100"><span${progressValue == null ? "" : ` style="width:${progressValue}%"`}></span></span>`,
      "</span>"
    ].join("");
    item.append(card);
    els.queueList.append(item);
    return;
  }

  if (state.publishStatus?.state === "failed") {
    const item = document.createElement("li");
    const card = document.createElement("div");
    card.className = "queue-progress is-error";
    const runLink = state.publishStatus.url
      ? `<a href="${escapeHtml(state.publishStatus.url)}" target="_blank" rel="noopener noreferrer">Details in GitHub öffnen</a>`
      : "";
    card.innerHTML = [
      '<span data-icon="circle-alert" aria-hidden="true"></span>',
      '<span class="queue-progress-text">',
      "<strong>Veröffentlichung fehlgeschlagen</strong>",
      `<span>${escapeHtml(state.publishStatus.message)}. Die geprüften Änderungen bleiben in der Warteschlange.</span>`,
      runLink,
      "</span>"
    ].join("");
    window.RWIcons?.inject(card);
    item.append(card);
    els.queueList.append(item);
  }

  if (!visibleChanges.length) {
    const empty = document.createElement("li");
    empty.className = "entry-empty";
    // Ohne GitHub-Verbindung ist die Liste nicht leer, sondern ungelesen. Seit der Weg hierher
    // immer offensteht, trifft das auch jemanden, der nur nachsehen wollte — dann darf hier
    // keine Entwarnung stehen, die niemand geprüft hat.
    empty.textContent = hasGithubAccess()
      ? "Keine ausstehenden Änderungen. Alles ist veröffentlicht."
      : "Nicht mit GitHub verbunden — die Warteschlange kann gerade nicht gelesen werden.";
    els.queueList.append(empty);
    return;
  }

  visibleChanges.forEach((change) => {
    const item = document.createElement("li");
    const card = document.createElement("div");
    card.className = "entry-card queue-card";
    if (change.kind === "delete" || change.aktion === "zurueckziehen") card.classList.add("is-delete");
    const isOrphan = !change.technicalPosterChanges && isOrphanMediaChange(change);
    if (isOrphan) card.classList.add("is-orphan");

    const label = queueChangeLabel(change);
    const orphanPill = isOrphan
      ? '<span class="entry-pill is-orphan" title="Dieses Bild wird in keinem Artikel verwendet.">nicht verwendet</span>'
      : "";
    card.innerHTML = [
      `<span class="entry-title">${escapeHtml(change.label || baseName(change.path))}</span>`,
      `<span class="entry-meta">${escapeHtml(change.technicalPosterChanges ? `${change.technicalPosterChanges.length} technische Dateien` : change.path)}</span>`,
      `<span class="queue-tags"><span class="entry-pill${change.kind === "delete" || change.aktion === "zurueckziehen" ? " is-delete" : ""}">${escapeHtml(label)}</span>${orphanPill}<span class="queue-collection">${escapeHtml(change.collection || "")}</span></span>`
    ].join("");

    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "ghost danger queue-discard";
    discard.innerHTML = `<span data-icon="trash-2" aria-hidden="true"></span><span>Verwerfen</span>`;
    window.RWIcons?.inject(discard);
    discard.disabled = publishLocked || mediaProcessing;
    discard.addEventListener("click", async () => {
      const confirmed = await askDiscardAction({
        title: "Discard change?",
        text: `“${change.label || baseName(change.path)}” is permanently removed from the queue.`
      });
      if (!confirmed) return;
      try {
        const confirmedChanges = await loadFreshChanges();
        if (!guardMediaIdle("Verwerfen")) return;
        const confirmedVisibleChanges = visibleQueueChanges(confirmedChanges);
        const confirmedChange = confirmedVisibleChanges.find((candidate) => candidate.path === change.path);
        if (!confirmedChange || changeSignature(confirmedChange) !== changeSignature(change)) {
          showStatus("Die Änderung wurde zwischenzeitlich aktualisiert. Bitte erneut prüfen und verwerfen.", "error");
          renderQueue();
          return;
        }
        if (confirmedChange.technicalPosterChanges) await discardTechnicalPosterChanges(confirmedChange.technicalPosterChanges);
        else if (isVideoPath(confirmedChange.path)) await queueVideoDelete(confirmedChange, { kind: "upsert" });
        // An upload that reached R2 has no blob at its path: discarding it removes the
        // record that stands in for one, not a tree entry that does not exist.
        else if (confirmedChange.recordPath) await commitMediaManifestDelete(confirmedChange);
        else await deleteChange(confirmedChange.path, confirmedChange.sha);
        await refreshCurrentSilent();
        renderQueue();
        showStatus("Removed from the queue.");
      } catch (error) {
        showStatus(`Verwerfen fehlgeschlagen: ${error.message}`, "error");
      }
    });

    const actions = document.createElement("div");
    actions.className = "queue-card-actions";
    actions.append(discard);

    card.append(actions);
    item.append(card);
    els.queueList.append(item);
  });
}
