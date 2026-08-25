// Die Statistik-Ansicht behauptet nur, was sie zeigen kann.
//
// Zwei Stellen, an denen das leicht kippt: Der Verlauf zeichnet eine Kurve, die
// ohne Beschriftung jeden beliebigen Zeitraum meinen könnte — und der
// Zeitraumwähler darf die Ansicht nicht auf einen Zeitraum ziehen, den es noch
// nicht gibt.
process.env.TZ = "Europe/Berlin";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const adminStatsSource = require("./helpers/admin-stats-source");
const adminI18nStub = require("./helpers/admin-i18n-stub");

let adminI18n;
test.before(async () => {
  adminI18n = await adminI18nStub();
});

// Nur die Statistik-Bausteine: Der vollständige Admin-Quelltext führt beim
// Auswerten seinen Startcode aus und verlangt Dinge, die es hier nicht gibt.
function statsAnsicht(namen, els = {}) {
  const quelle = adminStatsSource();
  const kontext = {
    els: { statsBody: { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] }, ...els },
    escapeHtml: (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    window: { RWIcons: null },
    state: {
      statsPeriod: { preset: "7d", from: "", to: "" },
      statsCache: new Map(), statsPromises: new Map(), statsControllers: new Map(), statsRequest: 0,
      socialConfig: { siteUrl: "https://example.com" }
    },
    fetch: () => Promise.reject(new Error("nicht benutzt")),
    showView: () => {}, pushNav: () => {}, setCollection: () => {},
    document: { querySelector: () => null, getElementById: () => null },
    t: adminI18n.t, currentLocale: adminI18n.currentLocale
  };
  const fn = new Function(...Object.keys(kontext), `${quelle}\nreturn { ${namen.join(", ")} };`);
  const modul = fn(...Object.values(kontext));
  return { ...modul, kontext };
}

const tagesreihe = (von, bis, treffer = {}) => {
  const rows = [];
  const tag = new Date(`${von}T12:00:00`);
  const ende = new Date(`${bis}T12:00:00`);
  while (tag <= ende) {
    const tagString = tag.toISOString().slice(0, 10);
    if (treffer[tagString]) rows.push({ day: tagString, hits: treffer[tagString] });
    tag.setDate(tag.getDate() + 1);
  }
  return rows;
};

// --- Der Verlauf -------------------------------------------------------------

test("jeder Punkt der Kurve weiß, für welchen Tag er steht", () => {
  const { statsSeries } = statsAnsicht(["statsSeries"]);
  const reihe = statsSeries(
    [{ day: "2026-08-01", hits: 4 }, { day: "2026-08-03", hits: 9 }],
    { start: "2026-08-01", end: "2026-08-03" }
  );
  assert.deepEqual(reihe.map((punkt) => punkt.tag), ["2026-08-01", "2026-08-02", "2026-08-03"]);
});

test("ein gebündelter Punkt trägt seine Spanne, nicht nur seinen ersten Tag", () => {
  const { statsSeries } = statsAnsicht(["statsSeries"]);
  // Über 500 Tage: Die Punkte werden zu Eimern zusammengefasst. Ein Eimer, der
  // mit dem Datum seines ersten Tages beschriftet wäre, behauptete einen
  // Tageswert — dahinter stecken aber drei Tage.
  const reihe = statsSeries(
    tagesreihe("2025-04-06", "2026-08-22", { "2025-04-06": 5, "2026-08-22": 9 }),
    { start: "2025-04-06", end: "2026-08-22" }
  );
  assert.ok(reihe.length <= 200);
  assert.ok(reihe.every((punkt) => punkt.bis && punkt.bis >= punkt.tag), "jeder Eimer kennt seinen letzten Tag");
  assert.equal(reihe[0].tag, "2025-04-06");
  assert.equal(reihe.at(-1).bis, "2026-08-22", "der letzte Eimer endet am letzten Tag");
});

