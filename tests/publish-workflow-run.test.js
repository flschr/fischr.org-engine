// Der Ablauf der Veröffentlichung, mit gefälschtem step und gefälschtem GitHub.
//
// Geprüft wird, was der Workflow ordnet: dass er einen überholten Stand erkennt, bevor er
// irgendetwas anstösst, dass er genau einmal anstösst, dass er den zugehörigen Lauf findet und
// dass er dessen Ausgang durchreicht. Das Bauen selbst gehört Actions.

const assert = require("node:assert/strict");
const test = require("node:test");

let lauf;
test.before(async () => {
  lauf = await import("../worker/publish-run.js");
});

// Ein step, der sich merkt, was er ausgeführt hat. Er führt jeden Schritt sofort aus — die
// Einmaligkeit garantiert die Laufzeit, hier interessiert die Reihenfolge.
function stepStub() {
  const schritte = [];
  const pausen = [];
  return {
    schritte,
    pausen,
    step: {
      do: async (name, optionenOderArbeit, vielleichtArbeit) => {
        const arbeit = typeof optionenOderArbeit === "function" ? optionenOderArbeit : vielleichtArbeit;
        schritte.push(name);
        return arbeit();
      },
      sleep: async (name) => { pausen.push(name); }
    }
  };
}

function ereignis(extra = {}) {
  return {
    payload: {
      repository: "example/example-blog",
      requestId: "r-1",
      mainSha: "aaa",
      draftSha: "bbb",
      changeCount: 2,
      token: "gh-token",
      ...extra
    }
  };
}

// Baut ein GitHub, das der Reihe nach antwortet. `laeufe` ist die Folge von Zuständen, die
// /actions/runs/<id> liefern soll.
function githubStub({ mainSha = "aaa", titel = "Publish r-1", laeufe = [{ status: "completed", conclusion: "success" }] } = {}) {
  const aufrufe = [];
  let index = 0;
  const holen = async (url, optionen = {}) => {
    aufrufe.push(`${optionen.method || "GET"} ${url.replace("https://api.github.com/", "")}`);
    if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: mainSha } });
    if (url.includes("/dispatches")) return new Response(null, { status: 204 });
    if (url.includes("/runs?event=")) {
      return Response.json({ workflow_runs: titel ? [{ id: 77, html_url: "https://x/77", display_title: titel }] : [] });
    }
    if (url.includes("/actions/runs/77")) {
      const zustand = laeufe[Math.min(index, laeufe.length - 1)];
      index += 1;
      return Response.json(zustand);
    }
    throw new Error(`unerwartet: ${url}`);
  };
  return { holen, aufrufe };
}

test("ein überholter Stand wird gemeldet, bevor irgendetwas angestossen wird", async () => {
  const { step, schritte } = stepStub();
  const { holen, aufrufe } = githubStub({ mainSha: "inzwischen-anders" });

  const ergebnis = await lauf.fuehrePublishAus(ereignis(), step, { fetch: holen });

  assert.deepEqual(ergebnis, { status: "veraltet", erwartet: "aaa", gefunden: "inzwischen-anders" });
  assert.deepEqual(schritte, ["stand prüfen"], "nach dem Befund darf nichts weiter passieren");
  assert.equal(aufrufe.filter((a) => a.includes("dispatches")).length, 0, "kein Bau bei überholtem Stand");
});

test("ein gültiger Stand stösst genau einen Bau an und reicht sein Ergebnis durch", async () => {
  const { step, schritte } = stepStub();
  const { holen, aufrufe } = githubStub();

  const ergebnis = await lauf.fuehrePublishAus(ereignis(), step, { fetch: holen });

  assert.equal(ergebnis.status, "fertig");
  assert.deepEqual(ergebnis.lauf, { id: 77, url: "https://x/77" });
  assert.equal(aufrufe.filter((a) => a.includes("dispatches")).length, 1, "genau ein Anstoss");
  assert.deepEqual(schritte.slice(0, 3), ["stand prüfen", "bau anstossen", "lauf finden"]);
});

test("ein gescheiterter Bau wird als gescheitert gemeldet, nicht als fertig", async () => {
  const { step } = stepStub();
  const { holen } = githubStub({ laeufe: [{ status: "completed", conclusion: "failure" }] });

  const ergebnis = await lauf.fuehrePublishAus(ereignis(), step, { fetch: holen });
  assert.equal(ergebnis.status, "gescheitert");
});

// Der Lauf ist erst nach ein paar Sekunden sichtbar. Ohne Wiederholung wäre jede Veröffentlichung
// ein Rennen gegen die Listenaktualisierung von GitHub.
test("das Suchen des Laufs läuft mit Wiederholungen", async () => {
  const { step } = stepStub();
  const optionen = [];
  step.do = async (name, a, b) => {
    if (typeof a !== "function") optionen.push({ name, a });
    return (typeof a === "function" ? a : b)();
  };
  const { holen } = githubStub();

  await lauf.fuehrePublishAus(ereignis(), step, { fetch: holen });
  const finden = optionen.find((eintrag) => eintrag.name === "lauf finden");
  assert.ok(finden, "der Suchschritt muss Optionen tragen");
  assert.ok(finden.a.retries.limit >= 5, "ein einzelner Versuch reicht nicht");
});

// Ein Bau, der nie fertig wird, darf nicht ewig warten — sonst bliebe die Instanz für immer
// offen und der Admin sähe eine Veröffentlichung, die nie endet.
test("ein Bau, der nicht fertig wird, endet in einer Zeitüberschreitung", async () => {
  const { step, pausen } = stepStub();
  const { holen } = githubStub({ laeufe: [{ status: "in_progress" }] });

  const ergebnis = await lauf.fuehrePublishAus(ereignis(), step, { fetch: holen });

  assert.equal(ergebnis.status, "zeitueberschreitung");
  assert.ok(pausen.length >= 10, "zwischen den Abfragen muss gewartet werden");
});

test("bleibt der Lauf unsichtbar, scheitert der Suchschritt statt still weiterzulaufen", async () => {
  const { step } = stepStub();
  const { holen } = githubStub({ titel: null });

  await assert.rejects(
    lauf.fuehrePublishAus(ereignis(), step, { fetch: holen }),
    /noch nicht sichtbar/
  );
});
