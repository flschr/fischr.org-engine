const DEFAULT_REPOSITORY = "example/example-blog";
const SESSION_COOKIE = "rw_admin_session";
const STATE_COOKIE = "rw_oauth_state";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const STATE_MAX_AGE = 60 * 10;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function adminRepository(env = {}) {
  return env.ADMIN_GITHUB_REPO || DEFAULT_REPOSITORY;
}

export function oauthConfig(env = {}) {
  return {
    clientId: env.GITHUB_OAUTH_CLIENT_ID || env.GITHUB_CLIENT_ID || "",
    clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET || "",
    repository: adminRepository(env),
    scope: env.GITHUB_OAUTH_SCOPE || "public_repo workflow",
    sessionSecret: env.ADMIN_SESSION_SECRET || env.GITHUB_OAUTH_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET || ""
  };
}

export function oauthConfigured(env = {}) {
  const config = oauthConfig(env);
  return Boolean(config.clientId && config.clientSecret && config.sessionSecret);
}

export function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator === -1
          ? [part, ""]
          : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

export async function readSession(request, env = {}) {
  const value = parseCookies(request)[SESSION_COOKIE];
  if (!value || !oauthConfigured(env)) return null;

  try {
    const session = await unseal(value, sessionSecret(env));
    if (!session?.token || session.expiresAt < Date.now()) return null;
    if (!hasRequiredOauthScopes(session.scope, oauthConfig(env).scope)) return null;
    return session;
  } catch {
    return null;
  }
}

function hasRequiredOauthScopes(granted = "", required = "") {
  const grantedScopes = oauthScopeSet(granted);
  return [...oauthScopeSet(required)].every((scope) => {
    if (grantedScopes.has(scope)) return true;
    return scope === "public_repo" && grantedScopes.has("repo");
  });
}

function oauthScopeSet(value = "") {
  return new Set(String(value).split(/[\s,]+/).filter(Boolean));
}

export async function createSessionCookie(session, env = {}) {
  const value = await seal({
    ...session,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_MAX_AGE * 1000
  }, sessionSecret(env));

  return cookieHeader(SESSION_COOKIE, value, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE,
    path: "/",
    sameSite: "Lax",
    secure: true
  });
}

export function clearSessionCookie() {
  return cookieHeader(SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure: true
  });
}

export function createStateCookie(value) {
  return cookieHeader(STATE_COOKIE, value, {
    httpOnly: true,
    maxAge: STATE_MAX_AGE,
    path: "/api/admin/auth/callback",
    sameSite: "Lax",
    secure: true
  });
}

export function clearStateCookie() {
  return cookieHeader(STATE_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/api/admin/auth/callback",
    sameSite: "Lax",
    secure: true
  });
}

export function readStateCookie(request) {
  return parseCookies(request)[STATE_COOKIE] || "";
}

export function safeReturnTo(value) {
  const fallback = "/admin/";
  if (!value || typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (!value.startsWith("/admin")) return fallback;
  return value;
}

export function authSetupResponse() {
  return new Response("GitHub OAuth is not configured for this admin.", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

export function redirectResponse(location, headers = {}) {
  const responseHeaders = new Headers({
    "Cache-Control": "private, no-store",
    "Location": location
  });
  Object.entries(headers).forEach(([name, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => responseHeaders.append(name, item));
    } else {
      responseHeaders.set(name, value);
    }
  });

  return new Response(null, {
    status: 302,
    headers: responseHeaders
  });
}

export function jsonResponse(payload, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    ...init,
    headers
  });
}

export async function exchangeCodeForToken({ code, redirectUri }, env = {}) {
  const config = oauthConfig(env);
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });

  const payload = await response.json();
  if (!response.ok || payload.error || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `GitHub OAuth ${response.status}`);
  }

  return payload;
}

export async function githubUser(token) {
  const response = await fetch("https://api.github.com/user", {
    headers: githubHeaders(token)
  });
  if (!response.ok) throw new Error(`GitHub user ${response.status}`);
  return response.json();
}

export async function githubRepository(token, env = {}) {
  const response = await fetch(`https://api.github.com/repos/${adminRepository(env)}`, {
    headers: githubHeaders(token)
  });
  if (!response.ok) throw new Error(`GitHub repo ${response.status}`);
  return response.json();
}

export function hasRepositoryWriteAccess(repository = {}) {
  const permissions = repository.permissions || {};
  return Boolean(permissions.admin || permissions.maintain || permissions.push);
}

export async function isGitHubTokenAuthorized(token, env = {}) {
  if (!token) return false;

  try {
    const repository = await githubRepository(token, env);
    return hasRepositoryWriteAccess(repository);
  } catch {
    return false;
  }
}

export function decodeBasicAuth(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Basic\s+(.+)$/i);
  if (!match) return null;

  try {
    const value = atob(match[1]);
    const separator = value.indexOf(":");
    return {
      password: separator === -1 ? value : value.slice(separator + 1),
      raw: value,
      username: separator === -1 ? "" : value.slice(0, separator)
    };
  } catch {
    return null;
  }
}

export function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="mysite.example admin", charset="UTF-8"',
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

export function githubHeaders(token, extra = {}) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "User-Agent": "fischr-admin",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra
  };
}

function sessionSecret(env = {}) {
  return oauthConfig(env).sessionSecret;
}

function cookieHeader(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

async function seal(payload, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}

async function unseal(value, secret) {
  const [ivText, ciphertextText] = String(value || "").split(".");
  if (!ivText || !ciphertextText) throw new Error("Invalid sealed value");

  const key = await encryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64url(ivText) },
    key,
    fromBase64url(ciphertextText)
  );
  return JSON.parse(decoder.decode(plaintext));
}

async function encryptionKey(secret) {
  if (!secret) throw new Error("Missing session secret");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
