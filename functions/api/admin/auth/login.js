import {
  createStateCookie,
  oauthConfig,
  oauthConfigured,
  redirectResponse,
  safeReturnTo
} from "../../../_admin-auth.js";

export function onRequest(context) {
  if (!oauthConfigured(context.env)) {
    return redirectResponse("/admin/");
  }

  const requestUrl = new URL(context.request.url);
  const config = oauthConfig(context.env);
  const state = crypto.randomUUID();
  const returnTo = safeReturnTo(requestUrl.searchParams.get("return_to"));
  const redirectUri = `${requestUrl.origin}/api/admin/auth/callback`;
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");

  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", config.scope);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "false");

  return redirectResponse(authorizeUrl.toString(), {
    "Set-Cookie": createStateCookie(`${state}|${returnTo}`)
  });
}
