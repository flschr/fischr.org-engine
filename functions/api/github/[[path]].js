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

// Exportiert, damit der Browser-Mock in tests/browser/admin-test-support.js dieselbe Liste
// benutzt. Ein Mock, der mehr durchlässt als der Proxy, macht genau die Fehler unsichtbar, für
// die es ihn gibt: Der Admin rief `actions/runs/<id>` auf, der Mock beantwortete es, die Tests
// waren grün — und im Betrieb kam ein 403, das jede Veröffentlichung als gescheitert meldete.
export function isAllowedEndpoint(endpoint = "") {
  if (!endpoint || endpoint.includes("..")) return false;
  const workflow = endpoint.match(/^actions\/workflows\/([^/]+)\/(?:dispatches|runs)$/);
  if (workflow && ALLOWED_WORKFLOWS.has(workflow[1])) return true;
  // Ein Lauf und seine Schritte. Beides gehört zusammen: Seit das Buch der Veröffentlichungen
  // die Lauf-Nummer kennt, holt der Admin den Lauf direkt, statt ihn in einer Liste zu suchen.
  //
  // Die Nummer allein fehlte hier, die Schritte waren erlaubt — und weil die Statusabfrage mit
  // dem Lauf beginnt, scheiterte sie mit 403, bevor sie zu den Schritten kam. Die Veröffentlichung
  // lief dabei durch; nur ihr Fortschritt war nicht mehr lesbar, und der Admin meldete
  // „fehlgeschlagen" für etwas, das gerade erfolgreich war.
  if (/^actions\/runs\/\d+(?:\/jobs)?(?:\?.*)?$/.test(endpoint)) return true;
  return endpoint.startsWith("contents/") || endpoint.startsWith("git/");
}
