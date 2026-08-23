import { publishRequestKey, repo } from "./00-konstanten.js";
import { github, isTransientGitHubError } from "./01-bootstrap.js";
import { state } from "./01c-state.js";
import { setBusy, showStatus } from "./03-status.js";
import { ensureDraftsBranch, getAllChanges } from "./04-drafts.js";
import { loadChanges } from "./04a-draft-writes.js";
import { hasGithubAccess } from "./05-github-auth.js";
import { askDiscardAction } from "./19a-editor-dialogs.js";
import { refreshEntries } from "./25-entries.js";
import { refreshCurrentPublishedState } from "./25c-entry-opening.js";
import { refreshMedia } from "./26a-media-library.js";
import { changeSetSignature, guardMediaIdle, loadFreshChanges, renderSyncState, visibleQueueChanges } from "./26d-publish-sync.js";
import { waitForMediaCommits } from "./26e-media-recovery-state.js";
import { clearPublishTracking, renderQueue } from "./27c-queue-render.js";

export async function refreshCurrentSilent() {
  try {
    if (state.collection === "media") await refreshMedia(false);
    else await refreshEntries(false);
  } catch (error) {
    // ignore — queue view stays usable even if a background refresh fails
  }
}

export function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function refreshPublishState() {
  state.tree = null;
  state.mainTree = null;
  state.changeCache = null;
  state.postsIndex = null;
  const changes = await loadChanges();
  await refreshCurrentSilent();
  await refreshCurrentPublishedState();
  return changes;
}

export async function refreshAfterTabResume() {
  if (!hasGithubAccess()) return;
  if (document.visibilityState && document.visibilityState !== "visible") return;
  if (!state.publishInFlight && state.view !== "queue" && state.changes.size === 0) return;
  if (state.refreshPromise) return state.refreshPromise;
  state.refreshPromise = (async () => {
    try {
      await refreshPublishState();
      if (state.publishRequest) await refreshPublishRequest(state.publishRequest);
    } catch {
      // The regular status/polling path will surface persistent failures.
    } finally {
      state.refreshPromise = null;
    }
  })();
  return state.refreshPromise;
}

function storedPublishRequest() {
  return window.RWPublishService.storedRequest(localStorage, publishRequestKey);
}

export function persistPublishRequest(request) {
  state.publishRequest = request;
  window.RWPublishService.persistRequest(localStorage, publishRequestKey, request);
}

async function refreshPublishRequest(request, signal) {
  const publishGithub = signal
    ? (endpoint, options = {}) => github(endpoint, { ...options, signal })
    : github;
  const status = await workflowGeprueft(
    await window.RWPublishService.fetchStatus(publishGithub, window.RWPublishStatus, repo.publishBranch, request),
    request
  );
  state.publishStatus = status;
  state.publishInFlight = status.state === "queued" || status.state === "running";

  if (status.state === "success") {
    const changes = await refreshPublishState();
    clearPublishTracking();
    state.publishStatus = status;
    renderSyncState(changes);
    showStatus(changes.length ? "Veröffentlicht. Neuere Änderungen bleiben in der Warteschlange." : status.message);
    return status;
  }

  if (status.state === "failed") {
    // Keep the failure visible for this session, but do not restore the same
    // completed run on every later page load.
    window.RWPublishService.clearRequest(localStorage, publishRequestKey);
    state.publishRequest = null;
    state.publishInFlight = false;
    renderSyncState(Array.from(state.changes.values()));
    showStatus(status.message, "error");
    return status;
  }

  renderSyncState(Array.from(state.changes.values()));
  return status;
}

// Ein „vorgemerkt" ohne Lauf kann zweierlei heissen: Der Lauf ist noch nicht sichtbar, oder er
// wird nie kommen, weil der Workflow entschieden hat, gar nicht zu bauen. Nur der Workflow kann
// die beiden auseinanderhalten — bis ein Lauf existiert, ist er die einzige Quelle.
async function workflowGeprueft(status, request) {
  if (status.state !== "queued" || status.runId || !request.workflowId) return status;
  const lauf = await window.RWPublishService.fetchWorkflowState(request.workflowId);
  if (!lauf) return status;

  if (lauf.output?.status === "veraltet") {
    return { state: "failed", message: "Der geprüfte Stand war nicht mehr aktuell. Bitte neu laden und erneut veröffentlichen." };
  }
  if (lauf.status === "errored" || lauf.status === "terminated") {
    return { state: "failed", message: `Die Veröffentlichung wurde abgebrochen: ${lauf.error?.message || lauf.status}` };
  }
  return status;
}

export async function pollPublishCompletion(token, request) {
  state.publishPollController?.abort();
  const controller = new AbortController();
  state.publishPollController = controller;
  await window.RWPublishService.poll({
    read: () => refreshPublishRequest(request, controller.signal),
    delay,
    shouldContinue: () => token === state.publishPollToken && !controller.signal.aborted,
    onStatus: async (status) => {
      if (status.state === "failed") {
        state.publishStatus = status;
        state.publishInFlight = false;
        renderSyncState(Array.from(state.changes.values()));
      }
    },
    onError: async (error) => {
      if (error?.name === "AbortError" || controller.signal.aborted) return true;
      if (!isTransientGitHubError(error)) {
        state.publishStatus = { state: "failed", message: `Veröffentlichungsstatus konnte nicht gelesen werden: ${error.message}` };
        state.publishInFlight = false;
        renderSyncState(Array.from(state.changes.values()));
        return true;
      }
      return false;
    }
  });
}

export async function resumePublish() {
  const request = storedPublishRequest()
    || await window.RWPublishService.discoverActiveRequest(github, repo.publishBranch);
  if (!request) return;
  state.publishRequest = request;
  state.publishInFlight = true;
  state.publishStartedCount = Number(
    request.visibleChangeCount || visibleQueueChanges(Array.from(state.changes.values())).length || request.changeCount || 0
  );
  state.publishStartedSignatures = new Set(request.signatures || []);
  state.publishStatus = { state: "queued", message: "Restoring publish status from GitHub" };
  state.publishPollToken += 1;
  renderSyncState(Array.from(state.changes.values()));
  pollPublishCompletion(state.publishPollToken, request);
}
