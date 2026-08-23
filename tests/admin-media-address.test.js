// Der Admin darf keine Auslieferungsadresse mehr selbst zusammensetzen.
//
// Bis zum 2026-08-23 tat er das: publicImageDeliveryPath sagte die R2-Adresse eines frisch
// hochgeladenen Bildes aus seinem Pfad voraus, weil beide dasselbe waren. Seit Uploads
// inhaltsadressiert sind, entsteht die Adresse aus dem sha256 der normalisierten Bytes — die
// der Server erst nach dem Hochladen erzeugt. Eine Vorhersage kann das nicht wissen.
//
// Die Folge war kein Fehler, sondern ein 404: Der erste Upload nach der Umstellung schrieb eine
// URL ins Markdown, unter der das Bild nie lag. Hochgeladen war es korrekt, nur eben woanders.
//
// Eingefügt wird deshalb der lokale /assets/…-Pfad — wie bei einem Bild aus der Mediathek und
// wie bei Videos. toDeliveryUrl im Build löst ihn über das Manifest auf und kennt die echte
// Adresse.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const adminRoot = path.join(__dirname, "..", "blog/admin");

// Aus einem einfachen Literal gebaut, nicht als escapter Regex geschrieben: Der Export in
// scripts/export-public-engine.js schreibt diese Zeichenkette in der öffentlichen Fassung um.
// Ein Regex-Literal mit escapten Punkten überlebt das Umschreiben unverändert und scheitert
// dann ausgerechnet im Export — dieselbe Falle, vor der tests/eleventy-render.test.js warnt.
const deliveryHost = new RegExp("media.mysite.example".replace(/\./g, "\\."));

function adminSource() {
  const dir = path.join(adminRoot, "admin-src");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".part"))
    .sort()
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("");
}

// Kommentare dürfen den Host erklären; Code darf ihn nicht bauen.
function withoutComments(source) {
  return source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

test("the admin never composes a media delivery URL itself", () => {
  const code = withoutComments(adminSource());

  assert.doesNotMatch(code, deliveryHost, "the admin must not build delivery URLs by hand");
  assert.doesNotMatch(code, /publicImageDeliveryPath/, "the prediction must not come back");
});

// Die Gegenprobe am ausgelieferten Bündel: Was dort nicht steht, kann kein Browser ausführen.
test("the built admin bundle carries no delivery host either", () => {
  const bundle = fs.readFileSync(path.join(adminRoot, "vendor/app/admin.js"), "utf8");
  assert.doesNotMatch(withoutComments(bundle), deliveryHost);
});

// Ein frisch hochgeladenes Bild muss denselben Pfad einfügen wie eines aus der Mediathek —
// sonst hätte der Upload-Weg wieder eine eigene Meinung über Adressen.
test("a fresh upload inserts the same local path a library pick would", () => {
  const code = adminSource();
  const prepared = code.match(/function preparedMediaChange\(change\)[\s\S]*?\n  \}/);
  assert.ok(prepared, "preparedMediaChange must still exist");
  assert.match(prepared[0], /publicPath: publicMediaPath\(path\)/);
});
