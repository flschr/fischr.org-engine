import {
  adminRepository,
  githubHeaders,
  jsonResponse,
  readSession
} from "../../_admin-auth.js";

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH"]);
const ALLOWED_WORKFLOWS = new Set([
  "admin-normalize-image.yml",
  "admin-prepare-video.yml",
  "admin-publish.yml"
]);

export async function onRequest(context) {
  const session = await readSession(context.request, context.env);
  if (!session) {
    return jsonResponse({ message: "Not authenticated." }, { status: 401 });
  }

  const requestUrl = new URL(context.request.url);
  const endpoint = requestUrl.pathname.replace(/^\/api\/github\/?/, "");

  if (!isAllowedEndpoint(endpoint) || !ALLOWED_METHODS.has(context.request.method)) {
    return jsonResponse({ message: "GitHub endpoint is not allowed." }, { status: 403 });
  }

  const upstreamUrl = new URL(`https://api.github.com/repos/${adminRepository(context.env)}/${endpoint}`);
  upstreamUrl.search = requestUrl.search;

  const headers = githubHeaders(session.token);
  const init = { method: context.request.method, headers };
  if (!["GET", "HEAD"].includes(context.request.method)) {
    headers["Content-Type"] = context.request.headers.get("Content-Type") || "application/json";
    init.body = await context.request.text();
  }

  const response = await fetch(upstreamUrl.toString(), init);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Cache-Control", "private, no-store");
  responseHeaders.delete("Set-Cookie");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}

function isAllowedEndpoint(endpoint = "") {
  if (!endpoint || endpoint.includes("..")) return false;
  const workflow = endpoint.match(/^actions\/workflows\/([^/]+)\/(?:dispatches|runs)$/);
  if (workflow && ALLOWED_WORKFLOWS.has(workflow[1])) return true;
  if (/^actions\/runs\/\d+\/jobs(?:\?.*)?$/.test(endpoint)) return true;
  return endpoint.startsWith("contents/") || endpoint.startsWith("git/");
}
