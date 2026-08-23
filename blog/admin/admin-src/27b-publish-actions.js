import { repo } from "./00-konstanten.js";
import { github } from "./01-bootstrap.js";
import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { ensureDraftsBranch, getAllChanges } from "./04-drafts.js";
import { loadChanges } from "./04a-draft-writes.js";
import { focusGithubConnection, hasGithubAccess, requireGithubAccess } from "./05-github-auth.js";
import { orphanMediaChanges } from "./15a-media-reference-index.js";
import { askDiscardAction } from "./19a-editor-dialogs.js";
import { discardUnusedMediaChanges } from "./26c-video-derivatives.js";
import { changeSetSignature, guardMediaIdle, guardMediaReadyForPublish, loadFreshChanges, recoverPendingMediaOperations, renderSyncState } from "./26d-publish-sync.js";
import { waitForMediaCommits } from "./26e-media-recovery-state.js";
import { persistPublishRequest, pollPublishCompletion, refreshCurrentSilent } from "./27a-publish-state.js";
import { changeSignature, openQueue, renderQueue } from "./27c-queue-render.js";

// Startet die Veröffentlichung über den eigenen Endpunkt.
//
// Ein veralteter Stand kommt als 409 zurück und ist kein Ausfall, sondern eine Auskunft: In der
// Zwischenzeit wurde etwas anderes veröffentlicht. Sie muss als solche ankommen, sonst sucht man
// den Fehler bei sich.
async function starteVeroeffentlichung({ requestId, mainHead, draftsHead, changeCount }) {
  const antwort = await fetch("/api/admin/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ requestId, mainSha: mainHead, draftSha: draftsHead, changeCount })
  });

  if (antwort.ok) return antwort.json().catch(() => ({}));

  let koerper = null;
  try {
    koerper = await antwort.json();
  } catch {
    koerper = null;
  }

  const fehler = new Error(koerper?.message || `Veröffentlichung konnte nicht gestartet werden (${antwort.status}).`);
  fehler.code = koerper?.code || `HTTP_${antwort.status}`;
  throw fehler;
}

export async function syncOutbox() {
  if (state.publishInFlight) {
    showStatus("Die Veröffentlichung läuft bereits auf GitHub.");
    return;
  }
  await waitForMediaCommits();
  const changes = await getAllChanges();
  if (!await guardMediaReadyForPublish(changes)) {
    if (!state.mediaProcessing) {
      recoverPendingMediaOperations().catch((error) => showStatus(`Medienverarbeitung fehlgeschlagen: ${error.message}`, "error"));
    }
    return;
  }
  if (!changes.length) {
    showStatus("No pending changes.");
    renderQueue();
    return;
  }
  if (!hasGithubAccess()) {
    requireGithubAccess("publishing");
    await openQueue();
    focusGithubConnection();
    return;
  }

  setBusy(true);
  try {
    showStatus("Starting publish …");
    await ensureDraftsBranch();
    // `getAllChanges()` above has already resolved the exact drafts commit
    // behind the reviewed tree. Prefer that immutable commit over an immediate
    // branch-ref read: GitHub's read replicas can briefly return the parent
    // right after a save, which made an immediate “sync everything” dispatch
    // a stale SHA and left the UI polling a workflow that had already failed.
    const draftsHead = state.tree && state.treeHeadSha
      ? state.treeHeadSha
      : (await github(`git/ref/heads/${encodeURIComponent(repo.branch)}`)).object.sha;
    const mainHead = state.mainTree && state.mainTreeHeadSha
      ? state.mainTreeHeadSha
      : (await github(`git/ref/heads/${encodeURIComponent(repo.publishBranch)}`)).object.sha;
    // Derselbe Plan, den die Queue anzeigt, aus denselben Änderungen neu berechnet. Die
    // Anfrage ist die einzige Stelle, an der er die Veröffentlichung überdauert: die
    // Fortschrittskarte beschriftet sich daraus, und die Warnung nach 90 Sekunden gilt nur
    // für einen Content-Publish.
    //
    // Übernommen aus #96, das den Fehler auf main behoben hat: Bis dahin las diese Stelle ein
    // publishPlan, das es hier nie gab — sichtbar geworden erst durch die Modul-Umstellung.
    const publishPlan = window.RWPublishPlan.plan(changes);
    const requestId = window.RWPublishStatus.createRequestId();
    const request = {
      requestId,
      mainSha: mainHead,
      draftSha: draftsHead,
      changeCount: changes.length,
      validationMode: publishPlan.mode,
      signatures: changes.map(changeSignature),
      startedAt: new Date().toISOString()
    };
    // Gestartet wird über den eigenen Endpunkt, nicht mehr per Dispatch von hier aus. Damit gibt
    // es einen Ort, der weiss, dass eine Veröffentlichung läuft — und die Prüfung, ob der
    // freigegebene Stand noch gilt, passiert dort, bevor etwas angestossen wird. Vorher konnte
    // der Browser eine Veröffentlichung auf einen Stand loslassen, den es nicht mehr gab, und
    // das fiel erst im Bau auf.
    // Die Kennung der Instanz gehört in die Anfrage: Sie ist der einzige Faden zurück zu dem
    // Vorgang, falls nie ein Actions-Lauf erscheint — und sie überlebt so auch ein Neuladen.
    const gestartet = await starteVeroeffentlichung({ requestId, mainHead, draftsHead, changeCount: changes.length });
    request.workflowId = gestartet?.id || "";
    state.publishInFlight = true;
    state.publishStartedCount = changes.length;
    state.publishStartedSignatures = new Set(changes.map(changeSignature));
    state.publishStatus = { state: "queued", message: "Waiting for GitHub to accept the publish request" };
    persistPublishRequest(request);
    state.publishPollToken += 1;
    const pollToken = state.publishPollToken;
    renderSyncState(changes);
    showStatus("Veröffentlichung gestartet – GitHub optimiert, verteilt und synchronisiert die Entwürfe.");
    pollPublishCompletion(pollToken, request);
  } catch (error) {
    const authHint = /GitHub (401|403)/.test(error.message)
      ? " Sign out and back in to refresh GitHub permissions, then publish again."
      : "";
    showStatus(`Veröffentlichung fehlgeschlagen: ${error.message}${authHint}`, "error");
  } finally {
    setBusy(false);
  }
}
