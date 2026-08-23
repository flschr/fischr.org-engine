const fs = require("node:fs");
const path = require("node:path");

// Nur die Statistik-Bausteine (21*), als ein auswertbarer Geltungsbereich.
//
// Der vollständige Admin-Quelltext führt beim Auswerten seinen Startcode aus und verlangt
// Dinge, die es im Test nicht gibt — deshalb dieser Ausschnitt. Die ESM-Syntax wird abgestreift:
// Was diese Module untereinander importieren, deklarieren sie hier gemeinsam, und was sie von
// aussen brauchen, reicht der Test als Kontext herein.
//
// Liegt in einem Helfer, weil zwei Tests denselben Ausschnitt auf dieselbe Weise brauchen;
// getrennt gepflegt würden sie auseinanderlaufen, sobald sich die Dateinamen ändern.
module.exports = function adminStatsSource() {
  const directory = path.join(__dirname, "../../blog/admin/admin-src");
  return fs
    .readdirSync(directory)
    .filter((name) => /^21/.test(name) && name.endsWith(".js"))
    .sort()
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
    .map((text) => text.replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, ""))
    .join("\n");
};
