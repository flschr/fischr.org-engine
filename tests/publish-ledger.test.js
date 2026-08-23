// Das Buch der Veröffentlichungen, gegen echtes SQL.

const assert = require("node:assert/strict");
const test = require("node:test");
const d1UeberSqlite = require("./helpers/d1-ueber-sqlite");

let ledgerAus;
test.before(async () => { ({ ledgerAus } = await import("../worker/publish-ledger.js")); });

const JETZT = 1_800_000_000;

function ledger() {
  const { binding, db } = d1UeberSqlite();
  return { buch: ledgerAus(binding), db };
}

function anfrage(requestId, jetzt = JETZT) {
  return { requestId, mainSha: "aaa", draftSha: "bbb", changeCount: 2, jetzt };
}

test("ohne Bindung gibt es kein Buch — und niemand tut so als ob", () => {
  assert.equal(ledgerAus(null), null);
  assert.equal(ledgerAus(undefined), null);
});

test("eine Veröffentlichung nimmt das Schloss", async () => {
  const { buch } = ledger();
  assert.deepEqual(await buch.reserviere(anfrage("r1")), { ok: true });

  const laufend = await buch.laufende();
  assert.equal(laufend.request_id, "r1");
  assert.equal(laufend.status, "laeuft");
  assert.equal(laufend.instance_id, null, "die Instanz gibt es noch nicht");
});

// Der Kern: Das Schloss ist eine Zusicherung der Datenbank. Es gibt kein Fenster zwischen
// Nachsehen und Schreiben, in das eine zweite Anfrage passen könnte.
test("eine zweite Veröffentlichung wird abgewiesen, solange die erste läuft", async () => {
  const { buch } = ledger();
  await buch.reserviere(anfrage("r1"));

  const zweite = await buch.reserviere(anfrage("r2"));
  assert.equal(zweite.ok, false);
  assert.equal(zweite.laufend.request_id, "r1", "die Absage benennt, was blockiert");

  const alle = await buch.nachAnfrage("r2");
  assert.equal(alle, null, "eine abgewiesene Veröffentlichung hinterlässt keine Zeile");
});

test("nach dem Abschluss ist der Weg wieder frei", async () => {
  const { buch } = ledger();
  await buch.reserviere(anfrage("r1"));
  await buch.schliesseAb("r1", "fertig", null, JETZT + 120);

  assert.equal(await buch.laufende(), null);
  assert.deepEqual(await buch.reserviere(anfrage("r2", JETZT + 200)), { ok: true });

  const erste = await buch.nachAnfrage("r1");
  assert.equal(erste.status, "fertig");
  assert.equal(erste.finished_at, JETZT + 120);
});

test("abgeschlossene Zeilen schliessen sich nicht gegenseitig aus", async () => {
  const { buch } = ledger();
  for (const [id, versatz] of [["r1", 0], ["r2", 100], ["r3", 200]]) {
    await buch.reserviere(anfrage(id, JETZT + versatz));
    await buch.schliesseAb(id, "gescheitert", "Bau fehlgeschlagen", JETZT + versatz + 50);
  }
  assert.equal(await buch.laufende(), null);
  assert.equal((await buch.nachAnfrage("r2")).grund, "Bau fehlgeschlagen");
});

// Stirbt eine Instanz, ohne sich zurückzumelden, bliebe das Schloss sonst für immer liegen und
// niemand könnte je wieder veröffentlichen — ein Ausfall, der einen Eingriff von Hand bräuchte.
test("ein Schloss, das niemand mehr hält, wird zurückgegeben", async () => {
  const { buch } = ledger();
  await buch.reserviere(anfrage("tot"));

  const spaeter = JETZT + 46 * 60;
  assert.deepEqual(await buch.reserviere(anfrage("neu", spaeter)), { ok: true });

  const verfallen = await buch.nachAnfrage("tot");
  assert.equal(verfallen.status, "zeitueberschreitung");
  assert.equal(verfallen.finished_at, spaeter);
  assert.match(verfallen.grund, /nie zurückgemeldet/);
});

// Aber nicht zu früh: Der Workflow selbst wartet eine halbe Stunde. Gäbe das Schloss vorher
// nach, liefen zwei Veröffentlichungen nebeneinander — genau das, was es verhindern soll.
test("ein noch laufendes Schloss wird nicht vorzeitig gebrochen", async () => {
  const { buch } = ledger();
  await buch.reserviere(anfrage("laeuft-noch"));

  const zweite = await buch.reserviere(anfrage("neu", JETZT + 44 * 60));
  assert.equal(zweite.ok, false);
  assert.equal((await buch.nachAnfrage("laeuft-noch")).status, "laeuft");
});

test("Instanz und Lauf werden nachgetragen und sind auffindbar", async () => {
  const { buch } = ledger();
  await buch.reserviere(anfrage("r1"));
  await buch.verknuepfeInstanz("r1", "cf_abc");
  await buch.haltLaufFest("r1", 77, "https://github.com/x/77");

  const nachInstanz = await buch.nachInstanz("cf_abc");
  assert.equal(nachInstanz.request_id, "r1");
  assert.equal(nachInstanz.run_id, 77);
  assert.equal(nachInstanz.run_url, "https://github.com/x/77");
});

test("eine unbekannte Instanz ist leer, kein Fehler", async () => {
  const { buch } = ledger();
  assert.equal(await buch.nachInstanz("gibtsnicht"), null);
  assert.equal(await buch.nachAnfrage("gibtsnicht"), null);
});

// Dieselbe Anfrage noch einmal ist keine zweite Veröffentlichung: ein zweiter Klick, ein
// wiederholtes Senden nach einem Netzaussetzer. Vorher sah das aus wie ein belegtes Schloss.
test("dieselbe Anfrage erneut wird als dieselbe erkannt", async () => {
  const { buch } = ledger();
  await buch.reserviere(anfrage("r1"));
  await buch.verknuepfeInstanz("r1", "cf_abc");

  const nochmal = await buch.reserviere(anfrage("r1"));
  assert.equal(nochmal.ok, false);
  assert.equal(nochmal.grund, "laeuft-schon");
  assert.equal(nochmal.zeile.instance_id, "cf_abc", "die vorhandene Instanz wird mitgegeben");
});

// Und eine Anfrage, die längst durch ist, ist kein belegtes Schloss — die Auskunft wäre falsch
// und schickte jemanden aufs Warten auf etwas, das nicht läuft.
test("eine abgeschlossene Anfrage wird als abgeschlossen gemeldet", async () => {
  const { buch } = ledger();
  await buch.reserviere(anfrage("r1"));
  await buch.schliesseAb("r1", "fertig", null, JETZT + 60);

  const nochmal = await buch.reserviere(anfrage("r1", JETZT + 100));
  assert.equal(nochmal.ok, false);
  assert.equal(nochmal.grund, "abgeschlossen");
  assert.equal(nochmal.zeile.status, "fertig");
});

// Ein fremdes Schloss bleibt ein fremdes Schloss.
test("eine andere laufende Veröffentlichung wird als Schloss gemeldet", async () => {
  const { buch } = ledger();
  await buch.reserviere(anfrage("r1"));

  const andere = await buch.reserviere(anfrage("r2"));
  assert.equal(andere.grund, "schloss");
  assert.equal(andere.laufend.request_id, "r1");
});
