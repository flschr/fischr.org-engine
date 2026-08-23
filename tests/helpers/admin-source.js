const fs = require("node:fs");
const path = require("node:path");

// Liefert die Admin-Quelle als einen zusammenhängenden Geltungsbereich — die Form, in der die
// Tests sie untersuchen und teilweise auch auswerten.
//
// Die Module tragen seit der Umstellung ESM-Syntax. Die wird hier abgestreift, nicht weil sie
// stört, sondern weil sie für diese Betrachtung nichts beiträgt: Was ein Modul importiert,
// deklariert ein anderes, und aneinandergereiht ergibt sich genau der Scope, den der Browser
// nach dem Bündeln sieht. Die Reihenfolge ist die des Dateinamens und damit die frühere.
module.exports = function adminSource() {
  const directory = path.join(__dirname, "../../blog/admin/admin-src");
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
    .map((text) => text.replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, ""))
    .join("");
};
