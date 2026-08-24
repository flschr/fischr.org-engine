import { t } from "./00a-i18n.js";
import { els } from "./01b-elements.js";
import { state } from "./01c-state.js";
import { githubConnectionError, sessionHasGithubAccess, tokenHasGithubAccess } from "./05-github-auth.js";

// --- Connection ----------------------------------------------------------

export function updateConnectionState() {
  const sessionConnected = sessionHasGithubAccess();
  const fallbackConnected = tokenHasGithubAccess();
  const connected = sessionConnected || fallbackConnected;
  const authError = githubConnectionError();
  const needsReconnectUser = Boolean(!sessionConnected && state.session?.login && state.session?.authorizationError);
  els.connectionDot.classList.toggle("is-connected", connected);
  els.connectionDot.setAttribute("title", connected ? t("connection.connected") : t("connection.notConnected"));
  if (els.connectionState) els.connectionState.textContent = connected ? t("connection.connected").toLowerCase() : t("connection.notConnected").toLowerCase();
  if (els.connectionText) {
    els.connectionText.textContent = sessionConnected
      ? t("connection.githubConnected")
      : fallbackConnected
        ? t("connection.tokenConnected")
        : authError
          ? t("connection.reconnectHint", { error: authError })
          : state.session?.configured
            ? t("connection.signInPrompt")
            : t("connection.oauthNotConfigured");
  }
  if (els.connectionUser) {
    els.connectionUser.hidden = !(sessionConnected || needsReconnectUser);
    els.connectionUser.textContent = sessionConnected
      ? t("connection.signedInAs", { login: state.session.login || "github" })
      : needsReconnectUser
        ? t("connection.needsReconnect", { login: state.session.login })
      : "";
  }
  if (els.loginButton) els.loginButton.hidden = sessionConnected || !state.session?.configured;
  if (els.logoutButton) els.logoutButton.hidden = !state.session?.authenticated;
  if (els.tokenFallback) els.tokenFallback.hidden = Boolean(state.session?.configured);
  if (els.clearTokenButton) els.clearTokenButton.disabled = !fallbackConnected;
}
