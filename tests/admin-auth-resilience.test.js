const assert = require("node:assert/strict");
const test = require("node:test");
const readAdminSource = require("./helpers/admin-source");
const { createClient } = require("../blog/admin/github-service.js");

let session;
test.before(async () => {
  session = await import("../functions/api/admin/auth/session.js");
});

const sessionContext = () => ({
  request: new Request("https://mysite.example/api/admin/auth/session"),
  env: { ADMIN_REPOSITORY: "example/example-blog" }
});

const validSession = { token: "sealed-token", login: "flschr", name: "René", repository: "example/example-blog" };

test("a GitHub outage does not sign out a valid admin session", async () => {
  const response = await session.handleSessionRequest(sessionContext(), {
    readSession: async () => validSession,
    fetch: async () => Response.json({ message: "Server Error" }, { status: 500 })
  });

  const body = await response.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.authorized, true, "a 500 from GitHub must not cost the user their session");
  assert.equal(response.headers.get("Set-Cookie"), null, "the session cookie must survive an outage");
});

test("a rate-limited admin keeps working", async () => {
  const response = await session.handleSessionRequest(sessionContext(), {
    readSession: async () => validSession,
    fetch: async () => Response.json({ message: "API rate limit exceeded" }, { status: 429 })
  });

  const body = await response.json();
  assert.equal(body.authorized, true);
  assert.equal(response.headers.get("Set-Cookie"), null);
});

test("a revoked token clears the session cookie", async () => {
  const response = await session.handleSessionRequest(sessionContext(), {
    readSession: async () => validSession,
    fetch: async () => Response.json({ message: "Bad credentials" }, { status: 401 })
  });

  const body = await response.json();
  assert.equal(body.authorized, false);
  assert.equal(body.authenticated, false);
  assert.match(response.headers.get("Set-Cookie") || "", /=;|Max-Age=0/);
});

test("losing write access revokes authorization without pretending it is temporary", async () => {
  const response = await session.handleSessionRequest(sessionContext(), {
    readSession: async () => validSession,
    fetch: async () => Response.json({ permissions: { push: false } }, { status: 200 })
  });

  const body = await response.json();
  assert.equal(body.authorized, false);
  assert.match(body.authorizationError, /write access/);
});

function transientClient({ status, failures = Infinity, method = "GET" }) {
  const attempts = [];
  const github = createClient({
    repository: { owner: "example", name: "mysite.example" },
    getAccess: () => ({ proxy: true }),
    wait: async () => {},
    fetchImpl: async (url, init) => {
      attempts.push(init.method);
      if (attempts.length > failures) return Response.json({ ok: true }, { status: 200 });
      return Response.json({ message: "temporary" }, { status });
    }
  });
  return { attempts, call: () => github("git/refs/heads/drafts", method === "GET" ? {} : { method, body: {} }) };
}

test("transient GitHub reads are retried", async () => {
  const { attempts, call } = transientClient({ status: 500, failures: 3 });
  await call();
  assert.equal(attempts.length, 4, "three failures must still produce a result");
});

test("a read gives up after four attempts instead of hanging", async () => {
  const { attempts, call } = transientClient({ status: 503 });
  await assert.rejects(call, /GitHub 503/);
  assert.equal(attempts.length, 4);
});

test("writes are never retried", async () => {
  // A retried POST can commit the same change twice. The write must fail loudly instead.
  const { attempts, call } = transientClient({ status: 500, method: "POST" });
  await assert.rejects(call, /GitHub 500/);
  assert.equal(attempts.length, 1);
});

test("a permanent error is not mistaken for an outage", async () => {
  const { attempts, call } = transientClient({ status: 404 });
  await assert.rejects(call, /GitHub 404/);
  assert.equal(attempts.length, 1);
});

test("admin keeps retrying startup after a temporary GitHub outage", () => {
  // Still a source assertion: this behaviour lives in blog/admin/admin-src/*.part, which is
  // concatenated into one IIFE without exports and cannot be imported. Converting it needs either
  // a module boundary for the admin parts or a browser spec — see the note in the commit.
  const adminSource = readAdminSource();

  assert.match(adminSource, /function handleInitialLoadError\(error\)/);
  assert.match(adminSource, /Du bleibst angemeldet; neuer Versuch läuft automatisch/);
  assert.match(adminSource, /state\.startRetryTimer = window\.setTimeout/);
  assert.match(adminSource, /await loadInitialGithubContent\(\)/);
});
