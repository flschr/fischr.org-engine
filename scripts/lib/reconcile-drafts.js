const { applyPathDelta, checkoutBranch, diffPaths, git, gitQuiet, rev, wait } = require("./publish-git");

function reconcileDrafts({
  finalCommit,
  expectedMainSha,
  expectedDraftSha,
  publishBranch,
  draftsBranch,
  managedPaths,
  auswahl = null,
  attempts,
  fetchRefs
}) {
  // Was geprüft, aber nicht mitgesendet wurde.
  //
  // Ohne diese Menge wäre eine Auswahl kein Zurückhalten, sondern ein Verwerfen: Der neue
  // drafts-Stand entsteht aus dem veröffentlichten Commit plus dem, was *nach* der Freigabe
  // gespeichert wurde. Eine abgewählte Änderung war aber *vor* der Freigabe da — sie steht in
  // keinem der beiden und fiele damit auf den Stand von main zurück. Wer einen halbfertigen
  // Artikel zurückhält, verlöre ihn genau dadurch.
  const zurueckgehalten = auswahl
    ? new Set(diffPaths(expectedMainSha, expectedDraftSha, managedPaths).filter((pfad) => !auswahl.has(pfad)))
    : new Set();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    fetchRefs();
    const currentDraftSha = rev(`origin/${draftsBranch}`);
    checkoutBranch(`admin-publish-drafts-${process.pid}`, finalCommit);

    if (currentDraftSha !== expectedDraftSha) {
      console.log(`${draftsBranch} moved during publish; preserving changes saved after the reviewed snapshot.`);
    }
    // Erst das Zurückgehaltene auf seinen geprüften Stand zurückholen, dann die Bearbeitungen
    // nach der Freigabe darüber. Die Reihenfolge entscheidet: Wurde ein zurückgehaltener Artikel
    // seither weiter bearbeitet, muss die neuere Fassung gewinnen, nicht die geprüfte.
    if (zurueckgehalten.size) applyPathDelta(finalCommit, expectedDraftSha, managedPaths, zurueckgehalten);
    applyPathDelta(expectedDraftSha, currentDraftSha, managedPaths);
    const tree = git(["write-tree"]);
    if (tree === rev(`${currentDraftSha}^{tree}`) && gitQuiet(["merge-base", "--is-ancestor", finalCommit, currentDraftSha])) {
      console.log(`${draftsBranch} is already reconciled with ${finalCommit}.`);
      return;
    }
    const syncCommit = git([
      "commit-tree", tree,
      "-p", currentDraftSha,
      "-p", finalCommit,
      "-m", `Sync published ${publishBranch} and preserve newer ${draftsBranch} [skip ci]`
    ]);
    if (gitQuiet(["push", "origin", `${syncCommit}:refs/heads/${draftsBranch}`])) {
      console.log(`${draftsBranch} matches the deployment and preserves concurrent edits.`);
      return;
    }
    console.log(`Reconciliation push raced with another save (attempt ${attempt}/${attempts}); retrying.`);
    wait(Math.min(2000, attempt * 250));
  }
  throw new Error(
    `Published ${publishBranch}, but could not reconcile ${draftsBranch} after ${attempts} attempts. The publish is incomplete and must be repaired.`
  );
}

module.exports = { reconcileDrafts };
