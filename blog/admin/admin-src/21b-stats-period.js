// --- Statistik-Zeiträume ---------------------------------------------------
//
// Die Presets sind rollende Fenster, keine Kalenderzeiträume: "7 Tage" ist
// heute und die sechs Tage davor, nicht die laufende Woche ab Montag.
//
// Kalenderzeiträume waren die erste Fassung, und sie hatten einen Montag-
// morgen-Fehler: Am Wochenwechsel begann "Diese Woche" wieder bei null, am
// Monatsersten der Monat, am 1. Januar das Jahr. Die Ansicht zeigte dann eine
// Null, die zwar stimmte, aber nichts erzählte — und das ausgerechnet zu dem
// Zeitpunkt, an dem man nachsieht, wie es läuft. Ein rollendes Fenster hat
// immer dieselbe Länge und fällt deshalb nie in sich zusammen.
//
// Alles hier ist Client-Rechnung. /api/admin/stats kennt nur start und end und
// behält damit eine einzige, stabile Signatur, egal wie viele Presets oben
// dazukommen. Ein freier Zeitraum ist deshalb kein Sonderfall, sondern nur ein
// weiteres Paar Datumsgrenzen.

import { currentLocale, t } from "./00a-i18n.js";

// Die Fensterlänge zählt den heutigen Tag mit: "7 Tage" beginnt vor sechs
// Tagen um 0 Uhr und endet jetzt.
//
// Map und nicht Objektliteral: Ein Nachschlagen mit "constructor" oder
// "toString" fände dort die geerbte Funktion, aus days - 1 würde NaN und
// daraus ein Invalid Date, das erst im toISOString auffliegt.
const STATS_WINDOWS = new Map([["1d", 1], ["7d", 7], ["30d", 30], ["90d", 90], ["365d", 365]]);
const STATS_PRESETS = [...STATS_WINDOWS.keys(), "custom"];
// Funktionen statt Konstanten: Die Sprache kann wechseln, während die Seite
// offen bleibt (00a-i18n.js, applyStaticTranslations), ein einmal gebautes
// Intl.DateTimeFormat behielte sein Gebietsschema aber für immer.
const statsDayFormat = () => new Intl.DateTimeFormat(currentLocale(), { day: "2-digit", month: "2-digit", year: "numeric" });
export const statsShortDayFormat = () => new Intl.DateTimeFormat(currentLocale(), { day: "numeric", month: "short" });
// Ein Fenster über 365 Tage beginnt im Vorjahr. Ohne Jahreszahl läse sich
// "25. Aug – 24. Aug" wie ein einziger Tag mit Tippfehler.
const statsShortYearFormat = () => new Intl.DateTimeFormat(currentLocale(), { day: "numeric", month: "short", year: "numeric" });

export function statsIsPreset(value) {
  return STATS_PRESETS.includes(value);
}

// Ein Kalendertag als "YYYY-MM-DD", in der Ortszeit des Browsers gelesen —
// dieselbe Umrechnung, die die Kurve (21e) und der Kalender (21f) sonst je für
// sich noch einmal hinschrieben.
export function statsTagString(datum) {
  return `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, "0")}-${String(datum.getDate()).padStart(2, "0")}`;
}

// Der erste Tag des rollenden Fensters, ab 0 Uhr.
function statsWindowStart(now, days) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

function statsParseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Die letzte volle Stunde des Schlusstages statt 23:59:59. Der Endpunkt liest
// ohnehin nur den Tag heraus, aber der Zeitstempel bleibt so lesbar.
function statsEndOfDay(date) {
  const end = new Date(date);
  end.setHours(23, 0, 0, 0);
  return end;
}

// Liefert { start, end } als ISO-Strings oder null, wenn ein freier Zeitraum
// noch unvollständig oder verdreht ist. null heißt: nicht laden, nachfragen.
export function statsPeriodBounds(period) {
  const now = new Date();
  const end = new Date(now);
  end.setMinutes(0, 0, 0);

  const days = STATS_WINDOWS.get(period.preset);
  if (days) return { start: statsWindowStart(now, days).toISOString(), end: end.toISOString() };

  if (period.preset === "custom") {
    const from = statsParseDate(period.from);
    const to = statsParseDate(period.to);
    if (!from || !to || from > to) return null;
    return { start: from.toISOString(), end: statsEndOfDay(to).toISOString() };
  }
  return null;
}

// Cache, laufende Anfrage und AbortController hängen an diesem Schlüssel. Ein
// freier Zeitraum bekommt seine Datumsgrenzen mit hinein, sonst würde die
// zweite freie Abfrage die Antwort der ersten servieren.
export function statsPeriodKey(period) {
  return period.preset === "custom" ? `custom:${period.from}:${period.to}` : period.preset;
}

export function statsPeriodLabel(period) {
  const now = new Date();
  const days = STATS_WINDOWS.get(period.preset);
  if (days) {
    const from = statsWindowStart(now, days);
    const format = from.getFullYear() === now.getFullYear() ? statsShortDayFormat() : statsShortYearFormat();
    // "Letzte 1 Tage" zählt nicht als Satz. Ein Fenster von einem Tag ist
    // ohnehin immer heute, eine Spanne daneben sagte das noch einmal.
    if (days === 1) return t("stats.todayLabel", { date: format.format(now) });
    return t("stats.lastNDaysLabel", { days, from: format.format(from), to: format.format(now) });
  }
  if (period.preset === "custom") {
    const from = statsParseDate(period.from);
    const to = statsParseDate(period.to);
    if (!from || !to) return t("stats.customIncomplete");
    if (from > to) return t("stats.customReversed");
    return `${statsDayFormat().format(from)} – ${statsDayFormat().format(to)}`;
  }
  return "";
}
