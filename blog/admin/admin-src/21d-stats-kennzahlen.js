import { t } from "./00a-i18n.js";
import { escapeHtml } from "./16a-alt-text-actions.js";
import { numberFormat } from "./21-stats.js";
import { statsShortDayFormat } from "./21b-stats-period.js";

// --- Kennzahlen der Statistik ----------------------------------------------
//
// Die Zahlen über den Listen, je Abschnitt eine eigene Zusammenstellung.
// Getrennt von der Darstellung, weil hier die heiklen Entscheidungen stehen:
// was gezeigt werden darf, was ein Strich statt einer Null sein muss und
// welche Beschriftung keine Absicht behaupten darf, die nicht gemessen wurde.

// Import und eigene Messung sind eine Quelle. Keine Aufteilung, kein Hinweis,
// woher eine Zahl stammt — die frühere Zählung ist abgeschaltet, ihre Zahlen
// sind jetzt einfach die Vorgeschichte. Ein Tag wird intern trotzdem nur aus
// einer Quelle gelesen, sonst zählten die Tage des Parallelbetriebs doppelt;
// sichtbar ist davon nichts.
//
// Besucher gibt es erst ab der eigenen Messung, Aufrufe schon davor. Die Zahl
// steht deshalb für sich und wird nirgends zu den Aufrufen ins Verhältnis
// gesetzt — so behauptet sie nichts, was aus zwei Zeiträumen stammt.
//
// Ein Vermerk "gezählt seit <Tag>" stand daneben, solange der Zeitraum weiter
// zurückreichte als die eigene Messung. Er erklärte einen Bruch, den die
// Ansicht sonst nirgends zum Thema macht, und war damit die einzige Stelle,
// die überhaupt von zwei Zeiträumen sprach. Er ist weg; er verschwindet
// ohnehin von selbst, sobald die eigene Messung weit genug zurückreicht.
export function statsWebsiteKennzahlen(total, besucherAb, range) {
  const gemessen = besucherAb && range?.end >= besucherAb;
  return [
    { label: t("stats.viewsLabel"), value: numberFormat.format(Number(total.hits) || 0) },
    {
      label: t("stats.visitorsLabel"),
      // Ein Strich, keine Null: Vor der Umstellung wurde niemand gezählt —
      // das heißt nicht, dass niemand da war.
      value: gemessen ? numberFormat.format(Number(total.visitors) || 0) : "–"
    }
  ];
}

export function statsTagKurz(day) {
  const datum = new Date(`${day}T12:00:00`);
  return Number.isNaN(datum.getTime()) ? day : statsShortDayFormat().format(datum);
}

// Ein Punkt der stündlichen Kurve trägt seine Stunde im Schlüssel selbst
// ("2026-08-24T14") — sie steht schon in Berliner Ortszeit (siehe
// berlinHour in _analytics.js), ein erneutes Parsen als Datum würde sie durch
// die Zeitzone des Browsers noch einmal verschieben.
export function statsStundeKurz(hour) {
  const stunde = hour.slice(11, 13);
  return /^\d{2}$/.test(stunde) ? `${stunde}:00` : hour;
}

// Zwei Zahlen, nicht drei. Eine dritte stand hier: die Summe aller Anzeigen
// im Leseprogramm, aus dem Zählpixel des Feeds. Als absolute Zahl sagt sie
// nichts — sie zählt geladene Bilder, also ebenso das Programm, das beim
// Synchronisieren auf Vorrat lädt, und wer Bilder abgeschaltet hat, fehlt
// ganz. Was daran brauchbar ist, ist der Vergleich zwischen den Beiträgen,
// und den zeigt die Liste "Beiträge im Reader" darunter bereits.
export function statsFeedKennzahlen(total) {
  return [
    {
      label: t("stats.fetchesLabel"),
      value: numberFormat.format(Number(total.feed) || 0),
      hint: Number(total.feedBots) > 0
        ? t("stats.crawlersFiltered", { count: numberFormat.format(Number(total.feedBots)) })
        : ""
    },
    abonnentenZelle(total)
  ];
}

export function statsHeadline(cells) {
  return `<div class="stats-total-head">${cells.map((cell) =>
    `<span class="stats-total-cell"><span class="stats-total-label">${escapeHtml(cell.label)}` +
    (cell.hint ? `<span class="stats-total-hint">${escapeHtml(cell.hint)}</span>` : "") +
    `</span><span class="stats-total-value">${cell.value}</span></span>`
  ).join("")}</div>`;
}

// Zwei Teile, weil sie Verschiedenes bedeuten: Dienste melden ihre Nutzerzahl
// selbst und holen den Feed einmal für alle; eine selbstgehostete
// Installation meldet nichts und steht für einen Menschen. Die Summe ist eine
// Schätzung — das Wort "ungefähr" gehört deshalb sichtbar dazu.
function abonnentenZelle(total) {
  const gemeldet = Number(total.abosGemeldet) || 0;
  const installationen = Number(total.abosInstallationen) || 0;
  const summe = gemeldet + installationen;
  if (!summe) return { label: t("stats.subscribersLabel"), value: "–" };
  return {
    label: t("stats.subscribersLabel"),
    value: `≈ ${numberFormat.format(summe)}`,
    hint: t("stats.subscribersHint", { reported: numberFormat.format(gemeldet), installs: numberFormat.format(installationen) })
  };
}
