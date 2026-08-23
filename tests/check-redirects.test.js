// Der Weiterleitungsprüfer war das Werkzeug, mit dem die Workers-Migration abgenommen wurde —
// und hatte selbst keine Abdeckung. Ein Prüfwerkzeug, das stillschweigend nichts prüft, ist
// schlimmer als keines: es hätte die Migration abgenickt, ohne eine einzige Regel anzusehen.
//
// Geprüft wird deshalb beides: dass es echte Abweichungen findet, und dass es an einer
// korrekten Datei nicht grundlos anschlägt.

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const projectRoot = path.join(__dirname, "..");

// Ein Server, der genau die Weiterleitungen beantwortet, die er bekommen hat — das Gegenstück
// zu dem, was Workers aus einer _redirects-Datei macht.
function startRedirectingServer(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(route.status, { Location: route.location });
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

// Das Skript liest _site/_redirects relativ zum Arbeitsverzeichnis, nicht zum Repository.
function projectWith(redirects) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-redirects-"));
  fs.mkdirSync(path.join(root, "_site"), { recursive: true });
  fs.writeFileSync(path.join(root, "_site/_redirects"), redirects);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, "scripts/check-redirects.js"), path.join(root, "scripts/check-redirects.js"));
  return root;
}

function run(root, baseUrl) {
  return execFileAsync("node", ["scripts/check-redirects.js", baseUrl], { cwd: root });
}

test("passes when every rule answers with its status and target", async () => {
  const root = projectWith([
    "# ein Kommentar, der übersprungen gehört",
    "",
    "/alt /neu/ 301",
    "/anderswo https://social.example.org/@example 301",
    "/temporaer /woanders/ 302"
  ].join("\n"));

  const server = await startRedirectingServer({
    "/alt": { status: 301, location: "/neu/" },
    "/anderswo": { status: 301, location: "https://social.example.org/@example" },
    "/temporaer": { status: 302, location: "/woanders/" }
  });

  try {
    const { stdout } = await run(root, server.baseUrl);
    assert.match(stdout, /Weiterleitungen geprüft: 3 \(0 mit Platzhalter\)/);
    assert.match(stdout, /Alle Weiterleitungen antworten wie aufgeschrieben\./);
    // Kommentar und Leerzeile dürfen keine Anfrage ausgelöst haben.
    assert.equal(server.requests.length, 3);
  } finally {
    await server.close();
  }
});

test("sets a sample for placeholder rules and expects it in the target", async () => {
  const root = projectWith([
    "/blog/page/:page /page/:page/ 301",
    "/assets/images/uploads/* https://media.example.org/images/uploads/:splat 301"
  ].join("\n"));

  const server = await startRedirectingServer({
    "/blog/page/2": { status: 301, location: "/page/2/" },
    "/assets/images/uploads/beispiel/pfad.webp": {
      status: 301,
      location: "https://media.example.org/images/uploads/beispiel/pfad.webp"
    }
  });

  try {
    const { stdout } = await run(root, server.baseUrl);
    assert.match(stdout, /Weiterleitungen geprüft: 2 \(2 mit Platzhalter\)/);
    assert.match(stdout, /Alle Weiterleitungen antworten wie aufgeschrieben\./);
  } finally {
    await server.close();
  }
});

test("fails on a wrong status, naming the line", async () => {
  const root = projectWith("/alt /neu/ 301\n");
  const server = await startRedirectingServer({ "/alt": { status: 302, location: "/neu/" } });

  try {
    await assert.rejects(run(root, server.baseUrl), (error) => {
      assert.match(error.stderr, /_redirects:1\s+\/alt → Status 302 statt 301/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test("fails on a wrong target, naming both sides", async () => {
  const root = projectWith("/alt /neu/ 301\n");
  const server = await startRedirectingServer({ "/alt": { status: 301, location: "/woanders/" } });

  try {
    await assert.rejects(run(root, server.baseUrl), (error) => {
      assert.match(error.stderr, /Ziel .*\/woanders\/ statt .*\/neu\//);
      return true;
    });
  } finally {
    await server.close();
  }
});

// Der Fall, der die Migration wirklich betrifft: Die Plattform bedient den Pfad mit einer Seite
// statt mit einer Weiterleitung. Ohne Location-Kopfzeile darf das nicht als Erfolg durchgehen.
test("fails when the platform serves a page instead of redirecting", async () => {
  const root = projectWith("/alt /neu/ 301\n");
  const server = await startRedirectingServer({});

  try {
    await assert.rejects(run(root, server.baseUrl), (error) => {
      assert.match(error.stderr, /Status 404 statt 301/);
      return true;
    });
  } finally {
    await server.close();
  }
});

// Eine relative Regel darf absolut beantwortet werden — verglichen wird der aufgelöste Zielpfad,
// nicht die Schreibweise. Ohne das schlüge der Prüfer gegen jede echte Plattform an.
test("accepts an absolute answer to a relatively written rule", async () => {
  const root = projectWith("/alt /neu/ 301\n");
  // Die Route wird erst nach dem Start gesetzt, weil sie die eigene Basis-URL braucht — der
  // Port steht vorher nicht fest.
  const routes = {};
  const server = await startRedirectingServer(routes);
  routes["/alt"] = { status: 301, location: `${server.baseUrl}/neu/` };

  try {
    const { stdout } = await run(root, server.baseUrl);
    assert.match(stdout, /Alle Weiterleitungen antworten wie aufgeschrieben\./);
  } finally {
    await server.close();
  }
});

test("refuses to report success when there is nothing built to check", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-redirects-empty-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, "scripts/check-redirects.js"), path.join(root, "scripts/check-redirects.js"));

  await assert.rejects(run(root, "http://127.0.0.1:1"), (error) => {
    assert.match(error.stderr, /fehlt — erst bauen/);
    return true;
  });
});
