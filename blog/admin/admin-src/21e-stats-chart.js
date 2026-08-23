import { escapeHtml } from "./16a-alt-text-actions.js";
import { numberFormat } from "./21-stats.js";
import { statsTagKurz } from "./21d-stats-kennzahlen.js";

// --- Der Verlauf ------------------------------------------------------------
//
// Eine Kurve ohne Beschriftung sagt nur, dass etwas schwankt. Sie sagt nicht,
// wann. Vorher stand hier eine reine Silhouette: ein Ausschlag in der Mitte
// war zu sehen, aber nicht, welcher Tag das war — und genau das ist die
// Frage, die man an einen Verlauf hat.
//
// Drei Zusätze beantworten sie, ohne die Fläche zu einem Diagramm mit Gitter
// und Achsen aufzublasen:
//   * Die Enden der Zeitachse stehen als Datum darunter.
//   * Der höchste Punkt ist markiert und über der Kurve benannt — das gilt
//     auch ohne Maus, ohne Berührung und beim ersten Blick.
//   * Zeiger und Pfeiltasten laufen die Punkte ab und benennen jeden.
//
// Interaktiv, weil die Kurve sonst zweihundert Punkte zeigt und keinen davon
// beziffern kann. Der Ruhezustand behauptet trotzdem nichts, was nur bei
// Berührung sichtbar wird: Was man wissen will, steht schon da.

// Die Abfrage liefert nur Tage mit Treffern. Gezeichnet werden die Punkte
// aber gleichmäßig verteilt — ohne Auffüllen läge zwischen dem letzten Tag
// vor einer Lücke und dem ersten danach ein einziger Schritt, und zwei Monate
// Stillstand sähen aus wie ein Tag. Die Kurve behauptete einen Verlauf, den
// es nicht gab. Deshalb bekommt jeder Tag des Zeitraums seinen Punkt, auch
// wenn er null ist.
//
// Lange Zeiträume werden zu Wochen gebündelt statt abgeschnitten. Eine feste
// Obergrenze an Punkten hätte den Rest des Zeitraums still verschluckt: Die
// gesamte Historie umfasst über 500 Tage und ist mit zwei Klicks im
// Datumswähler erreichbar.
const STATS_MAX_PUNKTE = 200;

function statsTage(range) {
  const tage = [];
  // Mittags gerechnet, damit die Sommerzeitumstellung keinen Tag verschluckt
  // oder verdoppelt.
  const tag = new Date(`${range.start}T12:00:00`);
  const ende = new Date(`${range.end}T12:00:00`);
  if (Number.isNaN(tag.getTime()) || Number.isNaN(ende.getTime())) return null;
  while (tag <= ende) {
    tage.push(`${tag.getFullYear()}-${String(tag.getMonth() + 1).padStart(2, "0")}-${String(tag.getDate()).padStart(2, "0")}`);
    tag.setDate(tag.getDate() + 1);
    if (tage.length > 4000) return null; // absurder Zeitraum, lieber ungefüllt
  }
  return tage;
}

// Jeder Punkt trägt seinen Tag mit. Ein gebündelter Punkt trägt zwei: Er
// steht für eine Woche, und eine Woche mit dem Datum ihres ersten Tages zu
// beschriften, behauptete einen Tageswert.
export function statsSeries(rows, range) {
  const werte = new Map((rows || []).map((row) => [row.day, Number(row.hits) || 0]));
  const tage = range?.start && range?.end ? statsTage(range) : null;
  if (!tage) return (rows || []).map((row) => ({ tag: row.day, daily: Number(row.hits) || 0 }));

  const punkte = tage.map((tag) => werte.get(tag) || 0);
  if (punkte.length <= STATS_MAX_PUNKTE) return punkte.map((daily, index) => ({ tag: tage[index], daily }));

  // Zusammenfassen statt weglassen: Jeder Eimer trägt die Summe seiner Tage,
  // die Kurve behält damit ihre Form und ihr Ende.
  const proEimer = Math.ceil(punkte.length / STATS_MAX_PUNKTE);
  const gebuendelt = [];
  for (let i = 0; i < punkte.length; i += proEimer) {
    gebuendelt.push({
      tag: tage[i],
      bis: tage[Math.min(i + proEimer, tage.length) - 1],
      daily: punkte.slice(i, i + proEimer).reduce((summe, wert) => summe + wert, 0)
    });
  }
  return gebuendelt;
}