test("der Verlauf benennt seine Spitze und seine beiden Enden", () => {
  const { statsChart, statsSeries } = statsAnsicht(["statsChart", "statsSeries"]);
  const markup = statsChart(statsSeries(
    [{ day: "2026-08-01", hits: 4 }, { day: "2026-08-02", hits: 141 }, { day: "2026-08-03", hits: 9 }],
    { start: "2026-08-01", end: "2026-08-03" }
  ));
  // Ohne Maus und ohne Berührung: Was die Kurve zeigt, steht als Text daneben.
  assert.match(markup, /Höchster Wert/);
  assert.match(markup, /2\. Aug/, "die Spitze wird benannt");
  assert.match(markup, /141 Aufrufe/);
  assert.match(markup, /stats-chart-axis"><span>1\. Aug\.?<\/span><span>3\. Aug/, "beide Enden der Zeitachse stehen darunter");
});

test("der Verlauf gibt jedem Punkt seine Beschriftung mit, nicht nur der Spitze", () => {
  const { statsChart, statsSeries } = statsAnsicht(["statsChart", "statsSeries"]);
  const markup = statsChart(statsSeries(
    [{ day: "2026-08-01", hits: 4 }, { day: "2026-08-02", hits: 141 }],
    { start: "2026-08-01", end: "2026-08-03" }
  ));
  const daten = JSON.parse(markup.match(/data-punkte="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.equal(daten.length, 3, "drei Kalendertage, drei ablesbare Punkte");
  assert.deepEqual(daten.map((punkt) => punkt.w), [4, 141, 0]);
  assert.ok(daten.every((punkt) => typeof punkt.l === "string" && punkt.l), "jeder Punkt ist benannt");
});

// --- Der stündliche Verlauf ("Heute") ----------------------------------------

test("ein Tag füllt sich zu vierundzwanzig Stunden auf", () => {
  const { statsSeries } = statsAnsicht(["statsSeries"]);
  const reihe = statsSeries(
    [{ day: "2026-08-24T09", hits: 4 }, { day: "2026-08-24T14", hits: 9 }],
    { start: "2026-08-24", end: "2026-08-24" },
    "hour"
  );
  assert.equal(reihe.length, 24, "vierundzwanzig Stunden, vierundzwanzig Punkte");
  assert.equal(reihe[9].daily, 4);
  assert.equal(reihe[14].daily, 9);
  assert.equal(reihe[0].daily, 0, "Stunden ohne Treffer füllen sich mit null");
  assert.equal(reihe[0].tag, "2026-08-24T00");
});

test("die stündliche Kurve beschriftet ihre Punkte mit der Uhrzeit", () => {
  const { statsChart, statsSeries } = statsAnsicht(["statsChart", "statsSeries"]);
  const markup = statsChart(
    statsSeries([{ day: "2026-08-24T14", hits: 141 }], { start: "2026-08-24", end: "2026-08-24" }, "hour"),
    "Aufrufe",
    "hour"
  );
  assert.match(markup, /141 Aufrufe/);
  assert.match(markup, /14:00/, "die Spitze zeigt eine Uhrzeit, kein Datum");
  assert.match(markup, /stats-chart-axis"><span>00:00<\/span><span>23:00/, "die Achse zeigt die erste und letzte Stunde");
});

test("der Feed-Verlauf zählt Abrufe, nicht Aufrufe", () => {
  // Zwei Kurven, zwei Einheiten: Die Website zählt Menschen beim Aufrufen, der
  // Feed Programme beim Abholen. Eine mit "Aufrufe" beschriftete Feed-Kurve
  // behauptete Leser, wo Abrufe gemessen wurden.
  const { statsChart, statsSeries } = statsAnsicht(["statsChart", "statsSeries"]);
  const reihe = statsSeries(
    [{ day: "2026-08-01", hits: 40 }, { day: "2026-08-02", hits: 402 }],
    { start: "2026-08-01", end: "2026-08-02" }
  );
  const feed = statsChart(reihe, "Abrufe");
  assert.match(feed, /402 Abrufe/);
  assert.match(feed, /aria-label="Verlauf der Abrufe\./);
  assert.match(feed, /data-einheit="Abrufe"/, "die Einheit steht auch für die Bedienung an der Kurve");
  assert.doesNotMatch(feed, /Aufrufe/);
  // Ohne Angabe bleibt es bei den Aufrufen der Website.
  assert.match(statsChart(reihe), /402 Aufrufe/);
});

test("beide Abschnitte bekommen ihren Verlauf, jeder mit seiner Einheit", () => {
  const { renderStats, kontext } = statsAnsicht(["renderStats"]);
  renderStats({
    range: { start: "2026-08-01", end: "2026-08-03" },
    total: { hits: 12, visitors: 4, feed: 30 },
    series: [{ day: "2026-08-01", hits: 12 }],
    feedSeries: [{ day: "2026-08-02", hits: 30 }],
    pages: [], refs: [], countries: [], feedCountries: [], feedPages: [], feedReaders: []
  });
  const markup = kontext.els.statsBody.innerHTML;
  assert.equal(markup.match(/class="stats-chart"/g).length, 2, "Website und Feed haben je eine Kurve");
  assert.match(markup, /data-einheit="Aufrufe"/);
  assert.match(markup, /data-einheit="Abrufe"/);
});

test("ohne Feed-Reihe bleibt die Stelle leer statt eine Nulllinie zu zeichnen", () => {
  // Eine ältere Antwort aus dem Zwischenspeicher kennt die Reihe noch nicht.
  // Eine Kurve aus lauter Nullen behauptete einen Feed, den niemand geholt hat.
  const { renderStats, kontext } = statsAnsicht(["renderStats"]);
  renderStats({
    range: { start: "2026-08-01", end: "2026-08-03" },
    total: { hits: 12, visitors: 4, feed: 30 },
    series: [{ day: "2026-08-01", hits: 12 }],
    pages: [], refs: [], countries: [], feedCountries: [], feedPages: [], feedReaders: []
  });
  const markup = kontext.els.statsBody.innerHTML;
  assert.equal(markup.match(/class="stats-chart"/g).length, 1);
  assert.doesNotMatch(markup, /data-einheit="Abrufe"/);
});

test("eine Kurve aus einem einzigen Punkt wird nicht gezeichnet", () => {
  const { statsChart, statsSeries } = statsAnsicht(["statsChart", "statsSeries"]);
  // Zwei Punkte sind das Minimum für eine Linie; einer wäre ein Strich, der
  // eine Entwicklung behauptet, die niemand gemessen hat.
  assert.equal(statsChart(statsSeries([{ day: "2026-08-01", hits: 4 }], null)), "");
});

// --- Die Listen --------------------------------------------------------------

test("die Listen heißen nach dem, was in ihnen steht — ohne Erklärzeile", () => {
  const { renderStats, kontext } = statsAnsicht(["renderStats"]);
  renderStats({
    range: { start: "2026-08-01", end: "2026-08-03" },
    total: { hits: 12, visitors: 4, feed: 30 },
    series: [{ day: "2026-08-01", hits: 12 }],
    pages: [{ path: "/", title: "Start", hits: 12 }],
    refs: [{ name: "(direkt)", host: "", hits: 12 }],
    countries: [{ country: "DE", hits: 9 }],
    feedCountries: [{ country: "DE", hits: 4 }],
    feedPages: [{ path: "/beitrag/", title: "Beitrag", hits: 2 }],
    feedReaders: [{ reader: "miniflux", subscribers: null, abos: 3, hits: 19 }]
  });
  const markup = kontext.els.statsBody.innerHTML;
  assert.match(markup, />Länder</);
  assert.match(markup, />Feed-Leser \(geschätzt\)</);
  // Beide Abschnitte in derselben Reihenfolge: was gelesen wurde, worüber,
  // von wo. Anders herum beantwortete dieselbe Spalte oben und unten eine
  // andere Frage.
  const reihenfolge = ["Seiten", "Quellen", "Länder", "Beiträge im Reader", "Feed-Leser (geschätzt)", "Länder"];
  assert.deepEqual(
    [...markup.matchAll(/class="stats-panel-title">([^<]+)</g)].map((treffer) => treffer[1]),
    reihenfolge
  );
  assert.doesNotMatch(markup, /Woher gelesen|Woher abgerufen/);
  assert.doesNotMatch(markup, /nur aus eigener Messung|Abruftage je Land|geschätzte Abonnenten je Programm/);
  assert.doesNotMatch(markup, /stats-panel-hint/);
});

// --- Der freie Zeitraum: ein Kalender ----------------------------------------
//
// Zwei Tippfelder wurden durch einen Kalender mit zwei Klicks ersetzt, wie
// auf den Datumswählern der Reiseportale — der erste Klick setzt den ersten
// Tag, der zweite den letzten. Ein verdrehter Zeitraum kann dabei gar nicht
// erst entstehen (siehe statsRangeKlick), die Fehlermeldung dafür ist damit
// weg; was bleibt, ist eine unvollständige Auswahl, wenn "Anzeigen" trotz
// deaktiviertem Knopf aufgerufen wird.

test("statsRangeKlick setzt zwei Klicks in eine Spanne um, nie verdreht", () => {
  const { statsRangeKlick } = statsAnsicht(["statsRangeKlick"]);
  assert.deepEqual(statsRangeKlick({ von: "", bis: "" }, "2026-08-10"), { von: "2026-08-10", bis: "" });
  assert.deepEqual(statsRangeKlick({ von: "2026-08-10", bis: "" }, "2026-08-20"), { von: "2026-08-10", bis: "2026-08-20" });
  // Ein Klick vor dem ersten Tag tauscht die Rollen, statt eine verdrehte
  // Spanne zuzulassen — genau der Fall, der früher "liegt nach" meldete.
  assert.deepEqual(statsRangeKlick({ von: "2026-08-10", bis: "" }, "2026-08-01"), { von: "2026-08-01", bis: "2026-08-10" });
  // Eine bereits geschlossene Spanne beginnt bei einem weiteren Klick neu,
  // statt eine ihrer beiden Grenzen zu verschieben.
  assert.deepEqual(statsRangeKlick({ von: "2026-08-01", bis: "2026-08-10" }, "2026-08-15"), { von: "2026-08-15", bis: "" });
  // Derselbe Tag zweimal ist ein gültiger Ein-Tag-Zeitraum.
  assert.deepEqual(statsRangeKlick({ von: "2026-08-10", bis: "" }, "2026-08-10"), { von: "2026-08-10", bis: "2026-08-10" });
});

test("statsKalenderTage füllt das Blatt auf volle Wochen auf, Montag zuerst", () => {
  const { statsKalenderTage } = statsAnsicht(["statsKalenderTage"]);
  // Der 1. August 2026 ist ein Samstag — das Blatt beginnt schon am Montag davor.
  const tage = statsKalenderTage(new Date(2026, 7, 1));
  assert.equal(tage.length, 42, "sechs volle Wochen");
  assert.equal(tage[0].getDay(), 1, "die erste Zelle ist ein Montag");
  assert.deepEqual([tage[0].getFullYear(), tage[0].getMonth() + 1, tage[0].getDate()], [2026, 7, 27]);
  assert.deepEqual([tage.at(-1).getFullYear(), tage.at(-1).getMonth() + 1, tage.at(-1).getDate()], [2026, 9, 6]);
});

function kalenderWähler() {
  const els = {
    statsCustom: { hidden: false },
    statsCustomToggle: { setAttribute() {}, focus() {} },
    statsCustomHint: { hidden: true, textContent: "" },
    statsCalGrid: { innerHTML: "", querySelector: () => null },
    statsCalMonth: { textContent: "" },
    statsCalRange: { textContent: "" },
    statsCustomApply: { disabled: false, focus() {} },
    statsRange: null, statsRangeLabel: null
  };
  return statsAnsicht(["applyStatsPicker", "statsCalendarClick", "openStatsPicker", "closeStatsPicker"], els);
}

test("eine unvollständige Auswahl lässt sich nicht anzeigen", () => {
  // Über die Bedienung unerreichbar — der Anzeigen-Knopf ist deaktiviert,
  // solange kein voller Zeitraum feststeht. Die Funktion bleibt trotzdem
  // defensiv, falls sie doch aufgerufen wird.
  const { applyStatsPicker, statsCalendarClick, kontext } = kalenderWähler();
  statsCalendarClick("2026-08-01");
  applyStatsPicker();
  assert.equal(kontext.state.statsPeriod.preset, "7d", "die Ansicht dahinter bleibt, wie sie war");
  assert.equal(kontext.els.statsCustom.hidden, false, "der Kalender bleibt offen");
  assert.match(kontext.els.statsCustomHint.textContent, /ersten und den letzten Tag/);
});

test("zwei Klicks im Kalender schließen ihn und setzen den Zeitraum", () => {
  const { applyStatsPicker, statsCalendarClick, kontext } = kalenderWähler();
  statsCalendarClick("2026-08-01");
  statsCalendarClick("2026-08-20");
  applyStatsPicker();
  assert.deepEqual(kontext.state.statsPeriod, { preset: "custom", from: "2026-08-01", to: "2026-08-20" });
  assert.equal(kontext.els.statsCustom.hidden, true);
});

// Vorher erledigte die Eingabetaste im zweiten Datumsfeld beides in einem
// Tastendruck: Feld verlassen und anzeigen. Der Klick, der die Spanne
// schließt, muss deshalb selbst schon zum Anzeigen-Knopf springen — sonst
// braucht dieselbe Auswahl jetzt einen Tabschritt mehr als vorher.
test("der schließende Klick springt zum Anzeigen-Knopf, nicht zurück auf die Tageszelle", () => {
  const { statsCalendarClick, kontext } = kalenderWähler();
  let angeklickteZelle = false;
  let apply = false;
  kontext.els.statsCalGrid.querySelector = () => ({ focus: () => { angeklickteZelle = true; } });
  kontext.els.statsCustomApply.focus = () => { apply = true; };
  statsCalendarClick("2026-08-01"); // erster Klick: Auswahl bleibt offen
  assert.equal(angeklickteZelle, true, "der erste Klick bleibt im Kalender");
  assert.equal(apply, false);
  angeklickteZelle = false;
  statsCalendarClick("2026-08-20"); // zweiter Klick: Spanne ist vollständig
  assert.equal(apply, true, "der schließende Klick geht direkt zum Anzeigen-Knopf");
  assert.equal(angeklickteZelle, false);
});

test("ein Klick vor dem ersten Tag tauscht die Rollen, statt einen verdrehten Zeitraum zu setzen", () => {
  const { applyStatsPicker, statsCalendarClick, kontext } = kalenderWähler();
  statsCalendarClick("2026-08-20");
  statsCalendarClick("2026-08-01");
  applyStatsPicker();
  assert.deepEqual(kontext.state.statsPeriod, { preset: "custom", from: "2026-08-01", to: "2026-08-20" });
});

test("der Kalender öffnet mit dem Zeitraum, der gerade zu sehen ist", () => {
  // Ein Kalender, der bei einer leeren Auswahl beginnt, verlangt zwei neue
  // Klicks, obwohl meist nur eine Grenze verschoben werden soll.
  const { openStatsPicker, kontext } = kalenderWähler();
  kontext.state.statsPeriod = { preset: "30d", from: "", to: "" };
  openStatsPicker();
  assert.doesNotMatch(kontext.els.statsCalRange.textContent, /wählen/, "beide Grenzen des Fensters stehen schon da");
  assert.match(kontext.els.statsCalRange.textContent, / – /, "von und bis stehen nebeneinander");
  assert.equal(kontext.els.statsCustomApply.disabled, false, "eine vollständige Auswahl darf sofort angezeigt werden");
});
