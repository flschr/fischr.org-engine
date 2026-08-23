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
// Was die Zahl umfasst, muss trotzdem dabeistehen. Die eigene Zählung ist
// jünger als die Aufrufe: Neben den Aufrufen eines ganzen Jahres stand die
// Besucherzahl der wenigen Tage seit der Umstellung — in Woche, Monat,
// Quartal und Jahr dieselbe, und damit eine Zahl, die kaputt aussieht.
//
// Der Vermerk nennt deshalb den Beginn der Messung, nicht die Herkunft der
// Zahl: "gezählt seit" sagt, worüber sie spricht, ohne den Bruch zwischen
// Import und eigener Messung zum Thema der Ansicht zu machen. Er verschwindet
// von selbst, sobald der Zeitraum ganz in der eigenen Messung liegt.
export function statsWebsiteKennzahlen(total, besucherAb, range) {
  const gemessen = besucherAb && range?.end >= besucherAb;
  const teilweise = gemessen && range?.start < besucherAb;
  return [
    { label: "Aufrufe", value: numberFormat.format(Number(total.hits) || 0) },
    {
      label: "Besucher",
      // Ein Strich, keine Null: Vor der Umstellung wurde niemand gezählt —
      // das heißt nicht, dass niemand da war.
      value: gemessen ? numberFormat.format(Number(total.visitors) || 0) : "–",
      hint: teilweise ? `gezählt seit ${statsTagKurz(besucherAb)}` : ""
    }
  ];
}

export function statsTagKurz(day) {
  const datum = new Date(`${day}T12:00:00`);
  return Number.isNaN(datum.getTime()) ? day : statsShortDayFormat.format(datum);
}

export function statsFeedKennzahlen(total) {
  const zellen = [
    {
      label: "Abrufe",
      value: numberFormat.format(Number(total.feed) || 0),
      hint: Number(total.feedBots) > 0
        ? `${numberFormat.format(Number(total.feedBots))} Crawler ausgefiltert`
        : ""
    },
    abonnentenZelle(total)
  ];
  // "Angezeigt", nicht "geöffnet" oder "gelesen". Gezählt wird, dass ein
  // Leseprogramm die Bilder eines Beitrags geladen hat — das kann ebenso das
  // Programm sein, das beim Synchronisieren auf Vorrat lädt. Wer Bilder
  // abgeschaltet hat, fehlt ganz. Jede Beschriftung, die eine Absicht
  // behauptet, ist deshalb falsch; "geschätzt" gehört sichtbar dazu.
  if (Number(total.feedReads) > 0) {
    zellen.push({
      label: "Im Reader angezeigt",
      value: numberFormat.format(Number(total.feedReads)),
      hint: "geschätzt"
    });
  }
  return zellen;
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
  if (!summe) return { label: "Abonnenten", value: "–" };
  return {
    label: "Abonnenten",
    value: `≈ ${numberFormat.format(summe)}`,
    hint: `${numberFormat.format(gemeldet)} gemeldet, ${numberFormat.format(installationen)} Installationen`
  };
}
