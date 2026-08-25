// Zeitraumrechnung ist die eine Stelle in diesem Dashboard, an der ein
// Off-by-one nicht auffällt: Ein Fenster, das einen Tag zu kurz ist oder am
// Monatsersten zusammenklappt, liefert plausible Zahlen — nur eben die
// falschen. Deshalb werden die Grenzen hier wirklich ausgerechnet und nicht
// bloß im Quelltext wiedererkannt.
process.env.TZ = "Europe/Berlin";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const adminI18nStub = require("./helpers/admin-i18n-stub");

// Das Modul wird als Text gelesen und in eine Funktion gehüllt, damit `Date` überdeckt werden
// kann (siehe moduleAt). Dafür müssen die ESM-Schlüsselwörter weg — der Import von t()/
// currentLocale() (00a-i18n.js) reicht der Test als Parameter herein, wie admin-stats-source.js
// es für die übrigen Stats-Module schon tut.
const SOURCE = fs
  .readFileSync(path.join(__dirname, "../blog/admin/admin-src/21b-stats-period.js"), "utf8")
  .replace(/^import[^\n]*\n/gm, "")
  .replace(/^export /gm, "");

let adminI18n;
test.before(async () => {
  adminI18n = await adminI18nStub();
});

// Das Part liegt im Browser in einer großen Closure. Für den Test wird es in
// eine Funktion gehüllt, deren Parameter `Date` die globale Klasse überdeckt —
// so ist "jetzt" ein fester Zeitpunkt statt der Uhr des Testrechners.
function moduleAt(iso) {
  const fixed = new Date(iso).getTime();
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  const factory = new Function(
    "Date", "t", "currentLocale",
    `${SOURCE}\nreturn { statsPeriodBounds, statsPeriodKey, statsPeriodLabel, statsIsPreset };`
  );
  return factory(FixedDate, adminI18n.t, adminI18n.currentLocale);
}

const local = (iso) => {
  const date = new Date(iso);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()];
};

const preset = (name) => ({ preset: name, from: "", to: "" });

test("jedes Fenster zählt den heutigen Tag mit", () => {
  const module = moduleAt("2026-08-24T09:15:00+02:00");
  assert.deepEqual(local(module.statsPeriodBounds(preset("1d")).start), [2026, 8, 24, 0]);
  assert.deepEqual(local(module.statsPeriodBounds(preset("7d")).start), [2026, 8, 18, 0]);
  assert.deepEqual(local(module.statsPeriodBounds(preset("30d")).start), [2026, 7, 26, 0]);
  assert.deepEqual(local(module.statsPeriodBounds(preset("90d")).start), [2026, 5, 27, 0]);
  assert.deepEqual(local(module.statsPeriodBounds(preset("365d")).start), [2025, 8, 25, 0]);
});

// Der Grund für die ganze Umstellung: Kalenderzeiträume fielen am Wochen-,
// Monats- und Jahreswechsel auf einen einzigen Tag zusammen und zeigten eine
// Null, die zwar stimmte, aber nichts erzählte.
test("das Fenster klappt am Wochen-, Monats- und Jahreswechsel nicht zusammen", () => {
  const montagFrueh = moduleAt("2026-08-24T00:20:00+02:00");
  assert.deepEqual(local(montagFrueh.statsPeriodBounds(preset("7d")).start), [2026, 8, 18, 0]);

  const monatsErster = moduleAt("2026-09-01T08:00:00+02:00");
  assert.deepEqual(local(monatsErster.statsPeriodBounds(preset("30d")).start), [2026, 8, 3, 0]);

  const neujahr = moduleAt("2027-01-01T10:00:00+01:00");
  assert.deepEqual(local(neujahr.statsPeriodBounds(preset("90d")).start), [2026, 10, 4, 0]);
  assert.deepEqual(local(neujahr.statsPeriodBounds(preset("365d")).start), [2026, 1, 2, 0]);
});

// Über die Zeitumstellung hinweg zählt das Fenster Kalendertage, nicht
// 24-Stunden-Blöcke: Sonst begänne es nach der Umstellung um 23 oder 1 Uhr.
test("die Zeitumstellung verschiebt den Fensterbeginn nicht", () => {
  const nachSommerzeit = moduleAt("2026-03-30T12:00:00+02:00");
  assert.deepEqual(local(nachSommerzeit.statsPeriodBounds(preset("7d")).start), [2026, 3, 24, 0]);

  const nachWinterzeit = moduleAt("2026-10-26T12:00:00+01:00");
  assert.deepEqual(local(nachWinterzeit.statsPeriodBounds(preset("7d")).start), [2026, 10, 20, 0]);
});

