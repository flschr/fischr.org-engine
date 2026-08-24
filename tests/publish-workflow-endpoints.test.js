// Die beiden Endpunkte, über die eine Veröffentlichung beginnt und ihren Zustand meldet.

const assert = require("node:assert/strict");
const test = require("node:test");
const d1UeberSqlite = require("./helpers/d1-ueber-sqlite");

let start;
let zustand;
let ledgerAus;
test.before(async () => {
  ({ ledgerAus } = await import("../worker/publish-ledger.js"));
  start = await import("../functions/api/admin/publish/index.js");
  zustand = await import("../functions/api/admin/publish/[id].js");
});

// Standardmässig antwortet die Standprüfung mit genau dem Stand, den die Anfrage mitbringt —
// sonst müsste jeder Test, der die Prüfung gar nicht meint, sie trotzdem bedienen.
// `dateien` sagt, was sich zwischen dem freigegebenen und dem aktuellen Stand bewegt hat —
// die Prüfung fragt das über die Compare-API nach, sobald die SHAs auseinandergehen.
function kopfStub(sha, dateien = ["blog/pages/etwas.md"]) {
  return async (url) => {
    const adresse = String(url);
    if (/git\/ref\/heads\/main$/.test(adresse)) {
      if (sha === null) return new Response("nope", { status: 500 });
      return new Response(JSON.stringify({ object: { sha } }), { status: 200 });
    }
    if (/\/compare\//.test(adresse)) {
      if (dateien === null) return new Response("nope", { status: 500 });
      return new Response(JSON.stringify({
        status: "ahead",
        total_commits: 1,
        files: dateien.map((filename) => ({ filename }))
      }), { status: 200 });
    }
    throw new Error(`Unerwarteter Aufruf: ${adresse}`);
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

// Das Buch ist echtes SQLite mit dem echten Schema: Das Schloss ist ein partieller Unique-Index,
// und ob der greift, beantwortet kein Stub.
function umgebung(binding, weiteres = {}) {
  return { PUBLISH: binding, PUBLISH_LEDGER: d1UeberSqlite().binding, ...weiteres };
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
    { request: anfrage({ requestId: "r1" }), env: umgebung(binding) },
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
      env: umgebung(binding, { ADMIN_GITHUB_REPO: "example/example-blog" })
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
    { env: umgebung(binding), params: { id: "wf-1" } },
    angemeldet
  );

  assert.equal(antwort.status, 200);
  assert.deepEqual(await antwort.json(), {
    id: "wf-1",
    status: "complete",
    output: { status: "fertig" },
    error: null,
    // Kein Eintrag im Buch: Diese Instanz wurde nie über den Startendpunkt angelegt.
    lauf: null,
    buch: null
  });
});

// Der eigentliche Zweck des Buchs an dieser Stelle: Der Admin erfährt die Nummer des Laufs und
// fragt ihn direkt ab, statt dreissig Läufe zu listen und Titel zu vergleichen.
test("der Lauf aus dem Buch wird durchgereicht", async () => {
  const { binding: workflow } = workflowStub({ id: "wf-7" }, { status: "running" });
  const ledger = d1UeberSqlite().binding;
  const buch = ledgerAus(ledger);
  await buch.reserviere({ requestId: "r7", mainSha: "aaa", draftSha: "bbb", changeCount: 1, jetzt: 100 });
  await buch.verknuepfeInstanz("r7", "wf-7");
  await buch.haltLaufFest("r7", 4711, "https://github.com/x/4711");

  const antwort = await zustand.handlePublishStatus(
    { env: { PUBLISH: workflow, PUBLISH_LEDGER: ledger }, params: { id: "wf-7" } },
    angemeldet
  );

  const koerper = await antwort.json();
  assert.deepEqual(koerper.lauf, { id: 4711, url: "https://github.com/x/4711" });
  assert.deepEqual(koerper.buch, { requestId: "r7", status: "laeuft", grund: null, seit: 100 });
});

// Zwischen dem Start und dem Fund liegen Sekunden. In denen gibt es schlicht noch keinen Lauf —
// das ist kein Fehler und darf nicht als einer aussehen.
test("solange der Lauf fehlt, steht dort nichts — und nichts bricht", async () => {
  const { binding: workflow } = workflowStub({ id: "wf-8" }, { status: "running" });
  const ledger = d1UeberSqlite().binding;
  const buch = ledgerAus(ledger);
  await buch.reserviere({ requestId: "r8", mainSha: "aaa", draftSha: "bbb", changeCount: 1, jetzt: 100 });
  await buch.verknuepfeInstanz("r8", "wf-8");

  const antwort = await zustand.handlePublishStatus(
    { env: { PUBLISH: workflow, PUBLISH_LEDGER: ledger }, params: { id: "wf-8" } },
    angemeldet
  );

  const koerper = await antwort.json();
  assert.equal(antwort.status, 200);
  assert.equal(koerper.lauf, null);
  assert.equal(koerper.buch.status, "laeuft");
});

