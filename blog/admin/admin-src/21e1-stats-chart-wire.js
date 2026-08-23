import { statsPunktWert } from "./21e-stats-chart.js";

// --- Der Verlauf, bedient ---------------------------------------------------
//
// Getrennt vom Zeichnen: Dort steht, was die Kurve behauptet, hier, wie man
// sie abliest. Beide Abschnitte der Statistik haben inzwischen eine Kurve,
// und jede bekommt dieselbe Bedienung.

// Die Beschriftung steht über der Kurve und wandert mit dem abgelesenen Punkt.
// Sie im Diagramm mitlaufen zu lassen, hätte sie mal auf die Kurve, mal über
// den Rand gelegt; eine feste Ecke wiederum ließ Zahl und Punkt am anderen
// Ende der Fläche liegen. Also: waagerecht am Punkt, senkrecht auf fester
// Höhe.
//
// Der Zeiger darf nicht zwischen den Punkten hängenbleiben: Gerechnet wird
// der Anteil der Breite, nicht der Abstand zum nächsten Punkt — so ist jeder
// Punkt gleich breit erreichbar, auch bei zweihundert davon.
//
// Beim Verlassen fällt die Ansicht auf die Spitze zurück. Ein Marker, der
// stehen bleibt, wo der Zeiger zufällig die Fläche verlassen hat, behauptete
// eine Auswahl, die niemand getroffen hat.
export function wireStatsChart(wurzel) {
  wurzel.querySelectorAll(".stats-chart").forEach(verdrahteVerlauf);
}

function verdrahteVerlauf(chart) {
  let punkte;
  try {
    punkte = JSON.parse(chart.dataset.punkte);
  } catch {
    return;
  }
  if (!Array.isArray(punkte) || !punkte.length) return;

  const spitze = Math.min(Math.max(Number(chart.dataset.spitze) || 0, 0), punkte.length - 1);
  const flaeche = chart.querySelector(".stats-chart-plot");
  const marker = chart.querySelector(".stats-chart-marker");
  const beschriftung = chart.querySelector(".stats-chart-read");
  const art = chart.querySelector(".stats-chart-read-kind");
  const tag = chart.querySelector(".stats-chart-read-day");
  const wert = chart.querySelector(".stats-chart-read-value");
  const einheit = chart.dataset.einheit || "Aufrufe";
  let aktiv = spitze;

  const zeigen = (index) => {
    aktiv = Math.min(Math.max(index, 0), punkte.length - 1);
    const punkt = punkte[aktiv];
    // Die Beschriftung steht über dem Punkt, den sie benennt, und liest
    // deshalb dieselbe Position wie der Marker — sie hängt am Diagramm,
    // nicht am Marker.
    art.hidden = aktiv !== spitze;
    tag.textContent = punkt.l;
    wert.textContent = statsPunktWert(punkt.w, einheit);
    // Wie weit die Beschriftung an den Rand darf, hängt an ihrer eigenen
    // Breite — und die hängt am Text, der gerade darin steht. Ein fester
    // Sicherheitsabstand hat geraten: Stand die Spitze am ersten Tag, ragte
    // eine lange Beschriftung über die Karte hinaus. Erst messen, dann
    // setzen; der Rest ist die Klammer im Stylesheet.
    //
    // Eine Messung von null Pixeln ist keine Breite, sondern eine
    // unsichtbare Ansicht. Sie zu übernehmen hieße, die Klammer für den
    // nächsten sichtbaren Zustand zu öffnen.
    const breite = beschriftung.offsetWidth;
    if (breite) chart.style.setProperty("--rand", `${breite / 2}px`);
    chart.style.setProperty("--x", `${punkt.x}%`);
    marker.style.setProperty("--y", `${punkt.y}%`);
    chart.classList.toggle("is-touched", aktiv !== spitze);
  };

  // Einmal zum Anfang, damit auch der Ruhezustand gemessen ist: Die Spitze
  // steht oft am ersten oder letzten Tag, und genau dort braucht die
  // Beschriftung ihr Randmaß.
  zeigen(spitze);

  flaeche.addEventListener("pointermove", (event) => {
    const kasten = flaeche.getBoundingClientRect();
    if (!kasten.width) return;
    const anteil = Math.min(Math.max((event.clientX - kasten.left) / kasten.width, 0), 1);
    zeigen(Math.round(anteil * (punkte.length - 1)));
  });
  flaeche.addEventListener("pointerleave", () => zeigen(spitze));
  chart.addEventListener("blur", () => zeigen(spitze));
  chart.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    zeigen(aktiv + (event.key === "ArrowRight" ? 1 : -1));
  });
}
