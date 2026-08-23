import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { renderQueue } from "./27c-queue-render.js";

// --- Shared media recovery state ----------------------------------------

export function updateMediaProcessingState() {
  state.mediaProcessing = state.mediaActiveJobs + state.mediaRecoveryJobs > 0;
}

export function finishMediaJob() {
  state.mediaActiveJobs = Math.max(0, state.mediaActiveJobs - 1);
  updateMediaProcessingState();
  renderQueue();
}

export async function waitForMediaCommits() {
  while (state.mediaCommitPromise) {
    showStatus("Laufender Medien-Upload wird sicher gespeichert …");
    const commit = state.mediaCommitPromise;
    try {
      await commit;
    } catch {
      // startMediaJobs registers the failed batch before this continuation
      // runs. The shared recovery below owns retry/removal and its result.
    }
    if (state.mediaCommitPromise === commit) break;
  }
}