function statsPunktLabel(punkt) {
  const von = statsTagKurz(punkt.tag);
  return punkt.bis && punkt.bis !== punkt.tag ? `${von} – ${statsTagKurz(punkt.bis)}` : von;
}

// Website und Feed zählen Verschiedenes: Die eine Kurve trägt Aufrufe, die
// andere Abrufe. Die Einheit steht deshalb an der Kurve und nicht in dieser
// Funktion — eine mit "Aufrufe" beschriftete Feed-Kurve behauptete Menschen,
// wo Programme gezählt wurden.
export function statsPunktWert(wert, einheit) {
  return `${numberFormat.format(wert)} ${einheit}`;
}

const STATS_CHART_HOEHE = 40;

export function statsChart(series, einheit = "Aufrufe") {
  const punkte = (series || []).map((punkt) => ({
    label: statsPunktLabel(punkt),
    wert: Number(punkt.daily) || 0
  }));
  if (punkte.length < 2) return "";

  const hoehe = STATS_CHART_HOEHE;
  const max = Math.max(1, ...punkte.map((punkt) => punkt.wert));
  const schritt = 100 / (punkte.length - 1);
  // Die Fläche wird auf 100 × HOEHE gezeichnet und über preserveAspectRatio
  // in die Breite gezogen; x ist damit direkt der Prozentwert, den der
  // Marker als CSS-Position bekommt.
  const koordinaten = punkte.map((punkt, index) => ({
    x: index * schritt,
    y: hoehe - (punkt.wert / max) * (hoehe - 2) - 1
  }));
  const linie = koordinaten.map((punkt) => `${punkt.x.toFixed(2)},${punkt.y.toFixed(2)}`).join(" ");
  const flaeche = `0,${hoehe} ${linie} 100,${hoehe}`;
  const spitze = punkte.reduce((beste, punkt, index) => (punkt.wert > punkte[beste].wert ? index : beste), 0);

  const daten = punkte.map((punkt, index) => ({
    l: punkt.label,
    w: punkt.wert,
    x: Number(koordinaten[index].x.toFixed(2)),
    y: Number(((koordinaten[index].y / hoehe) * 100).toFixed(2))
  }));

  return [
    `<figure class="stats-chart" tabindex="0" role="img" style="--x:${daten[spitze].x}%"`,
    ` aria-label="Verlauf der ${escapeHtml(einheit)}. Höchster Wert: ${escapeHtml(punkte[spitze].label)}, ${escapeHtml(statsPunktWert(punkte[spitze].wert, einheit))}."`,
    ` data-punkte="${escapeHtml(JSON.stringify(daten))}" data-spitze="${spitze}" data-einheit="${escapeHtml(einheit)}">`,
    `<figcaption class="stats-chart-read">`,
    `<span class="stats-chart-read-kind">Höchster Wert</span>`,
    `<span class="stats-chart-read-day">${escapeHtml(punkte[spitze].label)}</span>`,
    `<span class="stats-chart-read-value">${escapeHtml(statsPunktWert(punkte[spitze].wert, einheit))}</span>`,
    `</figcaption>`,
    `<div class="stats-chart-plot">`,
    `<svg class="stats-spark" viewBox="0 0 100 ${hoehe}" preserveAspectRatio="none" aria-hidden="true">`,
    `<polygon class="stats-spark-fill" points="${flaeche}" />`,
    `<polyline class="stats-spark-line" points="${linie}" />`,
    `</svg>`,
    `<span class="stats-chart-marker" style="--y:${daten[spitze].y}%" aria-hidden="true"></span>`,
    `</div>`,
    `<div class="stats-chart-axis"><span>${escapeHtml(punkte[0].label)}</span><span>${escapeHtml(punkte.at(-1).label)}</span></div>`,
    `</figure>`
  ].join("");
}