// Eine unbekannte Kennung ist eine Frage nach etwas, das es nicht gibt — und darf nicht wie ein
// Ausfall aussehen.
test("eine unbekannte Kennung ist ein 404, kein Fehler", async () => {
  const binding = { get: async () => { throw new Error("instance not found"); } };
  const antwort = await zustand.handlePublishStatus(
    { env: umgebung(binding), params: { id: "gibt-es-nicht" } },
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
      env: umgebung(binding)
    },
    { readSession: async () => ({ token: "gh-token" }), fetch: kopfStub("ccc") }
  );

  assert.equal(antwort.status, 409);
  assert.deepEqual(await antwort.json(), {
    message: "Der geprüfte Stand ist nicht mehr aktuell. Bitte neu laden und die Änderungen prüfen.",
    code: "STAND_VERALTET",
    erwartet: "aaa",
    gefunden: "ccc",
    grund: "geprüfte Dateien haben sich bewegt"
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
      env: umgebung(binding)
    },
    { readSession: async () => ({ token: "gh-token" }), fetch: kopfStub(null) }
  );

  assert.equal(antwort.status, 202);
  assert.equal(erzeugt.length, 1);
});

// Der wichtigste Fall im Alltag: Nach fast jeder Veröffentlichung landet der R2-Manifest-Fold
// auf main. Eine Prüfung, die daraufhin ablehnt, wäre strenger als der Schritt, den sie
// vorwegnimmt — sie verhinderte Veröffentlichungen, die durchgelaufen wären.
test("ein Manifest-Fold auf main hält die Veröffentlichung nicht auf", async () => {
  const { binding, erzeugt } = workflowStub();
  const antwort = await start.handlePublishStart(
    {
      request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 3 }),
      env: umgebung(binding)
    },
    {
      readSession: async () => ({ token: "gh-token" }),
      fetch: kopfStub("ccc", ["automation/media-manifest.json"])
    }
  );

  assert.equal(antwort.status, 202);
  assert.equal(erzeugt.length, 1);
  assert.equal(erzeugt[0].params.mainSha, "aaa", "veröffentlicht wird der freigegebene Stand");
});

// Scheitert der Vergleich selbst, ist das kein Befund. Der Workflow prüft gleich noch einmal;
// dort kostet ein Irrtum eine Runde, hier eine Veröffentlichung.
test("ein gescheiterter Vergleich blockiert nicht", async () => {
  const { binding, erzeugt } = workflowStub();
  const antwort = await start.handlePublishStart(
    {
      request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 3 }),
      env: umgebung(binding)
    },
    { readSession: async () => ({ token: "gh-token" }), fetch: kopfStub("ccc", null) }
  );

  assert.equal(antwort.status, 202);
  assert.equal(erzeugt.length, 1);
});

// Das Schloss. Zwei gleichzeitig gestartete Veröffentlichungen stiessen bisher beide einen Bau
// an; Actions reihte sie nur hintereinander. Jetzt kommt die zweite gar nicht erst los.
test("solange eine Veröffentlichung läuft, beginnt keine zweite", async () => {
  const { binding, erzeugt } = workflowStub();
  const env = umgebung(binding);

  const erste = await start.handlePublishStart(
    { request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 1 }), env },
    angemeldet
  );
  assert.equal(erste.status, 202);

  const zweite = await start.handlePublishStart(
    { request: anfrage({ requestId: "r2", mainSha: "aaa", draftSha: "ccc", changeCount: 2 }), env },
    angemeldet
  );

  assert.equal(zweite.status, 409);
  const koerper = await zweite.json();
  assert.equal(koerper.code, "VEROEFFENTLICHUNG_LAEUFT");
  assert.equal(koerper.laufendeAnfrage, "r1", "die Absage benennt, was blockiert");
  assert.equal(erzeugt.length, 1, "die zweite Anfrage darf keine Instanz anlegen");
});

// Ohne diese Freigabe bliebe das Schloss bei einer gescheiterten Instanz liegen, und niemand
// könnte bis zum Verfall wieder veröffentlichen — ein Ausfall aus einer Buchungszeile heraus.
test("scheitert das Anlegen der Instanz, ist der Weg sofort wieder frei", async () => {
  const kaputt = { create: async () => { throw new Error("Workflows nicht erreichbar"); } };
  const env = umgebung(kaputt);

  await assert.rejects(
    start.handlePublishStart(
      { request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 1 }), env },
      angemeldet
    ),
    /Workflows nicht erreichbar/
  );

  const { binding, erzeugt } = workflowStub();
  const danach = await start.handlePublishStart(
    { request: anfrage({ requestId: "r2", mainSha: "aaa", draftSha: "bbb", changeCount: 1 }), env: { ...env, PUBLISH: binding } },
    angemeldet
  );
  assert.equal(danach.status, 202, "die nächste Veröffentlichung darf nicht am toten Schloss hängen");
  assert.equal(erzeugt.length, 1);
});

