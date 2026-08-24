// Was eine Änderung am öffentlichen Blog bewirkt.
//
// Die Warteschlange zeigte bisher jede Abweichung zwischen `drafts` und `main` als „Änderung",
// ohne zu sagen, was sie bewirkt. Zwei Dinge gingen dabei durcheinander:
//
//   Ein nie veröffentlichter Entwurf stand darin, obwohl er öffentlich nichts ändert — er trägt
//   `draft: true` und wird weder gerendert noch syndiziert. Wer ihn sah, musste annehmen, er
//   ginge beim nächsten Senden live.
//
//   Und eine Zeile sagte nicht, ob sie einen Artikel neu veröffentlicht, einen bestehenden
//   aktualisiert, ihn zurückzieht oder löscht. Das sind vier sehr verschiedene Wirkungen.
//
// Beides beantwortet dieselbe Frage: Wie sieht der Beitrag auf `main` aus, und wie sieht er auf
// `drafts` aus? Der Admin-Index trägt den `draft`-Zustand von `main` bereits mit; die
// Entwurfsseite steht im Frontmatter des geladenen Inhalts.

export const OHNE_WIRKUNG = "ohne-wirkung";

// Reihenfolge ist Absicht: Sie steuert, wie die Warteschlange sortiert — zuerst, was die Seite
// erweitert, zuletzt, was sie verkleinert.
export const AKTIONEN = ["veroeffentlichen", "aktualisieren", "zurueckziehen", "loeschen", "medien"];

export const AKTIONS_TEXTE = {
  veroeffentlichen: "Veröffentlichen",
  aktualisieren: "Aktualisieren",
  zurueckziehen: "Zurückziehen",
  loeschen: "Löschen",
  medien: "Medien"
};

// `warOeffentlich` und `wirdOeffentlich` sind je dreiwertig: true, false, oder null für „gibt es
// dort nicht". Ohne das dritte fiele „neu angelegt" mit „war ein Entwurf" zusammen, und ein
// gelöschter Entwurf sähe aus wie ein zurückgezogener Artikel.
export function queueAktion({ warOeffentlich, wirdOeffentlich }) {
  if (wirdOeffentlich === null) {
    // Gelöscht. Öffentlich wirksam ist das nur, wenn dort etwas stand.
    return warOeffentlich ? "loeschen" : OHNE_WIRKUNG;
  }
  if (!wirdOeffentlich) {
    // Bleibt oder wird ein Entwurf. Nur der Weg von öffentlich zu Entwurf ist eine Wirkung.
    return warOeffentlich ? "zurueckziehen" : OHNE_WIRKUNG;
  }
  return warOeffentlich ? "aktualisieren" : "veroeffentlichen";
}

// Was ohne Wirkung ist, zeigt die Warteschlange nicht (26d-publish-sync.js, visibleQueueChanges)
// — mitgesendet wird es trotzdem, solange es nicht abgewählt ist. Sonst liefen `drafts` und
// `main` für einen Entwurf dauerhaft auseinander, ohne dass das je jemand sähe.
export function istWirksam(aktion) {
  return aktion !== OHNE_WIRKUNG;
}

// Was jede Änderung am öffentlichen Blog bewirkt.
//
// „War öffentlich" steht für Beiträge schon im Admin-Index, den der Bau aus `main` schreibt —
// eine Abfrage für alle. Seiten führt der Index nicht; für sie wird der Stand von `main` gelesen,
// und das sind pro Warteschlange ein bis zwei Dateien, keine vierhundert.
export async function beschrifteAktionen(changes, mainMap, { index, istEntwurf }) {
  await Promise.all(changes.map(async (change) => {
    if (change.collection === "media") {
      change.aktion = "medien";
      return;
    }

    const mainSha = mainMap.get(change.path);
    const eintrag = index.get(change.path);
    const warOeffentlich = !mainSha ? null
      : (eintrag ? !eintrag.draft : !await istEntwurf(mainSha));
    const wirdOeffentlich = change.kind === "delete" ? null : !await istEntwurf(change.sha);

    change.aktion = queueAktion({ warOeffentlich, wirdOeffentlich });
  }));
}

// Welche Pfade eine Veröffentlichung mitnimmt, wenn nicht alles gewählt ist.
//
// Abgewählt wird auf der Ebene, auf der jemand denkt: Artikel und Seiten. Medien tragen keine
// eigene Kasten — sie sind Zubehör, und eine Auswahl auf ihnen könnte nur schaden. Ein Artikel
// ohne sein Bild ergibt eine kaputte Seite; ein Bild ohne seinen Artikel ist eine Datei, die
// niemand sieht.
//
// Daraus folgen drei Regeln:
//
//   Ein Medium, das ein gewählter Artikel braucht, reist mit — immer.
//   Ein Medium, auf das nur abgewählte Artikel zeigen, bleibt liegen.
//   Alles übrige reist mit: Was öffentlich nichts bewirkt, hält sonst `drafts` und `main`
//   dauerhaft auseinander, und ein unreferenziertes Bild auf `main` schadet niemandem.
export function pfadeZumSenden(changes, abgewaehlt, medienJeAenderung) {
  const auswaehlbar = (change) => change.collection !== "media" && istWirksam(change.aktion);
  const medienVon = (change) => medienJeAenderung.get(change.path) || [];

  const benoetigt = new Set();
  const nurAbgewaehlt = new Set();
  changes.filter(auswaehlbar).forEach((change) => {
    const ziel = abgewaehlt.has(change.path) ? nurAbgewaehlt : benoetigt;
    medienVon(change).forEach((publicPath) => ziel.add(publicPath));
  });

  return changes
    .filter((change) => {
      if (auswaehlbar(change)) return !abgewaehlt.has(change.path);
      if (change.collection !== "media") return true;
      const publicPath = change.publicPath || "";
      return benoetigt.has(publicPath) || !nurAbgewaehlt.has(publicPath);
    })
    .map((change) => change.path)
    .sort();
}

// Für die Anzeige: Medien, die ein gewählter Artikel braucht. Sie tragen deshalb keine Kasten,
// und die Warteschlange sagt, warum.
export function erzwungeneMedien(changes, abgewaehlt, medienJeAenderung) {
  const benoetigt = new Set();
  changes
    .filter((change) => change.collection !== "media" && istWirksam(change.aktion) && !abgewaehlt.has(change.path))
    .forEach((change) => (medienJeAenderung.get(change.path) || []).forEach((publicPath) => benoetigt.add(publicPath)));
  return benoetigt;
}
