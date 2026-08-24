import { repo } from "./00-konstanten.js";
import { t } from "./00a-i18n.js";
import { istWirksam, pfadeZumSenden } from "./04c-queue-actions.js";
import { medienJeAenderung } from "./15a-media-reference-index.js";
import { github } from "./01-bootstrap.js";
import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { ensureDraftsBranch, getAllChanges } from "./04-drafts.js";
import { focusGithubConnection, hasGithubAccess, requireGithubAccess } from "./05-github-auth.js";
import { guardMediaReadyForPublish, recoverPendingMediaOperations, renderSyncState } from "./26d-publish-sync.js";
import { waitForMediaCommits } from "./26e-media-recovery-state.js";
import { persistPublishRequest, pollPublishCompletion } from "./27a-publish-state.js";
import { changeSignature, openQueue, renderQueue } from "./27c-queue-render.js";

// Startet die Veröffentlichung über den eigenen Endpunkt.
//
// Ein veralteter Stand kommt als 409 zurück und ist kein Ausfall, sondern eine Auskunft: In der
// Zwischenzeit wurde etwas anderes veröffentlicht. Sie muss als solche ankommen, sonst sucht man
// den Fehler bei sich.
async function starteVeroeffentlichung({ requestId, mainHead, draftsHead, changeCount, paths }) {
  const antwort = await fetch("/api/admin/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ requestId, mainSha: mainHead, draftSha: draftsHead, changeCount, paths })
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

// Die Pfade, die mitreisen — oder null, wenn nichts abgewählt ist. Einmal benannt, weil zwei
// Stellen dieselbe Menge brauchen: der Medien-Wächter und die Anfrage selbst. Liefen sie
// auseinander, prüfte der eine etwas anderes, als der andere veröffentlicht.
function auswahlPfade(changes) {
  if (!state.queueAbgewaehlt.size) return null;
  return pfadeZumSenden(changes, state.queueAbgewaehlt, medienJeAenderung(changes));
}

export async function syncOutbox() {
  if (state.publishInFlight) {
    showStatus("Die Veröffentlichung läuft bereits auf GitHub.");
    return;
  }
  await waitForMediaCommits();
  const changes = await getAllChanges();

  // Der Medien-Wächter sieht nur, was mitreist.
  //
  // Er hält die Veröffentlichung an, solange ein Bild noch verarbeitet wird — sonst stünde der
  // Artikel auf main mit einer Adresse, hinter der nichts liegt. Gehört das Bild aber
  // ausschliesslich zu einem abgewählten Artikel, reist es gar nicht mit und kann nichts kaputt
  // machen. Ohne diese Einschränkung blockierte es trotzdem alles andere — die Auswahl hälfe
  // dann genau dort nicht, wo sie gedacht ist.
  //
  // Enger, nicht schwächer: Ohne Abwahl ist die Menge unverändert die vollständige.
  const reisendePfade = auswahlPfade(changes);
  const reisendeAenderungen = reisendePfade
    ? changes.filter((change) => reisendePfade.includes(change.path))
    : changes;
  if (!await guardMediaReadyForPublish(reisendeAenderungen)) {
    if (!state.mediaProcessing) {
      recoverPendingMediaOperations().catch((error) => showStatus(t("queue.mediaProcessingFailed", { error: error.message }), "error"));
    }
    return;
  }
  if (!changes.length) {
    showStatus(t("queue.noPendingChanges"));
    renderQueue();
    return;
  }
  // Alles abgewählt heisst nicht „nichts veröffentlichen": Es liefe ein voller Bau samt Deploy
  // für einen Stand, der sich öffentlich nicht unterscheidet. Wer hier landet, hat sich vertan.
  const wirksame = changes.filter((change) => istWirksam(change.aktion ?? "medien"));
  if (wirksame.length && wirksame.every((change) => state.queueAbgewaehlt.has(change.path))) {
    showStatus(t("queue.nothingSelected"), "error");
    await openQueue();
    return;
  }
  if (!hasGithubAccess()) {
    requireGithubAccess(t("action.publishing"));
    await openQueue();
    focusGithubConnection();
    return;
  }

  setBusy(true);
  try {
    showStatus(t("queue.startingPublish"));
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
    // Ohne Abwahl geht keine Pfadliste raus. Das ist nicht dasselbe wie eine Liste, die zufällig
    // alles enthält: Der Bau behandelt „keine Liste" als „alles" und verhält sich damit exakt
    // wie vorher — eine Auswahl, die niemand getroffen hat, kann so auch nichts verändern.
    const paths = reisendePfade;
    // Gezählt wird, was mitgeht — nicht, was anliegt. Die Zahl steht in der Commit-Nachricht
    // („Publish 3 changes") und auf der Fortschrittskarte; bei einer Abwahl hätte sie sonst mehr
    // behauptet, als tatsächlich veröffentlicht wurde.
    const gesendeteAnzahl = paths
      ? wirksame.filter((change) => !state.queueAbgewaehlt.has(change.path)).length
      : changes.length;
    const publishPlan = window.RWPublishPlan.plan(changes);
    const requestId = window.RWPublishStatus.createRequestId();
    const request = {
      requestId,
      mainSha: mainHead,
      draftSha: draftsHead,
      changeCount: gesendeteAnzahl,
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
    const gestartet = await starteVeroeffentlichung({
      requestId, mainHead, draftsHead, changeCount: gesendeteAnzahl, paths
    });
    request.workflowId = gestartet?.id || "";
    state.publishInFlight = true;
    state.publishStartedCount = gesendeteAnzahl;
    state.publishStartedSignatures = new Set(changes.map(changeSignature));
    state.publishStatus = { state: "queued", message: t("queue.waitingForGithub") };
    persistPublishRequest(request);
    state.publishPollToken += 1;
    const pollToken = state.publishPollToken;
    renderSyncState(changes);
    showStatus(t("queue.publishStarted"));
    pollPublishCompletion(pollToken, request);
  } catch (error) {
    const authHint = /GitHub (401|403)/.test(error.message)
      ? t("queue.reauthHint")
      : "";
    showStatus(t("queue.publishFailed", { error: error.message, hint: authHint }), "error");
  } finally {
    setBusy(false);
  }
}
