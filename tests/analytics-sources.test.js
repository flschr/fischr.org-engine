// Zusammenführung zweier Zählungen.
//
// Solange importierte und selbst gemessene Zahlen nebeneinanderliegen, muss
// jeder Tag aus genau einer Quelle gelesen werden. Diese Regel ist die
// subtilste Logik des Vorhabens: Sie steht in acht Abfragen, ihre Fehler
// erzeugen keine Ausnahmen, sondern stille falsche Zahlen. Deshalb hier gegen
// eine echte SQLite-Datenbank mit dem echten Schema geprüft und nicht im
// Quelltext wiedererkannt.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

let eineQuelle;
test.before(async () => {
  ({ eineQuelle } = await import("../functions/api/admin/analytics.js"));
});

function datenbank() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(__dirname, "../lib/analytics/schema.sql"), "utf8"));
  return db;
}

const seite = (db, day, source, kind, hits) =>
  db.prepare("INSERT INTO daily_page (day, path, kind, source, hits) VALUES (?, ?, ?, ?, ?)")
    .run(day, kind === "page" ? "/beitrag/" : "/feed.xml", kind, source, hits);

const aufrufe = (db, kind, day) =>
  db.prepare(
    `SELECT COALESCE(SUM(hits), 0) AS hits FROM daily_page
     WHERE kind = '${kind}' AND day = ? ${eineQuelle(kind)}`
  ).get(day).hits;

test("ein Tag mit eigener Messung wird nicht zusätzlich aus dem Import gelesen", () => {
  const db = datenbank();
  seite(db, "2026-09-01", "goatcounter", "page", 16);
  seite(db, "2026-09-01", "live", "page", 999);
  // Ohne die Regel wären es 1015 — der Tag käme doppelt vor.
  assert.equal(aufrufe(db, "page", "2026-09-01"), 999);
});

test("ein Feed-Abruf löscht die Seitenaufrufe des Tages nicht", () => {
  const db = datenbank();
  seite(db, "2026-09-02", "goatcounter", "page", 40);
  seite(db, "2026-09-02", "live", "feed", 1);
  // Der Tag hat live nur einen Feed-Abruf, aber keine selbst gezählte Seite.
  // Die importierten Seitenaufrufe müssen deshalb stehen bleiben.
  assert.equal(aufrufe(db, "page", "2026-09-02"), 40);
});

test("reine Vergangenheit bleibt vollständig sichtbar", () => {
  const db = datenbank();
  seite(db, "2026-01-15", "goatcounter", "page", 10);
  assert.equal(aufrufe(db, "page", "2026-01-15"), 10);
});

test("jede Art wird für sich entschieden", () => {
  const db = datenbank();
  seite(db, "2026-09-03", "goatcounter", "page", 25);
  seite(db, "2026-09-03", "goatcounter", "feed", 7);
  seite(db, "2026-09-03", "live", "feed", 3);
  // Feed: eigene Messung vorhanden, also nur diese.
  assert.equal(aufrufe(db, "feed", "2026-09-03"), 3);
  // Seiten: keine eigene Messung an diesem Tag, also der Import.
  assert.equal(aufrufe(db, "page", "2026-09-03"), 25);
});

test("eine Lücke im Parallelbetrieb fällt auf den Import zurück", () => {
  const db = datenbank();
  seite(db, "2026-09-04", "goatcounter", "page", 30);
  seite(db, "2026-09-05", "goatcounter", "page", 31);
  seite(db, "2026-09-05", "live", "page", 44);
  // Am 4. hat die eigene Zählung ausgesetzt — dann zählt der Import,
  // statt eine Null zu zeigen.
  assert.equal(aufrufe(db, "page", "2026-09-04"), 30);
  assert.equal(aufrufe(db, "page", "2026-09-05"), 44);
});

