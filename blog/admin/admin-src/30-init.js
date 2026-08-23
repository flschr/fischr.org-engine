import { collections, isTransientGitHubError } from "./01-bootstrap.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { renderFormatToolbar } from "./02a-toolbar-render.js";
import { initKeyboardInset } from "./02d-keyboard-inset.js";
import { showStatus } from "./03-status.js";
import { ensureDraftsBranch, loadAdminSnapshot } from "./04-drafts.js";
import { loadChanges } from "./04a-draft-writes.js";
import { githubConnectionError, hasGithubAccess, refreshSession, sessionHasGithubAccess, verifyStoredTokenAccess } from "./05-github-auth.js";
import { loadSocialConfig } from "./10-social-editor.js";
import { applyStatsTabVisibility, statsEnabled } from "./21-stats.js";
import { backToLibrary, showView, updateNav } from "./23-routing.js";
import { replaceNav, routeTo } from "./24-history.js";
import { refreshEntries } from "./25-entries.js";
import { recoverPendingMediaOperations } from "./26d-publish-sync.js";
import { resumePublish } from "./27a-publish-state.js";
import { updateConnectionState } from "./28-connection.js";
import { wireEvents } from "./29-events.js";

// --- Init ----------------------------------------------------------------

async function loadInitialGithubContent() {
  let snapshotLoaded = false;
  if (sessionHasGithubAccess()) {
    try {
      snapshotLoaded = await loadAdminSnapshot();
    } catch {
      snapshotLoaded = false;
    }
  }
  if (hasGithubAccess() && !snapshotLoaded) await ensureDraftsBranch();
  try {
    await loadChanges();
    await refreshEntries(!snapshotLoaded);
  } finally {
    state.startupSnapshotActive = false;
  }
}

function handleInitialLoadError(error) {
  if (!isTransientGitHubError(error)) {
    showStatus(`Start fehlgeschlagen: ${error.message}`, "error");
    return;
  }

  showStatus("GitHub ist vorübergehend nicht erreichbar. Du bleibst angemeldet; neuer Versuch läuft automatisch.", "error");
  window.clearTimeout(state.startRetryTimer);
  state.startRetryTimer = window.setTimeout(async () => {
    try {
      await loadInitialGithubContent();
      state.startRetryTimer = null;
      showStatus("GitHub ist wieder erreichbar. Inhalte wurden geladen.");
    } catch (retryError) {
      handleInitialLoadError(retryError);
    }
  }, 12000);
}

// A reload should land where the reader was, not on the default list. The
// browser keeps history.state across F5, so it is the record of the current
// view — and the only one, now that tab switches replace rather than push.
function resumeTarget() {
  const saved = history.state;
  if (!saved || !saved.rw) return null;
  const isDefaultList = saved.rw === "library" && (saved.collection || "posts") === "posts";
  return isDefaultList ? null : saved;
}

async function resumeView(target, configReady) {
  if (!target) return;
  // Stats visibility is derived from the config, so it has to be loaded before
  // we can tell whether this view may be entered at all. Settings does not
  // need the wait — openSocialConfig re-fetches with force either way.
  if (target.rw === "stats") {
    await configReady;
    // openStats() has no guard of its own: the hidden tab was what kept the
    // view unreachable, and restoring bypasses the tab entirely. Without this
    // a reload would land on stats with no tab marked to lead back out.
    if (!statsEnabled()) return;
  }
  // navigating: the view is being restored, not newly entered, so routeTo's
  // pushNav must not stack a second entry on top of the one we came back to.
  state.navigating = true;
  try {
    await routeTo(target);
    replaceNav();
  } catch (error) {
    // A deleted entry or an unreachable view falls back to the list we are on.
    showStatus(`Ansicht konnte nicht wiederhergestellt werden: ${error.message}`, "error");
    backToLibrary();
    replaceNav();
  } finally {
    state.navigating = false;
  }
}

async function init() {
  // Read before showView/replaceNav below overwrite it.
  const resumed = resumeTarget();
  renderFormatToolbar();
  initKeyboardInset();
  await refreshSession();
  await verifyStoredTokenAccess();
  wireEvents();
  if (state.token && els.tokenInput) els.tokenInput.value = state.token;
  updateConnectionState();
  updateNav();
  els.libraryTitle.textContent = collections.posts.title;
  showView("library");
  replaceNav();

  const configReady = hasGithubAccess()
    ? loadSocialConfig().then(applyStatsTabVisibility).catch(() => {})
    : Promise.resolve();

  try {
    await loadInitialGithubContent();
    await resumeView(resumed, configReady);
    if (hasGithubAccess()) recoverPendingMediaOperations().catch((error) => {
      showStatus(`Wiederaufnahme der Bildverarbeitung fehlgeschlagen: ${error.message}`, "error");
    });
    if (hasGithubAccess()) await resumePublish();
    if (!hasGithubAccess()) {
      const error = githubConnectionError();
      showStatus(error || (state.session?.configured ? "Melde dich bei GitHub an, um Inhalte zu laden." : "GitHub-Verbindung fehlt."), error ? "error" : undefined);
    }
  } catch (error) {
    handleInitialLoadError(error);
  }
}

init();
