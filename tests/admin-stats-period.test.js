// Kalenderrechnung ist die eine Stelle in diesem Dashboard, an der ein
// Off-by-one nicht auffällt: Eine Woche, die am Sonntag beginnt, oder ein
// Quartal, das im falschen Monat startet, liefert plausible Zahlen — nur eben
// die falschen. Deshalb werden die Grenzen hier wirklich ausgerechnet und nicht
// bloß im Quelltext wiedererkannt.
process.env.TZ = "Europe/Berlin";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// Das Modul wird als Text gelesen und in eine Funktion gehüllt, damit `Date` überdeckt werden
// kann (siehe moduleAt). Dafür müssen die ESM-Schlüsselwörter weg — die Datei ist ein Blatt und
// importiert nichts, es bleibt also beim Abstreifen des vorangestellten `export`.
const SOURCE = fs
  .readFileSync(path.join(__dirname, "../blog/admin/admin-src/21b-stats-period.js"), "utf8")
  .replace(/^export /gm, "");

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
    "Date",
    `${SOURCE}\nreturn { statsPeriodBounds, statsPeriodKey, statsPeriodLabel, statsIsPreset };`
  );
  return factory(FixedDate);
}

const local = (iso) => {
  const date = new Date(iso);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()];
};

const preset = (name) => ({ preset: name, from: "", to: "" });

test("Woche beginnt am Montag, auch am Samstag und am Sonntag", () => {
  const saturday = moduleAt("2026-08-22T14:30:00+02:00");
  assert.deepEqual(local(saturday.statsPeriodBounds(preset("week")).start), [2026, 8, 17, 0]);

  const sunday = moduleAt("2026-08-23T09:00:00+02:00");
  assert.deepEqual(local(sunday.statsPeriodBounds(preset("week")).start), [2026, 8, 17, 0]);

  const monday = moduleAt("2026-08-17T06:00:00+02:00");
  assert.deepEqual(local(monday.statsPeriodBounds(preset("week")).start), [2026, 8, 17, 0]);
});

test("Monat, Quartal und Jahr beginnen am Kalenderanfang", () => {
  const august = moduleAt("2026-08-22T14:30:00+02:00");
  assert.deepEqual(local(august.statsPeriodBounds(preset("month")).start), [2026, 8, 1, 0]);
  assert.deepEqual(local(august.statsPeriodBounds(preset("quarter")).start), [2026, 7, 1, 0]);
  assert.deepEqual(local(august.statsPeriodBounds(preset("year")).start), [2026, 1, 1, 0]);
});

test("jedes Quartal startet im richtigen Monat", () => {
  const starts = {
    "2026-02-11T12:00:00+01:00": 1,
    "2026-05-31T23:30:00+02:00": 4,
    "2026-09-01T00:30:00+02:00": 7,
    "2026-12-24T18:00:00+01:00": 10
  };
  for (const [now, month] of Object.entries(starts)) {
    const module = moduleAt(now);
    assert.deepEqual(local(module.statsPeriodBounds(preset("quarter")).start)[1], month, now);
  }
});

test("das Ende ist die laufende Stunde, nicht der Tagesbeginn", () => {
  const module = moduleAt("2026-08-22T14:37:12+02:00");
  const { end } = module.statsPeriodBounds(preset("month"));
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
  assert.equal(module.statsPeriodKey(preset("week")), "week");
});

test("nur bekannte Presets werden akzeptiert", () => {
  const module = moduleAt("2026-08-22T14:30:00+02:00");
  assert.equal(module.statsIsPreset("quarter"), true);
  assert.equal(module.statsIsPreset("7"), false);
  assert.equal(module.statsIsPreset(""), false);
});

test("die Beschriftung benennt den unvollständigen Zeitraum, statt zu schweigen", () => {
  const module = moduleAt("2026-08-22T14:30:00+02:00");
  assert.match(module.statsPeriodLabel({ preset: "custom", from: "2026-01-05", to: "" }), /Von und Bis/);
  assert.match(module.statsPeriodLabel({ preset: "custom", from: "2026-02-01", to: "2026-01-09" }), /liegt nach/);
  assert.match(module.statsPeriodLabel(preset("quarter")), /Q3 2026/);
});
