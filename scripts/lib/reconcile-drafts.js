const { applyPathDelta, checkoutBranch, git, gitQuiet, rev, wait } = require("./publish-git");

function reconcileDrafts({
  finalCommit,
  expectedDraftSha,
  publishBranch,
  draftsBranch,
  managedPaths,
  attempts,
  fetchRefs
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    fetchRefs();
    const currentDraftSha = rev(`origin/${draftsBranch}`);
    checkoutBranch(`admin-publish-drafts-${process.pid}`, finalCommit);

    if (currentDraftSha !== expectedDraftSha) {
      console.log(`${draftsBranch} moved during publish; preserving changes saved after the reviewed snapshot.`);
    }
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
