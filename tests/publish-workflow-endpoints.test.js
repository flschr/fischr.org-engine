// Die beiden Endpunkte, über die eine Veröffentlichung beginnt und ihren Zustand meldet.

const assert = require("node:assert/strict");
const test = require("node:test");

let start;
let zustand;
test.before(async () => {
  start = await import("../functions/api/admin/publish/index.js");
  zustand = await import("../functions/api/admin/publish/[id].js");
});

const angemeldet = { readSession: async () => ({ token: "gh-token" }) };
const abgemeldet = { readSession: async () => null };

function anfrage(body) {
  return new Request("https://mysite.example/api/admin/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function workflowStub(instanz = { id: "wf-1" }, status = { status: "running" }) {
  const erzeugt = [];
  return {
    erzeugt,
    binding: {
      create: async (optionen) => { erzeugt.push(optionen); return instanz; },
      get: async (id) => ({ status: async () => ({ ...status, id }) })
    }
  };
}

test("ohne Anmeldung beginnt keine Veröffentlichung", async () => {
  const antwort = await start.handlePublishStart({ request: anfrage({}), env: {} }, abgemeldet);
  assert.equal(antwort.status, 401);
});

// Fehlt die Bindung, ist das ein Konfigurationsproblem und keine gescheiterte
// Veröffentlichung. Ohne eigene Antwort sähe beides gleich aus.
test("eine fehlende Workflow-Bindung meldet sich als solche", async () => {
  const antwort = await start.handlePublishStart({ request: anfrage({}), env: {} }, angemeldet);
  assert.equal(antwort.status, 503);
});

test("eine unvollständige Anfrage benennt, was fehlt", async () => {
  const { binding } = workflowStub();
  const antwort = await start.handlePublishStart(
    { request: anfrage({ requestId: "r1" }), env: { PUBLISH: binding } },
    angemeldet
  );
  assert.equal(antwort.status, 400);
  const koerper = await antwort.json();
  assert.match(koerper.message, /mainSha/);
  assert.match(koerper.message, /draftSha/);
});

test("eine vollständige Anfrage startet eine Instanz und gibt ihre Kennung zurück", async () => {
  const { binding, erzeugt } = workflowStub({ id: "wf-42" });
  const antwort = await start.handlePublishStart(
    {
      request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 3 }),
      env: { PUBLISH: binding, ADMIN_GITHUB_REPO: "example/example-blog" }
    },
    angemeldet
  );

  assert.equal(antwort.status, 202);
  assert.deepEqual(await antwort.json(), { id: "wf-42", status: "gestartet" });
  assert.equal(erzeugt.length, 1);
  assert.deepEqual(erzeugt[0].params, {
    requestId: "r1",
    mainSha: "aaa",
    draftSha: "bbb",
    changeCount: 3,
    repository: "example/example-blog",
    token: "gh-token"
  });
});

test("ohne Anmeldung gibt es keinen Zustand", async () => {
  const antwort = await zustand.handlePublishStatus({ env: {}, params: { id: "wf-1" } }, abgemeldet);
  assert.equal(antwort.status, 401);
});

test("der Zustand einer Instanz wird durchgereicht", async () => {
  const { binding } = workflowStub({ id: "wf-1" }, { status: "complete", output: { status: "fertig" } });
  const antwort = await zustand.handlePublishStatus(
    { env: { PUBLISH: binding }, params: { id: "wf-1" } },
    angemeldet
  );

  assert.equal(antwort.status, 200);
  assert.deepEqual(await antwort.json(), { id: "wf-1", status: "complete", output: { status: "fertig" }, error: null });
});

// Eine unbekannte Kennung ist eine Frage nach etwas, das es nicht gibt — und darf nicht wie ein
// Ausfall aussehen.
test("eine unbekannte Kennung ist ein 404, kein Fehler", async () => {
  const binding = { get: async () => { throw new Error("instance not found"); } };
  const antwort = await zustand.handlePublishStatus(
    { env: { PUBLISH: binding }, params: { id: "gibt-es-nicht" } },
    angemeldet
  );
  assert.equal(antwort.status, 404);
});
