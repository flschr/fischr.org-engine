import { repo, tokenKey } from "./00-konstanten.js";
import { t } from "./00a-i18n.js";

import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { showStatus } from "./03-status.js";
import { fetchBranchTree } from "./04-drafts.js";
import { writeAutosave } from "./19-recovery.js";

// --- GitHub --------------------------------------------------------------

export function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function fetchTree(force) {
  return fetchBranchTree(repo.branch, "tree", "treeHeadSha", force);
}

export function sessionHasGithubAccess() {
  return Boolean(state.session?.authenticated && state.session?.authorized !== false);
}

export function tokenHasGithubAccess() {
  return Boolean(state.token && !state.session?.configured);
}

export function hasGithubAccess() {
  return Boolean(sessionHasGithubAccess() || tokenHasGithubAccess());
}

function normalizeSession(payload = {}) {
  return {
    authenticated: Boolean(payload.authenticated),
    authorized: Boolean(payload.authenticated && payload.authorized !== false),
    configured: Boolean(payload.configured),
    login: payload.login || "",
    name: payload.name || "",
    repository: payload.repository || "",
    authorizationError: payload.authorizationError || ""
  };
}

export function githubConnectionError() {
  return state.session?.authorizationError || state.tokenAuthorizationError || "";
}

export function focusGithubConnection() {
  if (state.session?.configured && els.loginButton && !els.loginButton.hidden) {
    els.loginButton.focus();
    return;
  }
  if (els.tokenInput && !els.tokenFallback?.hidden) els.tokenInput.focus();
}

export function requireGithubAccess(action = t("action.saving")) {
  if (hasGithubAccess()) return true;
  writeAutosave();
  const error = githubConnectionError();
  const message = t("auth.reconnectPrompt", { action });
  showStatus(error ? `${error} ${message}` : message, "error");
  focusGithubConnection();
  return false;
}

export async function validateTokenAccess(token) {
  if (!token) throw new Error(t("auth.tokenMissing"));

  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) throw new Error(await githubRepositoryError(response));

  const repository = await response.json();
  const permissions = repository.permissions || {};
  if (!permissions.admin && !permissions.maintain && !permissions.push) {
    throw new Error(t("auth.noWriteAccess", { repo: `${repo.owner}/${repo.name}` }));
  }

  return repository;
}

async function githubRepositoryError(response) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = payload.message ? `: ${payload.message}` : "";
  } catch (error) {
    detail = "";
  }
  return t("auth.notVerified", { status: response.status, detail });
}

export async function verifyStoredTokenAccess() {
  state.tokenAuthorizationError = "";
  if (!state.token || state.session?.configured) return;

  try {
    await validateTokenAccess(state.token);
  } catch (error) {
    state.tokenAuthorizationError = error.message;
    state.token = "";
    sessionStorage.removeItem(tokenKey);
    if (els.tokenInput) els.tokenInput.value = "";
  }
}

export async function refreshSession() {
  try {
    const response = await fetch("/api/admin/auth/session", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Session ${response.status}`);
    state.session = normalizeSession(await response.json());
    if (state.session.configured) {
      state.token = "";
      sessionStorage.removeItem(tokenKey);
      if (els.tokenInput) els.tokenInput.value = "";
    }
  } catch {
    state.session = { authenticated: false, authorized: false, configured: false };
  }
}
