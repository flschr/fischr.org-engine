import { els } from "./01b-elements.js";
import { escapeHtml } from "./16a-alt-text-actions.js";
import { state } from "./01c-state.js";
import { loadStats, setStatsRangeButtons } from "./21-stats.js";
import { statsPeriodBounds, statsShortDayFormat, statsTagString } from "./21b-stats-period.js";

// --- Der freie Zeitraum: ein Kalender, kein Tippfeld ------------------------
//
// Zwei Datumsfelder verlangten zwei vollständige Eingaben und ließen sich
// verdrehen — "Von" nach "Bis" war ein eigener Fehlerfall mit eigener
// Meldung. Ein Kalender mit zwei Klicks kennt diesen Fehler nicht mehr: Der
// erste Klick setzt den ersten Tag, der zweite den letzten, und ein Klick vor
// dem ersten Tag tauscht die Rollen statt einen ungültigen Zeitraum zu bauen
// (statsRangeKlick). Was bleibt, ist ein einzelnes Blatt unter dem fünften
// Knopf, wie zuvor.
//
// Der Zeitraum wechselt weiterhin erst beim Anzeigen, nicht schon beim
// zweiten Klick: Wer sich vertippt — verklickt —, soll die Auswahl noch
// verwerfen können, ohne dass die Ansicht dahinter schon gesprungen ist.

const MONATSFORMAT = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const TAGFORMAT = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// Auswahl und angezeigter Monat leben im Modul, nicht in Formularfeldern —
// ein Kalendertag ist kein Eingabewert, den ein <input> mitführen könnte.
let auswahl = { von: "", bis: "" };
let monat = null; // Date auf den 1. des angezeigten Monats
let vorschau = ""; // Tag unter dem Zeiger, solange nur "von" feststeht

function statsDatum(tag) {
  return new Date(`${tag}T12:00:00`);
}

function monatsErster(datum) {
  return new Date(datum.getFullYear(), datum.getMonth(), 1);
}

// Die Grenzen kommen als Zeitstempel zurück, der Kalender will einen Kalendertag.
function isoZuTag(iso) {
  const datum = iso ? new Date(iso) : null;
  return datum && !Number.isNaN(datum.getTime()) ? statsTagString(datum) : "";
}

// Die 42 Tage eines Kalenderblatts, Montag zuerst: der Montag auf oder vor
// dem Monatsersten bis sechs volle Wochen später. Randtage aus dem Vor- oder
// Folgemonat stehen mit drin, damit keine Woche halb leer bleibt.
export function statsKalenderTage(ersterDesMonats) {
  const start = new Date(ersterDesMonats);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const tag = new Date(start);
    tag.setDate(start.getDate() + i);
    return tag;
  });
}

// Ein Klick, zwei mögliche Ergebnisse: Steht noch keine Auswahl oder schon
// eine vollständige, beginnt eine neue an diesem Tag. Steht nur "von" fest,
// schließt dieser Klick die Spanne — verdreht angeklickt wird getauscht,
// damit "von" nie nach "bis" liegt. Eine dritte Auswahl auf eine bereits
// geschlossene Spanne beginnt neu, statt eine ihrer Grenzen zu verschieben:
// Das wäre nicht vorhersagbar, welche der beiden gemeint war.
//
// Der Parameter heißt bewusst nicht "auswahl": Der Aufrufer unten reicht dort
// das gleichnamige Modul-Feld herein — zwei Namen für dasselbe Ding lesen sich
// sonst wie eine stille Mutation statt wie eine reine Funktion.
export function statsRangeKlick(aktuell, tag) {
  if (!aktuell.von || aktuell.bis) return { von: tag, bis: "" };
  if (tag < aktuell.von) return { von: tag, bis: aktuell.von };
  return { von: aktuell.von, bis: tag };
}

function statsBereichText() {
  if (!auswahl.von) return "Ersten Tag wählen";
  if (!auswahl.bis) return `${statsShortDayFormat.format(statsDatum(auswahl.von))} – letzten Tag wählen`;
  return `${statsShortDayFormat.format(statsDatum(auswahl.von))} – ${statsShortDayFormat.format(statsDatum(auswahl.bis))}`;
}

function renderKalender() {
  if (!els.statsCalGrid || !monat) return;
  const heute = statsTagString(new Date());
  // Solange "bis" noch offen ist, zeichnet der Zeiger die Spanne vor — genau
  // wie auf den Datumswählern der Reiseportale, nach denen dieser Kalender
  // gebaut ist.
  const bisVorschau = auswahl.bis || (auswahl.von ? vorschau : "");
  const grenzen = auswahl.von && bisVorschau ? [auswahl.von, bisVorschau].sort() : null;

  const zellen = statsKalenderTage(monat).map((tag) => {
    const wert = statsTagString(tag);
    const istEndpunkt = wert === auswahl.von || wert === auswahl.bis;
    const klassen = ["stats-cal-day"];
    if (tag.getMonth() !== monat.getMonth()) klassen.push("is-muted");
    if (wert === heute) klassen.push("is-today");
    if (grenzen && wert >= grenzen[0] && wert <= grenzen[1]) {
      klassen.push("is-in-range");
      if (wert === grenzen[0]) klassen.push("is-range-start");
      if (wert === grenzen[1]) klassen.push("is-range-end");
    }
    if (istEndpunkt) klassen.push("is-endpoint");
    return `<button type="button" class="${klassen.join(" ")}" data-tag="${wert}" aria-pressed="${istEndpunkt}"` +
      ` aria-label="${escapeHtml(TAGFORMAT.format(tag))}">${tag.getDate()}</button>`;
  }).join("");

  els.statsCalGrid.innerHTML = zellen;
  if (els.statsCalMonth) els.statsCalMonth.textContent = MONATSFORMAT.format(monat);
  if (els.statsCalRange) els.statsCalRange.textContent = statsBereichText();
  if (els.statsCustomApply) els.statsCustomApply.disabled = !(auswahl.von && auswahl.bis);
}

