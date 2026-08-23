// Die beiden Endpunkte, über die eine Veröffentlichung beginnt und ihren Zustand meldet.

const assert = require("node:assert/strict");
const test = require("node:test");

let start;
let zustand;
test.before(async () => {
  start = await import("../functions/api/admin/publish/index.js");
  zustand = await import("../functions/api/admin/publish/[id].js");
});

// Standardmässig antwortet die Standprüfung mit genau dem Stand, den die Anfrage mitbringt —
// sonst müsste jeder Test, der die Prüfung gar nicht meint, sie trotzdem bedienen.
function kopfStub(sha) {
  return async (url) => {
    if (!/git\/ref\/heads\/main$/.test(String(url))) throw new Error(`Unerwarteter Aufruf: ${url}`);
    if (sha === null) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify({ object: { sha } }), { status: 200 });
  };
}

const angemeldet = { readSession: async () => ({ token: "gh-token" }), fetch: kopfStub("aaa") };
const abgemeldet = { readSession: async () => null, fetch: kopfStub("aaa") };

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

// Der Admin schickt den Stand mit, den jemand geprüft hat. Ist main seither weitergewandert,
// gehört das sofort beantwortet und nicht erst nach einem angestossenen Bau: Der Workflow
// würde dasselbe feststellen, aber der Admin sähe bis dahin eine laufende Veröffentlichung.
test("ein veralteter Stand wird sofort abgelehnt, nicht angestossen", async () => {
  const { binding, erzeugt } = workflowStub();
  const antwort = await start.handlePublishStart(
    {
      request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 3 }),
      env: { PUBLISH: binding }
    },
    { readSession: async () => ({ token: "gh-token" }), fetch: kopfStub("ccc") }
  );

  assert.equal(antwort.status, 409);
  assert.deepEqual(await antwort.json(), {
    message: "Der geprüfte Stand ist nicht mehr aktuell. Bitte neu laden und die Änderungen prüfen.",
    code: "STAND_VERALTET",
    erwartet: "aaa",
    gefunden: "ccc"
  });
  assert.equal(erzeugt.length, 0, "eine abgelehnte Anfrage darf keine Instanz hinterlassen");
});

// Die Prüfung ist eine Vorsichtsmassnahme. Scheitert sie selbst, darf sie die Veröffentlichung
// nicht mitreissen — der Workflow prüft ohnehin noch einmal, und zwar mit demselben Ergebnis.
test("ein unlesbarer Stand blockiert die Veröffentlichung nicht", async () => {
  const { binding, erzeugt } = workflowStub();
  const antwort = await start.handlePublishStart(
    {
      request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 3 }),
      env: { PUBLISH: binding }
    },
    { readSession: async () => ({ token: "gh-token" }), fetch: kopfStub(null) }
  );

  assert.equal(antwort.status, 202);
  assert.equal(erzeugt.length, 1);
});