test("das Ende ist die laufende Stunde, nicht der Tagesbeginn", () => {
  const module = moduleAt("2026-08-22T14:37:12+02:00");
  const { end } = module.statsPeriodBounds(preset("30d"));
  assert.deepEqual(local(end), [2026, 8, 22, 14]);
});

test("freier Zeitraum umfasst den Schlusstag vollständig", () => {
  const module = moduleAt("2026-08-22T14:30:00+02:00");
  const bounds = module.statsPeriodBounds({ preset: "custom", from: "2026-01-05", to: "2026-01-09" });
  assert.deepEqual(local(bounds.start), [2026, 1, 5, 0]);
  assert.deepEqual(local(bounds.end), [2026, 1, 9, 23]);
});

test("unvollständiger oder verdrehter freier Zeitraum liefert keine Grenzen", () => {
  const module = moduleAt("2026-08-22T14:30:00+02:00");
  assert.equal(module.statsPeriodBounds({ preset: "custom", from: "2026-01-05", to: "" }), null);
  assert.equal(module.statsPeriodBounds({ preset: "custom", from: "", to: "2026-01-09" }), null);
  assert.equal(module.statsPeriodBounds({ preset: "custom", from: "2026-02-01", to: "2026-01-09" }), null);
  assert.equal(module.statsPeriodBounds({ preset: "custom", from: "05.01.2026", to: "09.01.2026" }), null);
  assert.equal(module.statsPeriodBounds(preset("nonsense")), null);
});

test("der Cache-Schlüssel trennt zwei verschiedene freie Zeiträume", () => {
  const module = moduleAt("2026-08-22T14:30:00+02:00");
  const first = { preset: "custom", from: "2026-01-01", to: "2026-03-31" };
  const second = { preset: "custom", from: "2026-04-01", to: "2026-06-30" };
  assert.notEqual(module.statsPeriodKey(first), module.statsPeriodKey(second));
  assert.equal(module.statsPeriodKey(preset("7d")), "7d");
});

// Die alten Kalendernamen sind keine Presets mehr. Bliebe "week" gültig,
// lieferte statsPeriodBounds dafür null und die Ansicht bliebe leer.
test("nur bekannte Presets werden akzeptiert", () => {
  const module = moduleAt("2026-08-22T14:30:00+02:00");
  for (const name of ["1d", "7d", "30d", "90d", "365d", "custom"]) {
    assert.equal(module.statsIsPreset(name), true, name);
  }
  for (const name of ["week", "month", "quarter", "year", "7", ""]) {
    assert.equal(module.statsIsPreset(name), false, name);
  }
});

test("ein Tag heißt in der Beschriftung Heute, nicht Letzte 1 Tage", () => {
  const module = moduleAt("2026-08-24T09:15:00+02:00");
  assert.equal(module.statsPeriodLabel(preset("1d")), "Heute · 24. Aug.");
});

test("die Beschriftung nennt Fensterlänge und Grenzen", () => {
  const module = moduleAt("2026-08-24T09:15:00+02:00");
  assert.equal(module.statsPeriodLabel(preset("7d")), "Letzte 7 Tage · 18. Aug. – 24. Aug.");
  // Ein Jahresfenster beginnt im Vorjahr — ohne Jahreszahl läse sich
  // "25. Aug – 24. Aug" wie ein einziger Tag mit Tippfehler.
  assert.equal(module.statsPeriodLabel(preset("365d")), "Letzte 365 Tage · 25. Aug. 2025 – 24. Aug. 2026");
});

test("die Beschriftung benennt den unvollständigen Zeitraum, statt zu schweigen", () => {
  const module = moduleAt("2026-08-22T14:30:00+02:00");
  assert.match(module.statsPeriodLabel({ preset: "custom", from: "2026-01-05", to: "" }), /Von und Bis/);
  assert.match(module.statsPeriodLabel({ preset: "custom", from: "2026-02-01", to: "2026-01-09" }), /liegt nach/);
  assert.equal(module.statsPeriodLabel(preset("nonsense")), "");
});

// Ein Objektliteral hätte für "constructor" die geerbte Funktion geliefert;
// daraus wurde ein Invalid Date, das erst im toISOString auffliegt.
test("geerbte Objektschlüssel sind keine Zeitfenster", () => {
  const module = moduleAt("2026-08-22T14:30:00+02:00");
  for (const name of ["constructor", "toString", "hasOwnProperty"]) {
    assert.equal(module.statsIsPreset(name), false, name);
    assert.equal(module.statsPeriodBounds(preset(name)), null, name);
    assert.equal(module.statsPeriodLabel(preset(name)), "", name);
  }
});
