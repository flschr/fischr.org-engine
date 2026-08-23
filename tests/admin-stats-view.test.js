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

// Nur die Statistik-Bausteine: Der vollständige Admin-Quelltext führt beim
// Auswerten seinen Startcode aus und verlangt Dinge, die es hier nicht gibt.
function statsAnsicht(namen, els = {}) {
  const verzeichnis = path.join(__dirname, "../blog/admin/admin-src");
  const quelle = fs.readdirSync(verzeichnis)
    .filter((name) => /^21/.test(name)).sort()
    .map((name) => fs.readFileSync(path.join(verzeichnis, name), "utf8"))
    .join("\n");
  const kontext = {
    els: { statsBody: { innerHTML: "", querySelector: () => null }, ...els },
    escapeHtml: (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    window: { RWIcons: null },
    state: {
      statsPeriod: { preset: "week", from: "", to: "" },
      statsCache: new Map(), statsPromises: new Map(), statsControllers: new Map(), statsRequest: 0,
      socialConfig: { siteUrl: "https://example.com" }
    },
    fetch: () => Promise.reject(new Error("nicht benutzt")),
    showView: () => {}, pushNav: () => {}, setCollection: () => {},
    document: { querySelector: () => null, getElementById: () => null }
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
  assert.doesNotMatch(markup, /Woher gelesen|Woher abgerufen/);
  assert.doesNotMatch(markup, /nur aus eigener Messung|Abruftage je Land|geschätzte Abonnenten je Programm/);
  assert.doesNotMatch(markup, /stats-panel-hint/);
});

// --- Der freie Zeitraum ------------------------------------------------------

function wähler(von, bis) {
  const els = {
    statsFrom: { value: von, focus() {} }, statsTo: { value: bis },
    statsCustom: { hidden: false },
    statsCustomToggle: { setAttribute() {}, focus() {} },
    statsCustomHint: { hidden: true, textContent: "" },
    statsRange: null, statsRangeLabel: null
  };
  return statsAnsicht(["applyStatsPicker", "openStatsPicker", "closeStatsPicker"], els);
}

test("ein unvollständiger Zeitraum bleibt im Wähler stehen und sagt, was fehlt", () => {
  const { applyStatsPicker, kontext } = wähler("2026-08-01", "");
  applyStatsPicker();
  assert.equal(kontext.state.statsPeriod.preset, "week", "die Ansicht dahinter bleibt, wie sie war");
  assert.equal(kontext.els.statsCustom.hidden, false, "der Wähler bleibt offen");
  assert.match(kontext.els.statsCustomHint.textContent, /Beide Tage/);
});

test("ein verdrehter Zeitraum wird abgefangen, nicht geladen", () => {
  const { applyStatsPicker, kontext } = wähler("2026-08-20", "2026-08-01");
  applyStatsPicker();
  assert.equal(kontext.state.statsPeriod.preset, "week");
  assert.match(kontext.els.statsCustomHint.textContent, /liegt nach/);
});

test("zwei gültige Tage schließen den Wähler und setzen den Zeitraum", () => {
  const { applyStatsPicker, kontext } = wähler("2026-08-01", "2026-08-20");
  applyStatsPicker();
  assert.deepEqual(kontext.state.statsPeriod, { preset: "custom", from: "2026-08-01", to: "2026-08-20" });
  assert.equal(kontext.els.statsCustom.hidden, true);
});

test("der Wähler öffnet mit dem Zeitraum, der gerade zu sehen ist", () => {
  const { openStatsPicker, kontext } = wähler("", "");
  // Ein Wähler, der bei "TT.MM.JJJJ" beginnt, verlangt zwei vollständige Daten,
  // obwohl meist nur eine Grenze verschoben werden soll.
  kontext.state.statsPeriod = { preset: "month", from: "", to: "" };
  openStatsPicker();
  assert.match(kontext.els.statsFrom.value, /^\d{4}-\d{2}-01$/, "der Monatserste steht schon im Feld");
  assert.match(kontext.els.statsTo.value, /^\d{4}-\d{2}-\d{2}$/);
});