test("Quellen und Seite-mal-Quelle folgen den Seitenaufrufen", () => {
  const db = datenbank();
  seite(db, "2026-09-06", "goatcounter", "page", 12);
  seite(db, "2026-09-06", "live", "page", 5);
  db.prepare("INSERT INTO daily_ref (day, ref_host, source, hits) VALUES (?, ?, ?, ?)").run("2026-09-06", "example.org", "goatcounter", 12);
  db.prepare("INSERT INTO daily_ref (day, ref_host, source, hits) VALUES (?, ?, ?, ?)").run("2026-09-06", "example.org", "live", 5);
  const quellen = db.prepare(
    `SELECT COALESCE(SUM(hits), 0) AS hits FROM daily_ref WHERE day = ? ${eineQuelle("page")}`
  ).get("2026-09-06").hits;
  // Die Summe der Quellen darf nicht über der Zahl der Aufrufe liegen.
  assert.equal(quellen, 5);
  assert.equal(aufrufe(db, "page", "2026-09-06"), 5);
});

// --- Zeitreihe --------------------------------------------------------------
//
// Die Kurve zeichnet ihre Punkte gleichmäßig verteilt. Fehlten Tage ohne
// Treffer, läge zwischen dem letzten Tag vor einer Lücke und dem ersten danach
// ein einziger Schritt — zwei Monate Stillstand sähen aus wie ein Tag.
const readAdminSource = require("./helpers/admin-source");

function statsSeriesAusQuelle() {
  const quelle = readAdminSource();
  // statsSeries stützt sich auf STATS_MAX_PUNKTE und statsTage — der Ausschnitt
  // muss deshalb bei der Konstante beginnen und bis zum Ende von statsSeries
  // reichen, sonst fehlen der Funktion ihre Nachbarn.
  const anfang = quelle.indexOf("const STATS_MAX_PUNKTE");
  assert.notEqual(anfang, -1, "STATS_MAX_PUNKTE nicht gefunden");
  const seriesAnfang = quelle.indexOf("function statsSeries(rows, range)", anfang);
  assert.notEqual(seriesAnfang, -1, "statsSeries nicht gefunden");

  let tiefe = 0;
  for (let i = quelle.indexOf("{", seriesAnfang); i < quelle.length; i += 1) {
    if (quelle[i] === "{") tiefe += 1;
    if (quelle[i] === "}") tiefe -= 1;
    if (tiefe === 0) {
      return new Function(`${quelle.slice(anfang, i + 1)}\nreturn statsSeries;`)();
    }
  }
  throw new Error("Block nicht geschlossen");
}

test("die Kurve füllt Tage ohne Treffer mit null auf", () => {
  const statsSeries = statsSeriesAusQuelle();
  const reihe = statsSeries(
    [{ day: "2026-03-01", hits: 12 }, { day: "2026-03-05", hits: 4 }],
    { start: "2026-03-01", end: "2026-03-05" }
  );
  assert.equal(reihe.length, 5, "fünf Kalendertage, fünf Punkte");
  assert.deepEqual(reihe.map((p) => p.daily), [12, 0, 0, 0, 4]);
});

test("die Zeitumstellung verschluckt keinen Tag", () => {
  const statsSeries = statsSeriesAusQuelle();
  // In der Nacht zum 29.03.2026 wird auf Sommerzeit gestellt.
  const reihe = statsSeries([{ day: "2026-03-29", hits: 7 }], { start: "2026-03-27", end: "2026-03-31" });
  assert.equal(reihe.length, 5);
  assert.deepEqual(reihe.map((p) => p.daily), [0, 0, 7, 0, 0]);
});

test("ohne Zeitraum bleibt die Kurve bei den gelieferten Punkten", () => {
  const statsSeries = statsSeriesAusQuelle();
  assert.deepEqual(statsSeries([{ day: "2026-03-01", hits: 3 }], null).map((p) => p.daily), [3]);
});

