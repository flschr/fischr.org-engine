import {
  adminRepository,
  clearStateCookie,
  createSessionCookie,
  exchangeCodeForToken,
  githubRepository,
  githubUser,
  hasRepositoryWriteAccess,
  jsonResponse,
  oauthConfigured,
  readStateCookie,
  redirectResponse,
  safeReturnTo
} from "../../../_admin-auth.js";

export async function onRequest(context) {
  if (!oauthConfigured(context.env)) {
    return jsonResponse({ error: "GitHub OAuth is not configured." }, { status: 503 });
  }

  const requestUrl = new URL(context.request.url);
  const code = requestUrl.searchParams.get("code") || "";
  const state = requestUrl.searchParams.get("state") || "";
  const [expectedState, returnTo = "/admin/"] = readStateCookie(context.request).split("|");

  if (!code || !state || !expectedState || state !== expectedState) {
    return jsonResponse({ error: "Invalid GitHub OAuth state." }, {
      status: 400,
      headers: { "Set-Cookie": clearStateCookie() }
    });
  }

  try {
    const token = await exchangeCodeForToken({
      code,
      redirectUri: `${requestUrl.origin}/api/admin/auth/callback`
    }, context.env);
    const [user, repository] = await Promise.all([
      githubUser(token.access_token),
      githubRepository(token.access_token, context.env)
    ]);

    if (!hasRepositoryWriteAccess(repository)) {
      return jsonResponse({
        error: `GitHub account does not have write access to ${adminRepository(context.env)}.`
      }, {
        status: 403,
        headers: { "Set-Cookie": clearStateCookie() }
      });
    }

    const sessionCookie = await createSessionCookie({
      login: user.login || "",
      name: user.name || "",
      repository: adminRepository(context.env),
      scope: token.scope || "",
      token: token.access_token
    }, context.env);

    return redirectResponse(safeReturnTo(returnTo), {
      "Set-Cookie": [sessionCookie, clearStateCookie()]
    });
  } catch (error) {
    return jsonResponse({ error: error.message || "GitHub OAuth failed." }, {
      status: 502,
      headers: { "Set-Cookie": clearStateCookie() }
    });
  }
}
