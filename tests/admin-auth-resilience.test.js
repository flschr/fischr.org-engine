const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const readAdminSource = require("./helpers/admin-source");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("transient GitHub failures do not sign out a valid admin session", () => {
  const sessionSource = source("functions/api/admin/auth/session.js");

  assert.match(sessionSource, /response\.status === 429 \|\| response\.status >= 500/);
  assert.match(sessionSource, /return \{ authorized: true, clearSession: false, message \}/);
});

test("admin retries transient GitHub reads without repeating writes", () => {
  const adminSource = source("blog/admin/github-service.js");

  assert.match(adminSource, /const attempts = method === "GET" \? 4 : 1/);
  assert.match(adminSource, /isTransientStatus\(response\.status\)/);
});

test("admin keeps retrying startup after a temporary GitHub outage", () => {
  const adminSource = readAdminSource();

  assert.match(adminSource, /function handleInitialLoadError\(error\)/);
  assert.match(adminSource, /Du bleibst angemeldet; neuer Versuch läuft automatisch/);
  assert.match(adminSource, /state\.startRetryTimer = window\.setTimeout/);
  assert.match(adminSource, /await loadInitialGithubContent\(\)/);
});