// Ein veralteter Stand darf das Schloss gar nicht erst nehmen: Sonst blockierte eine abgelehnte
// Anfrage die Veröffentlichung, die gleich darauf richtig gestellt wird.
test("eine abgelehnte Anfrage nimmt das Schloss nicht", async () => {
  const { binding, erzeugt } = workflowStub();
  const env = umgebung(binding);

  const abgelehnt = await start.handlePublishStart(
    { request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 1 }), env },
    { readSession: async () => ({ token: "gh-token" }), fetch: kopfStub("ccc") }
  );
  assert.equal(abgelehnt.status, 409);
  assert.equal((await abgelehnt.json()).code, "STAND_VERALTET");

  const danach = await start.handlePublishStart(
    { request: anfrage({ requestId: "r2", mainSha: "aaa", draftSha: "bbb", changeCount: 1 }), env },
    angemeldet
  );
  assert.equal(danach.status, 202);
  assert.equal(erzeugt.length, 1);
});

// Ohne Buch gibt es kein Schloss. Dann lieber sagen, dass etwas fehlt, als ungeschützt zu
// veröffentlichen — dasselbe Muster wie bei der fehlenden Workflow-Bindung.
test("ein fehlendes Buch meldet sich als Konfigurationsproblem", async () => {
  const { binding, erzeugt } = workflowStub();
  const antwort = await start.handlePublishStart(
    { request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 1 }), env: { PUBLISH: binding } },
    angemeldet
  );
  assert.equal(antwort.status, 503);
  assert.equal(erzeugt.length, 0);
});

// Ein zweites Senden derselben Anfrage darf keine zweite Instanz anlegen — und keinen Fehler
// melden: Aus Sicht des Absenders ist genau das passiert, was er wollte.
test("dieselbe Anfrage erneut gibt die vorhandene Instanz zurück", async () => {
  const { binding, erzeugt } = workflowStub({ id: "wf-1" });
  const env = umgebung(binding);
  const bitte = () => start.handlePublishStart(
    { request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 1 }), env },
    angemeldet
  );

  assert.equal((await bitte()).status, 202);
  const nochmal = await bitte();

  assert.equal(nochmal.status, 202);
  assert.deepEqual(await nochmal.json(), { id: "wf-1", status: "gestartet" });
  assert.equal(erzeugt.length, 1, "genau eine Instanz für zwei gleiche Anfragen");
});

// Eine längst durchgelaufene Anfrage ist kein belegtes Schloss. Diese Auskunft schickte jemanden
// sonst aufs Warten auf etwas, das nicht mehr läuft.
test("eine bereits durchgelaufene Anfrage sagt das auch", async () => {
  const { binding } = workflowStub();
  const ledger = d1UeberSqlite().binding;
  const buch = ledgerAus(ledger);
  await buch.reserviere({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 1, jetzt: 100 });
  await buch.schliesseAb("r1", "fertig", null, 200);

  const antwort = await start.handlePublishStart(
    {
      request: anfrage({ requestId: "r1", mainSha: "aaa", draftSha: "bbb", changeCount: 1 }),
      env: { PUBLISH: binding, PUBLISH_LEDGER: ledger }
    },
    angemeldet
  );

  assert.equal(antwort.status, 409);
  const koerper = await antwort.json();
  assert.equal(koerper.code, "ANFRAGE_ABGESCHLOSSEN");
  assert.equal(koerper.ausgang, "fertig");
});

// Der Proxy vor der GitHub-API führt eine Positivliste. Sie ist die Stelle, an der eine
// Statusabfrage scheitern kann, ohne dass die Veröffentlichung selbst etwas merkt: Der Workflow
// läuft serverseitig weiter, nur der Admin sieht nichts mehr — und meldete „fehlgeschlagen" für
// etwas, das gerade erfolgreich war.
test("der Proxy lässt genau die Endpunkte durch, die der Admin für den Status braucht", async () => {
  const { isAllowedEndpoint } = await import("../functions/api/github/[[path]].js");

  // Seit dem Buch der Veröffentlichungen wird der Lauf über seine Nummer geholt. Diese Zeile
  // fehlte, und weil die Abfrage mit dem Lauf beginnt, kam sie nie bis zu den Schritten.
  assert.equal(isAllowedEndpoint("actions/runs/4711"), true);
  assert.equal(isAllowedEndpoint("actions/runs/4711/jobs"), true);
  assert.equal(isAllowedEndpoint("actions/workflows/admin-publish.yml/runs"), true);
  assert.equal(isAllowedEndpoint("actions/workflows/admin-publish.yml/dispatches"), true);

  // Und weiterhin nicht mehr als das.
  assert.equal(isAllowedEndpoint("actions/runs/4711/rerun"), false);
  assert.equal(isAllowedEndpoint("actions/workflows/build.yml/dispatches"), false);
  assert.equal(isAllowedEndpoint("actions/runs"), false);
  assert.equal(isAllowedEndpoint("../secrets"), false);
});
