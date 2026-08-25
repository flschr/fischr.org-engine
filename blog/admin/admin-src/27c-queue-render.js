import { publishRequestKey } from "./00-konstanten.js";
import { t, tn } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { queueKarte } from "./27h-queue-card.js";
import { AKTIONS_SCHLUESSEL, erzwungeneMedien, istWirksam } from "./04c-queue-actions.js";
import { state } from "./01c-state.js";
import { hasGithubAccess } from "./05-github-auth.js";
import { medienJeAenderung, orphanMediaChanges } from "./15a-media-reference-index.js";
import { escapeHtml } from "./16a-alt-text-actions.js";
import { showView } from "./23-routing.js";
import { replaceNav } from "./24-history.js";
import { hasActiveMediaWork, refreshQueueFromGitHub, visibleQueueChanges } from "./26d-publish-sync.js";
import { publishProgressMeta, publishTimingLabel } from "./26g-publish-progress-text.js";

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
export function queueChangeLabel(change) {
  if (change.kind === "technical-repair") return t("queue.actionRepair");
  if (change.aktion === "medien") return t(change.kind === "delete" ? "queue.actionDeleteMedium" : "queue.actionUpload");
  const key = AKTIONS_SCHLUESSEL[change.aktion];
  return key ? t(key) : t(change.kind === "delete" ? "queue.actionDelete" : "queue.actionChanged");
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
  // Was der Klick tatsächlich mitnimmt — nicht, was in der Liste steht. Ohne diese Zahl blieb
  // eine Abwahl per Checkbox unsichtbar: Der Knopf zeigte weiter die volle Menge, als hätte der
  // Klick nichts bewirkt.
  const wirksameAlle = changes.filter((change) => istWirksam(change.aktion ?? "medien"));
  const selectedCount = state.queueAbgewaehlt.size
    ? wirksameAlle.filter((change) => !state.queueAbgewaehlt.has(change.path)).length
    : visibleChanges.length;

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
  els.pushButtonLabel.textContent = state.publishInFlight ? t("queue.publishingInProgress") : t("dialog.publish");
  els.pushButtonCount.textContent = String(state.publishInFlight ? publishCount : selectedCount);
  els.pushButtonCount.hidden = !state.publishInFlight && visibleChanges.length === 0;

  els.queueList.innerHTML = "";

  if (state.publishInFlight) {
    const item = document.createElement("li");
    const card = document.createElement("div");
    card.className = "queue-progress";
    const label = tn("queue.changesPublishing", publishCount);
    const progressMeta = [publishProgressMeta(), publishTimingLabel()].filter(Boolean).join(" · ");
    const announcementKey = `${state.publishStatus?.state || "queued"}:${state.publishStatus?.step || state.publishStatus?.messageKey || state.publishStatus?.message || ""}`;
    const shouldAnnounce = announcementKey !== state.publishAnnouncementKey;
    state.publishAnnouncementKey = announcementKey;
    const progressValue = state.publishStatus?.phaseIndex != null && state.publishStatus?.phaseCount
      ? Math.round((state.publishStatus.phaseIndex / state.publishStatus.phaseCount) * 100)
      : null;
    const progressText = state.publishStatus?.phaseIndex != null && state.publishStatus?.phaseCount
      ? t("queue.stepProgress", { phaseIndex: state.publishStatus.phaseIndex, phaseCount: state.publishStatus.phaseCount })
      : t("queue.determiningProgress");
    // Re-resolved via t() here, not read off state.publishStatus.message
    // directly: that field is a snapshot taken whenever GitHub was last
    // polled, and without messageKey a language switch mid-publish would
    // leave it frozen in whatever language it was in when it was written.
    const statusMessage = state.publishStatus?.messageKey ? t(state.publishStatus.messageKey, state.publishStatus.messageVars) : state.publishStatus?.message;
    card.innerHTML = [
      '<span class="queue-progress-spinner" aria-hidden="true"></span>',
      '<span class="queue-progress-text">',
      `<strong>${escapeHtml(label)}${state.publishRequest?.validationMode ? ` · ${escapeHtml(state.publishRequest.validationMode === "content" ? t("queue.fastContentPublish") : t("queue.publishWithCodeCheck"))}` : ""}</strong>`,
      `<span${shouldAnnounce ? ' role="status" aria-live="polite"' : ""}>${escapeHtml(statusMessage || t("queue.pendingAtGithub"))}</span>`,
      progressMeta ? `<span class="queue-progress-meta" aria-hidden="true">${escapeHtml(progressMeta)}</span>` : "",
      state.publishStatus?.slowContent ? `<span class="queue-progress-meta">${escapeHtml(t("queue.slowContentWarning"))}</span>` : "",
      `<span class="queue-progress-track" role="progressbar" aria-label="${escapeHtml(t("aria.publishProgress"))}" aria-valuetext="${escapeHtml(progressText)}"${progressValue == null ? "" : ` aria-valuenow="${progressValue}"`} aria-valuemin="0" aria-valuemax="100"><span${progressValue == null ? "" : ` style="width:${progressValue}%"`}></span></span>`,
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
    const failedMessage = state.publishStatus.messageKey ? t(state.publishStatus.messageKey, state.publishStatus.messageVars) : state.publishStatus.message;
    const runLink = state.publishStatus.url
      ? `<a href="${escapeHtml(state.publishStatus.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("queue.openInGithub"))}</a>`
      : "";
    card.innerHTML = [
      '<span data-icon="circle-alert" aria-hidden="true"></span>',
      '<span class="queue-progress-text">',
      `<strong>${escapeHtml(t("queue.publishFailedGeneric"))}</strong>`,
      `<span>${escapeHtml(t("queue.failedCardSuffix", { message: failedMessage }))}</span>`,
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
      ? t("queue.emptyAllPublished")
      : t("queue.emptyNotConnected");
    els.queueList.append(empty);
    return;
  }

  visibleChanges.forEach((change) => els.queueList.append(queueKarte(change, {
    publishLocked,
    mediaProcessing,
    erzwungen: erzwungeneMedien(visibleChanges, state.queueAbgewaehlt, medienJeAenderung(visibleChanges))
  })));
}
