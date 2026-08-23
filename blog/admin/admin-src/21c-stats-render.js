import { els } from "./01b-elements.js";
import { escapeHtml } from "./16a-alt-text-actions.js";
import { numberFormat, statsExpandablePanel } from "./21-stats.js";
import { statsBreakdownPanel, statsQuellenUrl, statsSeitenUrl } from "./21a-stats-details.js";
import { statsFeedKennzahlen, statsHeadline, statsWebsiteKennzahlen } from "./21d-stats-kennzahlen.js";
import { statsChart, statsSeries } from "./21e-stats-chart.js";
import { wireStatsChart } from "./21e1-stats-chart-wire.js";

// --- Darstellung der Statistik --------------------------------------------
//
// Getrennt vom Laden, weil beides unabhängig voneinander wächst: Hier stehen
// nur die Fragen "welche Zahl steht wo" und "was darf gar nicht behauptet
// werden", nicht das Abholen und Zwischenspeichern.

// Website und Feed sind zwei Welten, die nur den Zeitraum teilen.
//
// Die eine zählt Menschen über einen Beacon, die andere Programme beim
// Ausliefern; die Größenordnungen liegen um den Faktor zehn auseinander. In
// einer Reihe nebeneinander liest sich das, als seien die Zahlen vergleichbar
// — sie sind es nicht. Zwei Abschnitte statt zweier Tabs, weil der Feed hier
// der größere Kanal ist: Was man wegklicken muss, schaut man seltener an.
export function renderStats(data) {
  const total = data.total || {};

  els.statsBody.innerHTML = [
    statsSection("Website", statsWebsiteKennzahlen(total, data.besucherAb, data.range), [
      statsChart(statsSeries(data.series, data.range))
    ], statsWebsitePanels(data)),
    // Der Feed bekommt denselben Verlauf, weil er dieselbe Frage hat: Die
    // Zahl darüber sagt, wie viel — nicht, wann. Beschriftet mit "Abrufe",
    // denn gezählt werden Programme beim Abholen, nicht Menschen beim Lesen.
    //
    // Fehlt die Reihe — eine ältere Antwort aus dem Zwischenspeicher —,
    // bleibt die Stelle leer. Eine Kurve aus lauter Nullen behauptete einen
    // Feed, den niemand geholt hat.
    statsSection("Feed", statsFeedKennzahlen(total), Array.isArray(data.feedSeries)
      ? [statsChart(statsSeries(data.feedSeries, data.range), "Abrufe")]
      : [], statsFeedPanels(data))
  ].join("");
  // The page rows carry chevron icons rendered after innerHTML — inject them.
  if (window.RWIcons) window.RWIcons.inject(els.statsBody);
  // Dasselbe für die Verläufe: Sie entstehen bei jedem Laden neu, ihre
  // Bedienung hängt deshalb an ihnen und nicht an der Ansicht darüber.
  wireStatsChart(els.statsBody);
}

function statsSection(titel, zellen, extras, panels) {
  return [
    `<section class="stats-section">`,
    `<h2 class="stats-section-title">${escapeHtml(titel)}</h2>`,
    `<div class="stats-total">`,
    statsHeadline(zellen),
    extras.join(""),
    `</div>`,
    `<div class="stats-grid">${panels.join("")}</div>`,
    `</section>`
  ].join("");
}

function statsWebsitePanels(data) {
  return [
    statsExpandablePanel("Seiten", (data.pages || []).map((page) => ({
      name: page.path || "/",
      title: page.title,
      count: page.hits,
      href: statsSeitenUrl(page.path || "/"),
      // Aufgeklappt zeigt die Zeile, welche Quellen auf diese Seite geführt
      // haben. Der Pfad ist der Schlüssel — eine interne Seiten-ID, die
      // mitgeschleppt werden müsste, gibt es hier nicht.
      drill: { key: "path", id: page.path }
    }))),
    // Die Gegenrichtung, aus derselben Tabelle: Welche Seiten hat diese
    // Quelle gebracht? Auch "(direkt)" klappt auf — dort steht, was ohne
    // erkennbare Quelle aufgerufen wurde, und das ist die größte Zeile.
    statsExpandablePanel("Quellen", (data.refs || []).map((ref) => ({
      name: ref.name,
      count: ref.hits,
      href: statsQuellenUrl(ref.host),
      drill: { key: "ref", id: ref.host || "" }
    }))),
    // "Länder", wie "Seiten" und "Quellen" daneben: eine Liste, benannt nach
    // dem, was in ihr steht. "Woher gelesen wird" war eine Frage, und darunter
    // stand ein Satz, der die Antwort einschränkte — zwei Zeilen Beiwerk über
    // sieben Zeilen Liste. Die Einheit ist dieselbe wie in den Listen daneben
    // (Aufrufe), und dass die importierte Historie keine Länder kennt, sieht
    // man an den Zahlen selbst, sobald der Zeitraum weit genug zurückreicht.
    ...((data.countries || []).length
      ? [statsBreakdownPanel("Länder", data.countries.map((row) => ({
          name: row.country || "ohne Land", count: row.hits
        })))]
      : [])
  ];
}