test("ein langer Zeitraum wird gebündelt, nicht abgeschnitten", () => {
  const statsSeries = statsSeriesAusQuelle();
  // Die gesamte vorhandene Historie: 504 Kalendertage, über den Datumswähler
  // mit zwei Klicks erreichbar. Eine frühere Fassung lieferte 400 Punkte und
  // verlor die letzten 104 Tage samt ihrer Treffer.
  const reihe = statsSeries(
    [{ day: "2025-04-06", hits: 5 }, { day: "2026-08-22", hits: 9 }],
    { start: "2025-04-06", end: "2026-08-22" }
  );
  const summe = reihe.reduce((s, punkt) => s + punkt.daily, 0);
  assert.equal(summe, 14, "kein Treffer darf beim Bündeln verloren gehen");
  assert.ok(reihe.length <= 200, `höchstens 200 Punkte, waren ${reihe.length}`);
  assert.ok(reihe.at(-1).daily > 0, "der letzte Eimer muss die Treffer vom Ende tragen");
});

test("die Bündelung erhält die Form", () => {
  const statsSeries = statsSeriesAusQuelle();
  // 600 Tage, jeder mit einem Treffer: gebündelt muss jeder Eimer gleich hoch
  // sein und die Gesamtsumme stimmen.
  const rows = [];
  const tag = new Date("2025-01-01T12:00:00");
  for (let i = 0; i < 600; i += 1) {
    rows.push({ day: tag.toISOString().slice(0, 10), hits: 1 });
    tag.setDate(tag.getDate() + 1);
  }
  const reihe = statsSeries(rows, { start: rows[0].day, end: rows.at(-1).day });
  assert.equal(reihe.reduce((s, p) => s + p.daily, 0), 600);
  assert.ok(reihe.length <= 200);
});

// --- Aufräumen ---------------------------------------------------------------
//
// Das Salz eines Tages macht dessen Hashes nachrechenbar. Bleibt es liegen,
// lässt sich zu einer vermuteten IP noch Jahre später prüfen, ob sie an einem
// bestimmten Tag da war — die Zusage "Wiedererkennbarkeit endet um Mitternacht"
// hielte dann nicht. Deshalb wird hier geprüft, dass wirklich gelöscht wird,
// und ebenso, dass die Auswertung nichts davon verliert.
let analyticsModul;
test.before(async () => {
  analyticsModul = await import("../functions/_analytics.js");
});

// Minimaler Ersatz für die D1-Schnittstelle auf Basis von node:sqlite.
function d1(db) {
  return {
    prepare(sql) {
      const statement = { sql, params: [] };
      statement.bind = (...params) => ({ ...statement, params, run: () => db.prepare(sql).run(...params) });
      return statement;
    },
    batch: async (statements) => statements.map((s) => db.prepare(s.sql).run(...s.params))
  };
}

test("alte Salze werden gelöscht, frische bleiben", async () => {
  const db = datenbank();
  const setze = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const tag of ["2026-08-01", "2026-08-18", "2026-08-21", "2026-08-22", "2026-08-23"]) {
    setze.run(`salt:${tag}`, `geheim-${tag}`);
  }
  setze.run("goatcounter_import_at", "2026-08-23T00:00:00Z");

  await analyticsModul.raeumeAuf(d1(db), "2026-08-23");

  const uebrig = db.prepare("SELECT key FROM meta WHERE key LIKE 'salt:%' ORDER BY key").all().map((r) => r.key);
  assert.deepEqual(uebrig, ["salt:2026-08-21", "salt:2026-08-22", "salt:2026-08-23"]);
  // Andere Einträge in derselben Tabelle dürfen nicht mitgerissen werden.
  assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'goatcounter_import_at'").get().value, "2026-08-23T00:00:00Z");
});

test("alte Rohzeilen verschwinden, die Tagesaggregate bleiben", async () => {
  const db = datenbank();
  const roh = db.prepare("INSERT INTO hits (ts, day, kind, path, class) VALUES (1, ?, 'page', '/x/', 'human')");
  roh.run("2025-01-01");
  roh.run("2026-08-23");
  seite(db, "2025-01-01", "goatcounter", "page", 40);

  await analyticsModul.raeumeAuf(d1(db), "2026-08-23");

  const tage = db.prepare("SELECT day FROM hits ORDER BY day").all().map((r) => r.day);
  assert.deepEqual(tage, ["2026-08-23"], "nur die alte Rohzeile darf weg sein");
  // Die Auswertung liest ausschließlich Aggregate — sie darf nichts verlieren.
  assert.equal(aufrufe(db, "page", "2025-01-01"), 40);
});

