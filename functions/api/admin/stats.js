import { adminRepository, githubHeaders, jsonResponse, readSession } from "../../_admin-auth.js";

// GoatCounter stats proxy.
//
// The GoatCounter API token has *admin* rights, so it must never reach the
// browser. This function holds it as a Cloudflare secret, gates every call
// behind the existing admin session, and only ever returns the read-only stats
// the dashboard needs. The browser talks to /api/admin/stats, never to
// GoatCounter directly (which would also be blocked by CORS).
//
// On/off and the GoatCounter URL are configured in the admin Settings and live
// in the committed automation/social-config.json (a public repo) — only the
// token is a Cloudflare secret. The URL is read here from that committed config
// (the server-side source of truth), never trusted from the client, so the
// admin token is only ever sent to the host the owner configured.
const DEFAULT_BASE = "https://stats.example.com";
const CONFIG_PATH = "automation/social-config.json";

// The breakdown panels share the generic /stats/{page} shape.
const BREAKDOWNS = ["toprefs", "browsers", "systems", "locations"];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: "unauthorized" }, { status: 401 });

  // Lightweight status probe for the Settings UI: is the token configured?
  if (url.searchParams.get("probe")) {
    return jsonResponse({ tokenConfigured: Boolean(env.GOATCOUNTER_STATS_TOKEN) });
  }

  // Distinct from GOATCOUNTER_API_TOKEN (used by feed.xml.js to *record* feed
  // fetches). This dashboard needs a *read statistics* token, so it gets its own
  // secret — the two have different GoatCounter permissions and must not share.
  const token = env.GOATCOUNTER_STATS_TOKEN;
  if (!token) {
    return jsonResponse({ error: "GoatCounter stats token is not configured." }, { status: 503 });
  }

  const config = await readStatsConfig(env, session.token);
  if (config.enabled === false) {
    return jsonResponse({ error: "Stats are turned off in settings." }, { status: 403 });
  }

  const base = (config.url || env.GOATCOUNTER_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const call = async (path, params = {}) => {
    const query = new URLSearchParams();
    if (start) query.set("start", start);
    if (end) query.set("end", end);
    Object.entries(params).forEach(([key, value]) => query.set(key, value));
    const target = `${base}/api/v0/stats/${path}?${query}`;

    // GoatCounter rate-limits the API. Retry on 429/5xx with backoff, honouring
    // a Retry-After header when present, so a throttled panel recovers instead
    // of silently coming back empty.
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(target, { headers });
      if (response.ok) return response.json();
      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable || attempt >= 4) throw new Error(`${path} → ${response.status}`);
      const retryAfter = Number(response.headers.get("Retry-After"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 300 * 2 ** attempt; // 300, 600, 1200, 2400 ms
      await sleep(waitMs);
    }
  };

  // Drill-down, lazily requested when a row is expanded:
  //   path_id → referrers for that page      (GET /stats/hits/{path_id} → .refs)
  //   ref_id  → source URLs for that referrer (GET /stats/toprefs/{id}  → .stats)
  // Both are normalised to { rows: [{name, count}] } for the dashboard.
  const pathId = url.searchParams.get("path_id");
  const refId = url.searchParams.get("ref_id");
  if (pathId || refId) {
    try {
      let data;
      if (pathId) {
        if (!/^\d+$/.test(pathId)) return jsonResponse({ error: "invalid path_id" }, { status: 400 });
        data = await call(`hits/${pathId}`, { limit: "10" });
      } else {
        data = await call(`toprefs/${encodeURIComponent(refId)}`, { limit: "10" });
      }
      const list = data.refs || data.stats || [];
      const rows = list.map((row) => ({ name: row.name, count: Number(row.count) || 0 }));
      return jsonResponse({ rows, more: Boolean(data.more) });
    } catch (error) {
      return jsonResponse({ error: `GoatCounter request failed: ${error.message || error}` }, { status: 502 });
    }
  }

  // Sequential, not parallel: firing all six at once trips GoatCounter's
  // per-second rate limit, which used to blank a random subset of panels on
  // every refresh. One after another stays comfortably under the limit.
  const requests = [
    ["total", {}],
    ["hits", { limit: "10" }],
    ...BREAKDOWNS.map((page) => [page, { limit: page === "locations" ? "8" : "6" }])
  ];

  const results = {};
  const failures = [];
  for (const [path, params] of requests) {
    try {
      results[path] = await call(path, params);
    } catch (error) {
      results[path] = null;
      failures.push(error.message || String(error));
    }
  }

  // Only treat it as a hard error if the headline numbers both failed; a single
  // missing breakdown still renders the rest of the dashboard.
  if (results.total === null && results.hits === null) {
    return jsonResponse(
      { error: `GoatCounter request failed: ${failures[0] || "unknown error"}` },
      { status: 502 }
    );
  }

  return jsonResponse(results);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Read the Stats settings (enabled + GoatCounter URL) from the committed config
// on the published branch, using the admin's own GitHub token. Returns {} on any
// failure so the dashboard falls back to env defaults rather than breaking.
async function readStatsConfig(env, githubToken) {
  if (!githubToken) return {};
  try {
    const repo = adminRepository(env);
    const branch = env.ADMIN_PUBLISH_BRANCH || "main";
    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${CONFIG_PATH}?ref=${encodeURIComponent(branch)}`,
      { headers: githubHeaders(githubToken) }
    );
    if (!response.ok) return {};
    const payload = await response.json();
    const bytes = Uint8Array.from(atob(String(payload.content || "").replace(/\s/g, "")), (ch) => ch.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes));
    const stats = json && typeof json === "object" ? json.stats : null;
    if (!stats || typeof stats !== "object") return {};
    const rawUrl = typeof stats.url === "string" ? stats.url.trim() : "";
    return {
      enabled: stats.enabled !== false, // default on when the key is absent
      url: isHttpsUrl(rawUrl) ? rawUrl : ""
    };
  } catch {
    return {};
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