// Ein Klick auf eine Tageszelle. Eigene Funktion statt eines Delegierten
// direkt hier, weil die Zellen bei jedem Klick neu entstehen (innerHTML) —
// verdrahtet wird deshalb einmalig am Raster, in 29c-admin-view-events.js.
export function statsCalendarClick(tag) {
  auswahl = statsRangeKlick(auswahl, tag);
  vorschau = "";
  renderKalender();
  // Der Knopf, den man gerade angeklickt hat, entsteht beim Neuzeichnen neu —
  // ohne diesen Schritt fiele der Fokus auf niemanden zurück, und Tastatur-
  // Bedienung verlöre ihre Stelle im Blatt. Schließt der Klick die Spanne,
  // geht der Fokus stattdessen gleich auf "Anzeigen": Genau das war vorher
  // die Eingabetaste im zweiten Datumsfeld — ein Tastaturweg, der mit einer
  // Auswahl endet, nicht mittendrin auf einer Tageszelle stehen bleibt.
  if (auswahl.von && auswahl.bis) els.statsCustomApply?.focus();
  else els.statsCalGrid?.querySelector(`[data-tag="${tag}"]`)?.focus();
}

export function statsCalendarHover(tag) {
  if (!auswahl.von || auswahl.bis || vorschau === tag) return;
  vorschau = tag;
  renderKalender();
}

export function statsCalendarLeave() {
  if (!vorschau) return;
  vorschau = "";
  renderKalender();
}

export function statsCalendarMonth(delta) {
  if (!monat) return;
  monat = new Date(monat.getFullYear(), monat.getMonth() + delta, 1);
  renderKalender();
  // Die erste Zelle des Blatts ist oft ein Randtag des Vormonats (".is-muted")
  // — Fokus dorthin landete nach "nächster Monat" auf einem Tag des Monats,
  // den man gerade verlassen hat. Der erste echte Tag des neu gezeigten
  // Monats ist die Zelle, die zur Kopfzeile darüber passt.
  els.statsCalGrid?.querySelector(".stats-cal-day:not(.is-muted)")?.focus();
}

// Der Kalender öffnet mit dem Zeitraum, der gerade zu sehen ist, vorbelegt —
// wer nur eine Grenze verschieben will, beginnt sonst bei einer leeren
// Auswahl, obwohl die Ansicht dahinter längst einen Zeitraum zeigt.
function openStatsPicker() {
  if (!els.statsCustom) return;
  const bounds = statsPeriodBounds(state.statsPeriod);
  const von = state.statsPeriod.from || isoZuTag(bounds?.start);
  const bis = state.statsPeriod.to || isoZuTag(bounds?.end);
  auswahl = { von, bis };
  vorschau = "";
  monat = monatsErster(von ? statsDatum(von) : new Date());
  setStatsPickerHint("");
  renderKalender();
  els.statsCustom.hidden = false;
  els.statsCustomToggle?.setAttribute("aria-expanded", "true");
  els.statsCalGrid?.querySelector(`[data-tag="${von}"]`)?.focus();
}

export function closeStatsPicker({ focusToggle = false } = {}) {
  if (!els.statsCustom || els.statsCustom.hidden) return;
  els.statsCustom.hidden = true;
  els.statsCustomToggle?.setAttribute("aria-expanded", "false");
  if (focusToggle) els.statsCustomToggle?.focus();
}

export function toggleStatsPicker() {
  if (els.statsCustom?.hidden) openStatsPicker();
  else closeStatsPicker({ focusToggle: true });
}

function setStatsPickerHint(text) {
  if (!els.statsCustomHint) return;
  els.statsCustomHint.textContent = text;
  els.statsCustomHint.hidden = !text;
}

// Der Anzeigen-Knopf ist deaktiviert, solange die Auswahl unvollständig ist —
// diese Meldung fängt deshalb nur den Fall ab, dass die Funktion trotzdem
// aufgerufen wird, nicht einen Klick, der über die Bedienung gar nicht mehr
// möglich ist.
export function applyStatsPicker() {
  if (!auswahl.von || !auswahl.bis) return setStatsPickerHint("Wähle den ersten und den letzten Tag im Kalender.");
  state.statsPeriod = { preset: "custom", from: auswahl.von, to: auswahl.bis };
  closeStatsPicker({ focusToggle: true });
  setStatsRangeButtons();
  loadStats();
}