// --- Kürzung langer Listen ---------------------------------------------------
//
// Die Seitenliste hatte fünfundzwanzig Einträge und machte die Ansicht länger
// als alles andere zusammen. Gekürzt wird in der Darstellung, nicht in der
// Abfrage: Die restlichen Zeilen stehen im Markup und brauchen keine zweite
// Anfrage, wenn jemand sie sehen will.
function panelAusQuelle() {
  // Nur die Statistik-Bausteine: Der vollständige Admin-Quelltext führt beim
  // Auswerten seinen Startcode aus und verlangt Dinge, die es hier nicht gibt.
  const verzeichnis = path.join(__dirname, "../blog/admin/admin-src");
  const quelle = fs.readdirSync(verzeichnis)
    .filter((name) => /^21/.test(name)).sort()
    .map((name) => fs.readFileSync(path.join(verzeichnis, name), "utf8"))
    .join("\n");
  const kontext = {
    els: { statsBody: { innerHTML: "" } },
    escapeHtml: (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    window: { RWIcons: null },
    state: { statsPeriod: { preset: "week", from: "", to: "" }, statsCache: new Map(), statsPromises: new Map(), statsControllers: new Map(), statsRequest: 0 },
    fetch: () => Promise.reject(new Error("nicht benutzt")),
    showView: () => {}, pushNav: () => {}, setCollection: () => {}, document: { querySelector: () => null }
  };
  const fn = new Function(...Object.keys(kontext), `${quelle}\nreturn statsBreakdownPanel;`);
  return fn(...Object.values(kontext));
}

const zeilen = (n) => Array.from({ length: n }, (_, i) => ({ name: `/seite-${i}/`, count: n - i }));

test("lange Listen zeigen zehn Zeilen und bieten den Rest an", () => {
  const html = panelAusQuelle()("Probe", zeilen(25));
  assert.equal((html.match(/<li class="stats-row">/g) || []).length, 10, "zehn sichtbare Zeilen");
  assert.equal((html.match(/<li hidden data-stats-mehr/g) || []).length, 15, "der Rest bleibt im Markup");
  assert.match(html, /stats-more">15 weitere anzeigen/);
});

test("kurze Listen bekommen keinen Knopf", () => {
  const html = panelAusQuelle()("Probe", zeilen(4));
  assert.doesNotMatch(html, /stats-more/);
  assert.equal((html.match(/<li hidden/g) || []).length, 0);
});

test("genau zehn Zeilen bleiben ohne Knopf", () => {
  const html = panelAusQuelle()("Probe", zeilen(10));
  assert.doesNotMatch(html, /stats-more/);
});

test("die Beitragsliste summiert auf die Zahl darüber", () => {
  // "Im Reader angezeigt" zählt alle Anzeigen, die Liste löst sie auf. Fiele
  // der Sammelpfad der importierten Historie aus der Liste, ergäbe sie weniger
  // als die Zahl, die sie erklären soll — und verdoppelte damit genau das
  // Missverständnis, gegen das sie gebaut wurde.
  const db = datenbank();
  const feedread = db.prepare("INSERT INTO daily_page (day, path, kind, source, hits) VALUES (?, ?, 'feedread', ?, ?)");
  feedread.run("2026-08-20", "/feed.xml", "goatcounter", 21);
  feedread.run("2026-08-24", "/heimaturlaub/", "live", 3);
  feedread.run("2026-08-24", "/steakberge/", "live", 2);

  const zeitraum = ["2026-08-17", "2026-08-30"];
  const kopfzahl = db.prepare(
    `SELECT COALESCE(SUM(hits), 0) AS hits FROM daily_page
     WHERE kind = 'feedread' AND day BETWEEN ? AND ? ${eineQuelle("feedread")}`
  ).get(...zeitraum).hits;
  const liste = db.prepare(
    `SELECT path, SUM(hits) AS hits FROM daily_page
     WHERE kind = 'feedread' AND day BETWEEN ? AND ? ${eineQuelle("feedread")}
     GROUP BY path`
  ).all(...zeitraum);

  assert.equal(kopfzahl, 26);
  assert.equal(liste.reduce((s, z) => s + z.hits, 0), kopfzahl, "Liste und Kopfzahl müssen übereinstimmen");
  assert.ok(liste.some((z) => z.path === "/feed.xml"), "die Historie gehört als eigene Zeile in die Liste");
});

test("Adressen aus fremden Kennungen werden nicht gespeichert", async () => {
  // Bot-Betreiber schreiben aus Höflichkeit ihre Kontaktadresse in die Kennung.
  // Für die Zuordnung eines Leseprogramms trägt sie nichts bei, und sie wäre
  // der einzige Personenbezug in einem Bestand, der sonst keinen enthält —
  // dieser Fall stand real in der Datenbank.
  const db = datenbank();
  await analyticsModul.recordFeedAgent(d1(db), "2026-08-24",
    "Blogosphere/1.0 (+https://blogosphere.app; ram@kramkarthik.com)");
  await analyticsModul.recordFeedAgent(d1(db), "2026-08-24", "FeedCity +https://feed.city");

  const gespeichert = db.prepare("SELECT agent FROM feed_agents ORDER BY agent").all().map((r) => r.agent);
  assert.ok(gespeichert.every((a) => !a.includes("@")), `keine Adresse: ${gespeichert.join(" | ")}`);
  // Die Domain bleibt stehen — sie ist der Anker, an dem die Zuordnung hängt.
  assert.ok(gespeichert.some((a) => a.includes("blogosphere.app")));
  assert.ok(gespeichert.some((a) => a.includes("feed.city")));
});

test("die Arbeitsliste wird mit den Rohdaten aufgeräumt", async () => {
  const db = datenbank();
  const alt = db.prepare("INSERT INTO feed_agents (day, agent, hits) VALUES (?, ?, 1)");
  alt.run("2025-01-01", "uralte Kennung");
  alt.run("2026-08-23", "frische Kennung");

  await analyticsModul.raeumeAuf(d1(db), "2026-08-23");

  const uebrig = db.prepare("SELECT agent FROM feed_agents").all().map((r) => r.agent);
  assert.deepEqual(uebrig, ["frische Kennung"]);
});

test("das Land landet beim Abrufer, nicht in den Rohdaten", async () => {
  // Ein Feed-Abruf schreibt keine Rohzeile. Das Land vorher an recordHit zu
  // reichen hiess, es zu ermitteln und wegzuwerfen — es gehoert dorthin, wo
  // eine Zeile je Abrufer und Tag ohnehin entsteht.
  const db = datenbank();
  await analyticsModul.recordFeedFetcher(d1(db), "2026-08-24", "hash-a", "freshrss", null, "DE");
  await analyticsModul.recordFeedFetcher(d1(db), "2026-08-24", "hash-b", "feedbin", 2, "US");
  // Ein zweiter Abruf desselben Abrufers ohne Landangabe darf sie nicht loeschen.
  await analyticsModul.recordFeedFetcher(d1(db), "2026-08-24", "hash-a", "freshrss", null, null);

  const zeilen = db.prepare("SELECT fetcher, reader, country FROM feed_fetchers ORDER BY fetcher").all();
  assert.deepEqual(zeilen.map((z) => z.country), ["DE", "US"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hits").get().n, 0, "Feeds schreiben keine Rohzeilen");
});

test("Laenderliste und Abonnentenzahl rechnen gleich", () => {
  // Beide Zahlen stammen aus feed_fetchers und stehen nebeneinander. Summierte
  // die eine Abruftage und naehme die andere den hoechsten Tageswert, laegen
  // sie um ein Vielfaches auseinander — und man muesste eine von beiden fuer
  // falsch halten. Dieselbe Fehlerfamilie wie beim Herkunftshinweis und bei
  // der Beitragsliste, deshalb hier festgehalten.
  const db = datenbank();
  const setze = db.prepare("INSERT INTO feed_fetchers (day, fetcher, reader, subscribers, country) VALUES (?, ?, 'freshrss', NULL, ?)");
  // Drei Tage, jeden Tag dieselben zwei deutschen und ein amerikanischer Leser.
  for (const tag of ["2026-08-24", "2026-08-25", "2026-08-26"]) {
    setze.run(tag, `de-1-${tag}`, "DE");
    setze.run(tag, `de-2-${tag}`, "DE");
    setze.run(tag, `us-1-${tag}`, "US");
  }
  const zeitraum = ["2026-08-24", "2026-08-26"];

  const laender = db.prepare(
    `SELECT country, MAX(n) AS n FROM (
       SELECT day, country, COUNT(*) AS n FROM feed_fetchers
       WHERE country IS NOT NULL AND day BETWEEN ? AND ?
       GROUP BY day, country
     ) GROUP BY country ORDER BY n DESC`
  ).all(...zeitraum)
    // node:sqlite liefert Zeilen ohne Prototyp; deepEqual unterscheidet das.
    .map((zeile) => ({ country: zeile.country, n: zeile.n }));
  const installationen = db.prepare(
    `SELECT COALESCE(MAX(n), 0) AS n FROM (
       SELECT COUNT(*) AS n FROM feed_fetchers
       WHERE day BETWEEN ? AND ? AND subscribers IS NULL GROUP BY day)`
  ).get(...zeitraum).n;

  assert.deepEqual(laender, [{ country: "DE", n: 2 }, { country: "US", n: 1 }]);
  assert.equal(laender.reduce((s, l) => s + l.n, 0), installationen,
    "die Summe der Laender muss die Zahl der Installationen ergeben, nicht ein Vielfaches");
});

test("die Besucherzeile steht im richtigen Fall und schweigt bei null", () => {
  const quelle = fs.readdirSync(path.join(__dirname, "../blog/admin/admin-src"))
    .filter((name) => /^21/.test(name)).sort()
    .map((name) => fs.readFileSync(path.join(__dirname, "../blog/admin/admin-src", name), "utf8")).join("\n");
  const kontext = {
    els: { statsBody: { innerHTML: "" } },
    escapeHtml: (v) => String(v ?? ""),
    window: { RWIcons: null },
    state: { statsPeriod: {}, statsCache: new Map(), statsPromises: new Map(), statsControllers: new Map(), statsRequest: 0 },
    fetch: () => Promise.reject(new Error("nicht benutzt")),
    showView: () => {}, pushNav: () => {}, setCollection: () => {}, document: { querySelector: () => null }
  };
  const zeile = new Function(...Object.keys(kontext), `${quelle}\nreturn statsBesucherZeile;`)(...Object.values(kontext));
  const toggle = (zahl) => ({ querySelector: () => (zahl === null ? null : { textContent: zahl }) });
  const text = (b, a) => zeile(b, toggle(a)).replace(/<[^>]+>/g, "");

  // "von … Besuchern" verlangt den Dativ, "… Besucher" allein den Nominativ.
  assert.equal(text(31, "47"), "47 Aufrufe von 31 Besuchern");
  assert.equal(text(1, "47"), "47 Aufrufe von 1 Besucher");
  assert.equal(text(5, null), "5 Besucher");
  // Ohne gemessene Besucher — etwa für Zeiträume vor der eigenen Zählung —
  // bleibt die Zeile weg, statt eine Null zu behaupten.
  assert.equal(zeile(0, toggle("47")), "");
  assert.equal(zeile(undefined, toggle("47")), "");
});
