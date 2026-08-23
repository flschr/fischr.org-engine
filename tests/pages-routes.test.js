// Welche Pfade überhaupt an eine Pages Function gehen, steht in einer von Hand
// gepflegten blog/_routes.json. Was dort fehlt, liefert Cloudflare als
// statische Datei aus — die Function wird nie aufgerufen, es gibt keinen
// Fehler, nur einen 404 an einer Stelle, an der niemand hinsieht.
//
// Dem Projekt ist das schon einmal passiert (Commit 9dde6a2, "Route
// /api/admin/* to Functions so the stats endpoint resolves"), und beim Einbau
// des Zählendpunkts erneut. Deshalb prüft dieser Test die Datei gegen den
// tatsächlichen Inhalt von functions/.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const wurzel = path.join(__dirname, "..");
const routen = JSON.parse(fs.readFileSync(path.join(wurzel, "blog/_routes.json"), "utf8"));

// functions/api/admin/alt-text.js  ->  /api/admin/alt-text
// functions/feed.xml.js            ->  /feed.xml
// functions/admin/[[path]].js      ->  /admin/*   (Platzhalter von Pages)
function routenPfade(verzeichnis = path.join(wurzel, "functions"), prefix = "") {
  const pfade = [];
  for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    const name = eintrag.name;
    if (eintrag.isDirectory()) {
      pfade.push(...routenPfade(path.join(verzeichnis, name), `${prefix}/${name}`));
      continue;
    }
    // Dateien mit führendem Unterstrich sind geteilte Bausteine, keine Routen.
    if (!name.endsWith(".js") || name.startsWith("_") || name === "package.json") continue;
    const ohneEndung = name.replace(/\.js$/, "");
    if (ohneEndung.startsWith("[[") || ohneEndung.startsWith("[")) {
      pfade.push(`${prefix}/beliebig`);
      continue;
    }
    pfade.push(`${prefix}/${ohneEndung}`);
  }
  return pfade;
}

function abgedeckt(pfad) {
  return routen.include.some((muster) => {
    if (muster === pfad) return true;
    if (!muster.endsWith("*")) return false;
    return pfad.startsWith(muster.slice(0, -1));
  });
}

test("jede Pages Function ist in _routes.json eingetragen", () => {
  const fehlend = routenPfade().filter((pfad) => !abgedeckt(pfad));
  assert.deepEqual(
    fehlend,
    [],
    `Ohne Eintrag in blog/_routes.json liefert Cloudflare diese Pfade als statische Datei aus, die Function läuft nie: ${fehlend.join(", ")}`
  );
});

test("die Routendatei enthält keine Einträge ohne Function", () => {
  const pfade = routenPfade();
  const verwaist = routen.include.filter((muster) => {
    const stamm = muster.endsWith("*") ? muster.slice(0, -1) : muster;
    return !pfade.some((pfad) => pfad === muster || pfad.startsWith(stamm));
  });
  assert.deepEqual(verwaist, [], `Einträge ohne zugehörige Function: ${verwaist.join(", ")}`);
});

test("der Zählendpunkt ist erreichbar", () => {
  // Ohne diese Route wird kein einziger Seitenaufruf gezählt, lautlos.
  assert.equal(abgedeckt("/api/hit"), true);
});
