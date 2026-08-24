// Eine Zeile der Warteschlange.
//
// Getrennt von 27c-queue-render.js, das die Liste zusammenstellt: Welche Zeilen es gibt und was
// darum herum steht (Fortschritt, leere Zustände, fehlende Verbindung) ist eine andere Frage als
// wie eine Zeile aussieht und was ihre Knöpfe tun.

import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { istWirksam } from "./04c-queue-actions.js";
import { showStatus } from "./03-status.js";
import { deleteChange } from "./04a-draft-writes.js";
import { baseName, isVideoPath } from "./06-paths.js";
import { isOrphanMediaChange } from "./15a-media-reference-index.js";
import { escapeHtml } from "./16a-alt-text-actions.js";
import { askDiscardAction } from "./19a-editor-dialogs.js";
import { commitMediaManifestDelete } from "./26a2-media-manifest-writes.js";
import { discardTechnicalPosterChanges, queueVideoDelete } from "./26c-video-derivatives.js";
import { guardMediaIdle, loadFreshChanges, visibleQueueChanges } from "./26d-publish-sync.js";
import { refreshCurrentSilent } from "./27a-publish-state.js";
import { changeSignature, queueChangeLabel, renderQueue } from "./27c-queue-render.js";

export function queueKarte(change, { publishLocked, mediaProcessing, erzwungen }) {
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

  if (change.collection !== "media" && !change.technicalPosterChanges && istWirksam(change.aktion)) {
    const auswahl = document.createElement("label");
    auswahl.className = "queue-select";
    const kasten = document.createElement("input");
    kasten.type = "checkbox";
    kasten.checked = !state.queueAbgewaehlt.has(change.path);
    kasten.disabled = publishLocked;
    kasten.setAttribute("aria-label", `${change.label || baseName(change.path)} mitveröffentlichen`);
    kasten.addEventListener("change", () => {
      if (kasten.checked) state.queueAbgewaehlt.delete(change.path);
      else state.queueAbgewaehlt.add(change.path);
      renderQueue();
    });
    auswahl.append(kasten, document.createTextNode("Senden"));
    actions.append(auswahl);
  } else if (change.collection === "media" && erzwungen.has(change.publicPath || "")) {
    const hinweis = document.createElement("span");
    hinweis.className = "queue-forced";
    hinweis.textContent = "Gehört zu einem gewählten Artikel";
    actions.append(hinweis);
  }

  actions.append(discard);

  card.append(actions);
  item.append(card);
  return item;
  els.queueList.append(item);
}
