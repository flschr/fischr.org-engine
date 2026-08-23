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
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("");
}

// Kommentare dürfen den Host erklären; Code darf ihn nicht ableiten.
//
// Entfernt werden nur ganze Kommentarzeilen. Ein naives Wegschneiden ab dem ersten "//" wäre
// hier falsch — es hielte das "//" in "https://" für einen Kommentaranfang und löschte
// ausgerechnet die Zeichenkette, um die es geht. Genau das ist beim Schreiben dieses Tests
// passiert und liess ihn stumm durchgehen.
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

// Der Host darf genau einmal vorkommen, als benannte Konstante. Alles andere wäre wieder eine
// Ableitung: Der Admin braucht ihn zum *Nachschlagen* einer Adresse, die im Manifest steht —
// nicht zum Ausrechnen einer, die es noch nicht gibt.
test("the delivery host appears once, as a declared constant", () => {
  const code = withoutComments(adminSource());
  const occurrences = code.match(new RegExp(deliveryHost.source, "g")) || [];

  assert.equal(occurrences.length, 1, "the delivery host belongs in exactly one place");
  assert.match(
    withoutComments(fs.readFileSync(path.join(adminRoot, "admin-src/00-konstanten.js"), "utf8")),
    new RegExp(`const mediaDeliveryOrigin = "https://${deliveryHost.source}"`),
    "and that place is the constants module"
  );
});

test("the admin never derives a delivery address from a path", () => {
  const code = withoutComments(adminSource());

  assert.doesNotMatch(code, /publicImageDeliveryPath/, "the prediction must not come back");
  // Eine Adresse entsteht nur noch aus einem objectKey aus dem Manifest.
  assert.doesNotMatch(
    code,
    new RegExp(`${deliveryHost.source}/(images|videos)/`),
    "a path-shaped delivery URL means someone is deriving again"
  );
  assert.match(code, /\$\{mediaDeliveryOrigin\}\/\$\{entry\.objectKey\}/, "addresses come from the manifest entry");
});

// Die Gegenprobe am ausgelieferten Bündel: Was dort nicht steht, kann kein Browser ausführen.
// Die Gegenprobe am ausgelieferten Bündel: Auch dort darf keine pfadförmige Adresse stehen.
test("the built admin bundle derives no address either", () => {
  const bundle = withoutComments(fs.readFileSync(path.join(adminRoot, "vendor/app/admin.js"), "utf8"));
  assert.doesNotMatch(bundle, new RegExp(`${deliveryHost.source}/(images|videos)/`));
});

// Ein frisch hochgeladenes Bild muss denselben Pfad einfügen wie eines aus der Mediathek —
// sonst hätte der Upload-Weg wieder eine eigene Meinung über Adressen.
test("a fresh upload inserts the same local path a library pick would", () => {
  const code = adminSource();
  const prepared = code.match(/function preparedMediaChange\(change\)[\s\S]*?\n  \}/);
  assert.ok(prepared, "preparedMediaChange must still exist");
  assert.match(prepared[0], /publicPath: publicMediaPath\(path\)/);
});
