import {
  decodeBasicAuth,
  isGitHubTokenAuthorized,
  oauthConfigured,
  readSession,
  redirectResponse,
  unauthorized
} from "../_admin-auth.js";

const publicAdminAssetPaths = new Set([
  "/admin/apple-touch-icon.png",
  "/admin/favicon-32.png",
  "/admin/favicon.ico",
  "/admin/icon-192-maskable.png",
  "/admin/icon-192.png",
  "/admin/icon-512-maskable.png",
  "/admin/icon-512.png",
  "/admin/manifest.webmanifest"
]);

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (publicAdminAssetPaths.has(url.pathname)) {
    return serveAdminAsset(context, { publicAsset: true });
  }

  const session = await readSession(context.request, context.env);
  if (session) return serveAdminAsset(context);

  if (oauthConfigured(context.env)) {
    const returnTo = `${url.pathname}${url.search}`;
    return redirectResponse(`/api/admin/auth/login?return_to=${encodeURIComponent(returnTo)}`);
  }

  const auth = decodeBasicAuth(context.request);
  if (await isGitHubTokenAuthorized(auth?.password, context.env)) {
    return serveAdminAsset(context);
  }

  return unauthorized();
}

async function serveAdminAsset(context, { publicAsset = false } = {}) {
  const url = new URL(context.request.url);
  if (url.pathname === "/admin") {
    return redirectResponse(`${url.origin}/admin/${url.search}`, {
      "Vary": "Authorization, Cookie"
    });
  }

  const response = await context.env.ASSETS.fetch(context.request);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", publicAsset ? "public, max-age=3600" : "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  if (!publicAsset) {
    headers.set("Vary", appendVary(headers.get("Vary"), "Authorization, Cookie"));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function appendVary(current, value) {
  if (!current) return value;

  const currentParts = current.split(",").map((part) => part.trim().toLowerCase());
  const nextParts = value.split(",").map((part) => part.trim());
  const missing = nextParts.filter((part) => !currentParts.includes(part.toLowerCase()));
  return missing.length ? `${current}, ${missing.join(", ")}` : current;
}
