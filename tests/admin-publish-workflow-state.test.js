// Was der Admin aus dem Workflow liest, wenn noch kein Actions-Lauf existiert.
//
// Das ist das einzige Fenster, in dem die beiden Fälle „Lauf noch nicht sichtbar" und „es wird
// keinen Lauf geben" gleich aussehen. Vorher endete der zweite nach zwölf Minuten in einer
// gemeldeten Zeitüberschreitung — einer Fehlermeldung über etwas, das korrekt entschieden wurde.

const test = require("node:test");
const assert = require("node:assert/strict");
const adminSource = require("./helpers/admin-source");

function extractFunction(sourceText, anchor) {
  const start = sourceText.indexOf(anchor);
  assert.notEqual(start, -1, `Fehlende Funktion: ${anchor}`);
  const blockStart = sourceText.indexOf("{", start + anchor.length);
  let depth = 0;
  for (let index = blockStart; index < sourceText.length; index += 1) {
    if (sourceText[index] === "{") depth += 1;
    if (sourceText[index] === "}") depth -= 1;
    if (depth === 0) return sourceText.slice(start, index + 1);
  }
  throw new Error(`Unclosed function: ${anchor}`);
}

function pruefer(workflowState) {
  const source = extractFunction(adminSource(), "async function workflowGeprueft(status, request)");
  const gefragt = [];
  const window = {
    RWPublishService: {
      fetchWorkflowState: async (id) => { gefragt.push(id); return workflowState; }
    }
  };
  const fn = new Function("window", `return (${source});`)(window);
  return { fn, gefragt };
}

const vorgemerkt = { state: "queued", message: "Waiting for GitHub to accept the publish request" };

test("ein veralteter Workflow endet sofort mit einer wahren Meldung", async () => {
  const { fn, gefragt } = pruefer({ status: "complete", output: { status: "veraltet" } });
  const status = await fn(vorgemerkt, { workflowId: "wf-1" });

  assert.deepEqual(gefragt, ["wf-1"]);
  assert.equal(status.state, "failed");
  assert.match(status.message, /nicht mehr aktuell/);
});

test("ein abgebrochener Workflow wird als Abbruch gemeldet, nicht als Warten", async () => {
  const { fn } = pruefer({ status: "errored", error: { message: "GitHub 502 für runs" } });
  const status = await fn(vorgemerkt, { workflowId: "wf-1" });

  assert.equal(status.state, "failed");
  assert.match(status.message, /GitHub 502/);
});

test("ein noch laufender Workflow lässt das Warten unverändert", async () => {
  const { fn } = pruefer({ status: "running", output: null });
  assert.deepEqual(await fn(vorgemerkt, { workflowId: "wf-1" }), vorgemerkt);
});

// Sobald ein Lauf existiert, ist der Lauf die Wahrheit. Dann darf der Workflow nicht mehr
// gefragt werden — sonst überschriebe eine Nebenauskunft, was gerade wirklich passiert.
test("sobald ein Lauf sichtbar ist, wird der Workflow nicht mehr gefragt", async () => {
  const { fn, gefragt } = pruefer({ status: "complete", output: { status: "veraltet" } });
  const laufend = { state: "queued", runId: 42, message: "Veröffentlichung bei GitHub vorgemerkt" };

  assert.deepEqual(await fn(laufend, { workflowId: "wf-1" }), laufend);
  assert.deepEqual(await fn({ state: "running" }, { workflowId: "wf-1" }), { state: "running" });
  assert.deepEqual(gefragt, [], "kein Lauf ohne Anlass");
});

// Eine wiederhergestellte Veröffentlichung (aus einem anderen Gerät entdeckt) trägt keine
// Kennung. Das ist kein Fehler, sondern der Normalfall dieses Wegs.
test("ohne Kennung bleibt es beim bisherigen Zustand", async () => {
  const { fn, gefragt } = pruefer({ status: "complete", output: { status: "veraltet" } });
  assert.deepEqual(await fn(vorgemerkt, {}), vorgemerkt);
  assert.deepEqual(gefragt, []);
});

// Fällt die Abfrage aus, meldet fetchWorkflowState null. Daraus darf kein Scheitern werden.
test("eine ausgefallene Abfrage lässt die Veröffentlichung laufen", async () => {
  const { fn } = pruefer(null);
  assert.deepEqual(await fn(vorgemerkt, { workflowId: "wf-1" }), vorgemerkt);
});

// Die Kennung muss den Weg vom Start bis in die gespeicherte Anfrage finden, sonst hätte der
// Prüfer nie etwas zu fragen.
test("die Kennung der Instanz landet in der Anfrage", () => {
  const source = adminSource();
  const syncOutbox = extractFunction(source, "async function syncOutbox()");
  assert.match(syncOutbox, /const gestartet = await starteVeroeffentlichung\(/);
  assert.match(syncOutbox, /request\.workflowId = gestartet\?\.id \|\| ""/);
  // persistPublishRequest schreibt die Anfrage in den localStorage — die Zuweisung muss davor
  // stehen, sonst überlebt die Kennung kein Neuladen.
  assert.ok(
    syncOutbox.indexOf("request.workflowId") < syncOutbox.indexOf("persistPublishRequest(request)"),
    "die Kennung muss vor dem Speichern gesetzt sein"
  );
});

// Und der Prüfer muss im Weg liegen. Ohne diese Zeile wären alle Tests oben grün und die
// Auskunft trotzdem nie abgefragt.
test("jede Statusabfrage läuft durch den Prüfer", () => {
  const refresh = extractFunction(adminSource(), "async function refreshPublishRequest(request, signal)");
  assert.match(refresh, /const status = await workflowGeprueft\(\s*await window\.RWPublishService\.fetchStatus\(/);
});
