// Änderungen verwerfen — alles, oder nur die Uploads, die kein Artikel benutzt.
//
// Stand vorher zusammen mit dem Veröffentlichungszustand in 27a und den Veröffentlichungs-
// aktionen in 27b. Beides sind andere Fragen: Was passiert gerade mit einer Veröffentlichung,
// und wie beginnt eine. Verwerfen ist der dritte Fall — und der einzige, der Arbeit wegwirft.

import { repo } from "./00-konstanten.js";
import { github } from "./01-bootstrap.js";
import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { ensureDraftsBranch, getAllChanges } from "./04-drafts.js";
import { loadChanges } from "./04a-draft-writes.js";
import { orphanMediaChanges } from "./15a-media-reference-index.js";
import { askDiscardAction } from "./19a-editor-dialogs.js";
import { discardUnusedMediaChanges } from "./26c-video-derivatives.js";
import { changeSetSignature, guardMediaIdle, loadFreshChanges, visibleQueueChanges } from "./26d-publish-sync.js";
import { waitForMediaCommits } from "./26e-media-recovery-state.js";
import { refreshCurrentSilent } from "./27a-publish-state.js";
import { renderQueue } from "./27c-queue-render.js";

export async function discardAllChanges() {
  await waitForMediaCommits();
  const changes = await getAllChanges();
  if (!changes.length) return;
  if (!guardMediaIdle("Alle Änderungen verwerfen")) return;
  const confirmedChangeSet = changeSetSignature(changes);
  const confirmedDraftHead = state.treeHeadSha;
  const visibleCount = visibleQueueChanges(changes).length;
  const confirmed = await askDiscardAction({
    title: "Discard all changes?",
    text: visibleCount === 1
      ? "1 change is permanently removed from the queue."
      : `${visibleCount} changes are permanently removed from the queue.`,
    actionLabel: "Discard all"
  });
  if (!confirmed) return;
  setBusy(true);
  try {
    const confirmedChanges = await loadFreshChanges();
    if (!confirmedChanges.length) return;
    if (!guardMediaIdle("Alle Änderungen verwerfen")) return;
    if (state.treeHeadSha !== confirmedDraftHead || changeSetSignature(confirmedChanges) !== confirmedChangeSet) {
      showStatus("Die Warteschlange wurde zwischenzeitlich aktualisiert. Bitte erneut prüfen und verwerfen.", "error");
      return;
    }
    // Create an ordinary forward-moving snapshot commit whose tree equals
    // main. The exact reviewed drafts head is the first parent, so branch
    // protection stays intact and a concurrent save makes the CAS fail rather
    // than being silently discarded.
    await ensureDraftsBranch();
    const draftsHead = state.treeHeadSha
      || (await github(`git/ref/heads/${encodeURIComponent(repo.branch)}`)).object.sha;
    const mainRef = await github(`git/ref/heads/${encodeURIComponent(repo.publishBranch)}`);
    const mainCommit = await github(`git/commits/${mainRef.object.sha}`);
    const discardCommit = await github("git/commits", {
      method: "POST",
      body: {
        message: `Discard all admin changes [skip ci]`,
        tree: mainCommit.tree.sha,
        parents: [draftsHead, mainRef.object.sha]
      }
    });
    await github(`git/refs/heads/${encodeURIComponent(repo.branch)}`, {
      method: "PATCH",
      body: { sha: discardCommit.sha, force: false }
    });
    state.tree = null;
    state.treeHeadSha = "";
    state.treeParentHeadSha = "";
    state.changeCache = null;
    await loadChanges();
    await refreshCurrentSilent();
    showStatus("All changes discarded.");
  } catch (error) {
    showStatus(`Verwerfen fehlgeschlagen — möglicherweise wurde parallel gespeichert. Bitte Queue neu laden: ${error.message}`, "error");
  } finally {
    setBusy(false);
    renderQueue();
  }
}

// Drop every queued upload that no article references — restoring main's
// version per file (or removing it if it was new) in a single drafts commit.

export async function discardUnusedMedia() {
  await waitForMediaCommits();
  const changes = await loadChanges();
  if (!changes.length) return;
  const orphans = orphanMediaChanges();
  if (!orphans.length) return;
  if (!guardMediaIdle("Unbenutzte Uploads verwerfen")) return;
  const confirmedOrphanSet = changeSetSignature(orphans);
  const confirmedDraftHead = state.treeHeadSha;
  const confirmed = await askDiscardAction({
    title: "Discard unused uploads?",
    text: orphans.length === 1
      ? "1 Bild, das in keinem Artikel verwendet wird, wird aus der Queue entfernt."
      : `${orphans.length} Bilder, die in keinem Artikel verwendet werden, werden aus der Queue entfernt.`,
    actionLabel: "Verwerfen"
  });
  if (!confirmed) return;
  setBusy(true);
  try {
    const confirmedChanges = await loadFreshChanges();
    if (!confirmedChanges.length) return;
    if (!guardMediaIdle("Unbenutzte Uploads verwerfen")) return;
    const confirmedOrphans = orphanMediaChanges();
    if (!confirmedOrphans.length) return;
    if (state.treeHeadSha !== confirmedDraftHead || changeSetSignature(confirmedOrphans) !== confirmedOrphanSet) {
      showStatus("Die unbenutzten Uploads wurden zwischenzeitlich aktualisiert. Bitte erneut prüfen und verwerfen.", "error");
      return;
    }
    await discardUnusedMediaChanges(confirmedOrphans);
    await loadChanges();
    await refreshCurrentSilent();
    showStatus(confirmedOrphans.length === 1 ? "1 unbenutzter Upload entfernt." : `${confirmedOrphans.length} unbenutzte Uploads entfernt.`);
  } catch (error) {
    showStatus(`Verwerfen fehlgeschlagen: ${error.message}`, "error");
  } finally {
    setBusy(false);
    renderQueue();
  }
}
