import {
  adminRepository,
  clearSessionCookie,
  githubHeaders,
  hasRepositoryWriteAccess,
  jsonResponse,
  oauthConfigured,
  readSession
} from "../../../_admin-auth.js";

export async function onRequest(context) {
  const configured = oauthConfigured(context.env);
  const session = await readSession(context.request, context.env);

  if (!session) {
    return jsonResponse({
      authenticated: false,
      authorized: false,
      configured,
      login: "",
      name: "",
      repository: ""
    });
  }

  const verification = await verifyGitHubAccess(session, context.env);

  if (!verification.authorized) {
    const headers = verification.clearSession ? { "Set-Cookie": clearSessionCookie() } : {};
    return jsonResponse({
      authenticated: !verification.clearSession,
      authorized: false,
      configured,
      login: session.login || "",
      name: session.name || "",
      repository: session.repository || adminRepository(context.env),
      authorizationError: verification.message
    }, { headers });
  }

  return jsonResponse({
    authenticated: true,
    authorized: true,
    configured,
    login: session.login || "",
    name: session.name || "",
    repository: session.repository || adminRepository(context.env)
  });
}

async function verifyGitHubAccess(session, env = {}) {
  try {
    const repositoryName = adminRepository(env);
    const response = await fetch(`https://api.github.com/repos/${repositoryName}`, {
      headers: githubHeaders(session.token)
    });

    if (!response.ok) {
      const message = await githubErrorMessage(response);
      // GitHub outages and rate limits do not invalidate a valid sealed
      // session. Keep the user signed in; actual API reads can retry and show
      // the temporary service error without turning it into a login problem.
      if (response.status === 429 || response.status >= 500) {
        return { authorized: true, clearSession: false, message };
      }
      return {
        authorized: false,
        clearSession: response.status === 401 || response.status === 404,
        message
      };
    }

    const repository = await response.json();
    if (!hasRepositoryWriteAccess(repository)) {
      return {
        authorized: false,
        clearSession: true,
        message: `GitHub no longer grants write access to ${repositoryName}.`
      };
    }

    return { authorized: true, clearSession: false, message: "" };
  } catch {
    return {
      authorized: false,
      clearSession: false,
      message: "GitHub authorization could not be verified. Check the connection and sign in again before editing."
    };
  }
}

async function githubErrorMessage(response) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = payload.message ? `: ${payload.message}` : "";
  } catch {
    detail = "";
  }
  return `GitHub authorization could not be verified (${response.status}${detail}).`;
}