// Dieselbe Reihenfolge wie im Abschnitt darüber: erst was gelesen wurde, dann
// worüber, dann von wo. Die Website-Listen stehen als Seiten, Quellen, Länder
// nebeneinander; standen die Feed-Listen anders herum, läse man zwei Ansichten
// statt einer — die Spalte an derselben Stelle beantwortete eine andere Frage.
function statsFeedPanels(data) {
  return [
    // Welche Beiträge im Leseprogramm angezeigt wurden — Anzeigen, keine
    // Beiträge: Sehen drei Menschen denselben Beitrag, sind es drei. Die Liste
    // steht für sich; eine Gesamtzahl darüber, die sie auflösen müsste, gibt
    // es nicht mehr. Der Sammelpfad der importierten Historie fällt deshalb
    // schon in der Abfrage weg.
    ...((data.feedPages || []).length
      ? [statsBreakdownPanel("Beiträge im Reader", data.feedPages.map((row) => ({
          name: row.path, title: row.title, count: row.hits, href: statsSeitenUrl(row.path)
        })))]
      : []),
    statsFeedPanel(data.feedReaders || [], Number(data.total?.feed) || 0),
    // Auch hier nur "Länder". Was die Zahl daneben genau zählt — Abruftage,
    // und bei den Diensten das Land ihres Rechenzentrums — ist richtig, aber
    // es ist eine Fußnote und keine Überschrift: Die Reihenfolge stimmt auch
    // ohne sie, und die Reihenfolge ist, was man hier liest.
    ...((data.feedCountries || []).length
      ? [statsBreakdownPanel("Länder", data.feedCountries.map((row) => ({
          name: row.country, count: row.hits
        })))]
      : [])
  ];
}

// "unbekannt" ist hier regelmäßig die größte Zeile. Was dahintersteckt, stand
// vorher als eigene Liste am Ende der Ansicht — ohne sichtbaren Zusammenhang
// zu der Zeile, die sie auflöst, und als Anhängsel, das nach Unordnung aussah.
// Jetzt klappt die Zeile auf und zeigt die Kennungen, die sie zusammenfasst.
// Sortiert nach Abonnenten, nicht nach Abrufen — und deshalb steht die
// geschätzte Abonnentenzahl auch als Zahl in der Zeile. Wie oft ein Programm
// abruft, sagt nichts über seine Reichweite: Ein selbstgehosteter Leser fragt
// stündlich für einen Menschen, ein Dienst einmal für hundert. Eine nach dem
// einen sortierte Liste, die das andere zeigt, sieht unsortiert aus.
//
// Die Abrufe stehen als Unterzeile weiter da; sie waren die alte Zahl und
// sind der Grund, warum ein Programm überhaupt in der Liste steht.
//
// Dass die Zahl geschätzt ist, steht im Titel statt in einer Zeile darunter:
// "Feed-Leser (geschätzt)" sagt dasselbe wie "geschätzte Abonnenten je
// Programm" und kostet keine eigene Zeile.
function statsFeedPanel(readers, totalFeed) {
  const rows = readers.map((reader) => ({
    name: reader.reader,
    title: reader.subscribers
      ? `gemeldet · ${numberFormat.format(reader.hits)} Abrufe`
      : `${numberFormat.format(reader.hits)} Abrufe`,
    count: reader.abos || 0,
    // Ein Programm, das am stärksten Tag nicht dabei war, hat für diesen
    // Zeitraum keine Schätzung. Ein Strich sagt das; eine Null behauptete,
    // niemand nutze es.
    wert: reader.abos ? null : "–",
    // Nur die unbekannte Zeile hat eine Auflösung. Ein erkanntes
    // Leseprogramm ist bereits das Ergebnis der Zuordnung.
    drill: reader.reader === "unbekannt" ? { key: "reader", id: "unbekannt" } : null
  }));
  if (!rows.length && totalFeed) rows.push({ name: "ohne erkennbaren Leser", count: totalFeed });
  return statsExpandablePanel("Feed-Leser (geschätzt)", rows);
}
