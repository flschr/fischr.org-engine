import { publishRequestKey } from "./00-konstanten.js";
import { t } from "./00a-i18n.js";
import { github, isTransientGitHubError } from "./01-bootstrap.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { loadChanges } from "./04a-draft-writes.js";
import { hasGithubAccess } from "./05-github-auth.js";
import { refreshEntries } from "./25-entries.js";
import { refreshCurrentPublishedState } from "./25c-entry-opening.js";
import { refreshMedia } from "./26a-media-library.js";
import { renderSyncState, visibleQueueChanges } from "./26d-publish-sync.js";
import { clearPublishTracking } from "./27c-queue-render.js";
import { persistPublishRequest, workflowGeprueft } from "./27g-publish-workflow-check.js";

export { persistPublishRequest };

// Every publishStatus shape (from describeRun(), from the endpoints below, or
// built locally) carries messageKey/messageVars in preference to a resolved
// message: a resolved string would freeze in whatever language it was built
// in, and renderQueue() already re-resolves via this same rule on a language
// switch (see 27c-queue-render.js).
export function publishStatusMessage(status) {
  return status?.messageKey ? t(status.messageKey, status.messageVars) : status?.message || "";
}

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
  const request = window.RWPublishService.storedRequest(localStorage, publishRequestKey);
  if (!request) return null;

  // Eine gespeicherte Anfrage ohne Lauf und ohne Instanz stammt aus der Zeit vor dem Buch. Über
  // sie lässt sich nichts mehr erfahren: Sie bliebe zwölf Minuten auf „vorgemerkt" stehen und
  // meldete dann eine Zeitüberschreitung. Verwerfen und im Buch nachsehen ist die einzige
  // Antwort, die stimmen kann.
  if (!request.runId && !request.workflowId) {
    window.RWPublishService.clearRequest(localStorage, publishRequestKey);
    return null;
  }
  return request;
}

async function refreshPublishRequest(request, signal) {
  const publishGithub = signal
    ? (endpoint, options = {}) => github(endpoint, { ...options, signal })
    : github;
  const status = await workflowGeprueft(
    await window.RWPublishService.fetchStatus(publishGithub, window.RWPublishStatus, request),
    request
  );
  state.publishStatus = status;
  state.publishInFlight = status.state === "queued" || status.state === "running";

  if (status.state === "success") {
    // GitHub hat den Lauf abgeschlossen — das ist die Neuigkeit, und sie steht sofort fest.
    // Was an neuen Entwürfen inzwischen nachgekommen ist, weiss erst der Refresh danach; den
    // Toast darauf warten zu lassen, meldete einen längst abgeschlossenen Erfolg erst nach der
    // vollen, seriellen Neuladung von Bäumen, Einträgen und Medien — spürbar später, als die
    // Veröffentlichung tatsächlich fertig war.
    clearPublishTracking();
    state.publishStatus = status;
    showStatus(publishStatusMessage(status));
    refreshPublishState()
      .then((changes) => {
        renderSyncState(changes);
        if (changes.length) showStatus(t("queue.publishedNewerChangesRemain"));
      })
      .catch(() => {});
    return status;
  }

  if (status.state === "failed") {
    // Keep the failure visible for this session, but do not restore the same
    // completed run on every later page load.
    window.RWPublishService.clearRequest(localStorage, publishRequestKey);
    state.publishRequest = null;
    state.publishInFlight = false;
    renderSyncState(Array.from(state.changes.values()));
    showStatus(publishStatusMessage(status), "error");
    return status;
  }

  renderSyncState(Array.from(state.changes.values()));
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
        state.publishStatus = { state: "failed", messageKey: "queue.statusReadFailed", messageVars: { error: error.message } };
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
    || await window.RWPublishService.discoverActiveRequest();
  if (!request) return;
  state.publishRequest = request;
  state.publishInFlight = true;
  state.publishStartedCount = Number(
    request.visibleChangeCount || visibleQueueChanges(Array.from(state.changes.values())).length || request.changeCount || 0
  );
  state.publishStartedSignatures = new Set(request.signatures || []);
  state.publishStatus = { state: "queued", messageKey: "queue.restoringStatus" };
  state.publishPollToken += 1;
  renderSyncState(Array.from(state.changes.values()));
  pollPublishCompletion(state.publishPollToken, request);
}
