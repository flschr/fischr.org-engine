// Wann eine Bewegung auf main die Freigabe entwertet — und wann nicht.
//
// main wandert auch ohne Zutun: Nach fast jeder Veröffentlichung landet dort der R2-Manifest-Fold,
// dazu kommen Social-State und der Zeitplan. Diese Commits berühren nichts, was jemand in der
// Queue geprüft hat.
//
// scripts/admin-publish.js weiss das seit jeher und veröffentlicht darüber hinweg. Eine
// Vorabprüfung, die stattdessen stur die SHA vergleicht, lehnt deshalb Veröffentlichungen ab,
// die durchgelaufen wären — sie macht den Weg brüchiger statt verlässlicher. Beide Stellen
// müssen dieselbe Frage gleich beantworten; tests/publish-stand-parity.test.js hält sie zusammen.

// Muss mit safelyConcurrentMainPaths in scripts/admin-publish.js übereinstimmen.
export const unkritischeMainPfade = [
  /^automation\//,
  /^\.github\/scheduled-publish-state\.json$/
];

export function bewegungEntwertetFreigabe(pfade) {
  return pfade.some((pfad) => !unkritischeMainPfade.some((muster) => muster.test(pfad)));
}

// Vergleicht zwei Stände und beantwortet die einzige Frage, die hier zählt: Gilt die Freigabe noch?
//
// Im Zweifel gilt sie nicht. Das gilt für jede Antwort, die wir nicht auswerten können — zu viele
// Dateien für einen Vergleich, ein anderer Verlauf als erwartet. Nur wenn belegt ist, dass sich
// ausschliesslich Unkritisches bewegt hat, geht es weiter.
export async function freigabeGiltNoch({ repository, erwartet, aktuell, github }) {
  if (erwartet === aktuell) return { gilt: true, grund: "unverändert" };

  const vergleich = await github(`repos/${repository}/compare/${erwartet}...${aktuell}`);

  // "ahead" heisst: aktuell enthält erwartet und ein paar Commits mehr. Alles andere — diverged,
  // behind, identical-trotz-anderer-SHA — ist nicht der Fall, für den diese Regel gedacht ist.
  if (vergleich.status !== "ahead") return { gilt: false, grund: `Verlauf ${vergleich.status}` };

  // Die Compare-API liefert höchstens 300 Dateien. Bei mehr wüssten wir nicht, was fehlt.
  const dateien = vergleich.files || [];
  if (vergleich.total_commits > 250 || dateien.length >= 300) {
    return { gilt: false, grund: "zu viele Änderungen für einen Vergleich" };
  }

  const pfade = dateien.map((datei) => datei.filename);
  if (bewegungEntwertetFreigabe(pfade)) {
    return { gilt: false, grund: "geprüfte Dateien haben sich bewegt" };
  }
  return { gilt: true, grund: "nur Automationsstand" };
}
