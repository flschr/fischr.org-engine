// Jeder Dialog, dessen Antwort aus returnValue gelesen wird, muss ihn vor dem Öffnen setzen.
//
// `<dialog>.returnValue` überlebt das Schliessen. WebKit lässt ihn beim Schliessen per Escape
// stehen, Chromium leert ihn — gemessen mit einem echten Tastendruck:
//
//     chromium:  nach Klick "delete"  →  nach Escape ""
//     webkit:    nach Klick "delete"  →  nach Escape "delete"
//
// Wer also einmal etwas gewählt hat und den Dialog später wegwischt, löst dieselbe Aktion noch
// einmal aus. Auf dem Gerät, auf dem geschrieben wird, und auf Chromium unsichtbar. Ein
// `returnValue || "cancel"` schützt nicht: Es greift nur bei leerem Wert, und leer ist er in
// genau diesem Fall nicht.
//
// Zwei Dialoge machten das falsch, beide zerstörend: das Löschen eines Artikels und die Rückfrage
// nach ungespeicherter Arbeit.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const quellen = path.join(__dirname, "..", "blog/admin/admin-src");

test("every dialog answered through returnValue resets it before opening", () => {
  const gepruefte = [];

  for (const datei of fs.readdirSync(quellen).filter((name) => name.endsWith(".js"))) {
    const quelle = fs.readFileSync(path.join(quellen, datei), "utf8");

    // Dialoge, deren Antwort gelesen wird — nicht jene, die nur gezeigt werden.
    const gelesen = new Set(
      // Ein einzelnes `=` ist eine Zuweisung, `===` ein Vergleich — und damit ein Lesezugriff.
      [...quelle.matchAll(/\b(els\.\w+)\.returnValue(?!\s*=[^=])/g)].map((treffer) => treffer[1])
    );

    for (const dialog of gelesen) {
      gepruefte.push(`${datei}: ${dialog}`);
      assert.ok(
        new RegExp(`${dialog.replace(".", "\\.")}\\.returnValue\\s*=`).test(quelle),
        `${datei}: ${dialog}.returnValue wird gelesen, aber nie vor dem Öffnen gesetzt — `
        + "nach einem Escape antwortet der Dialog in WebKit mit der letzten Wahl"
      );
    }
  }

  // Eine Prüfung, die nichts findet, behauptet nichts. Sieben Dialoge werden über returnValue
  // beantwortet; sinkt die Zahl, prüft dieser Test womöglich gar nichts mehr.
  assert.ok(gepruefte.length >= 6, `zu wenige Dialoge gefunden: ${gepruefte.join(", ")}`);
});

// Und die Reihenfolge: gesetzt wird vor showModal(), nicht danach.
test("the reset happens before the dialog is shown", () => {
  for (const datei of fs.readdirSync(quellen).filter((name) => name.endsWith(".js"))) {
    const quelle = fs.readFileSync(path.join(quellen, datei), "utf8");
    for (const treffer of quelle.matchAll(/(els\.\w+)\.returnValue\s*=/g)) {
      const dialog = treffer[1];
      const zeigen = quelle.indexOf(`${dialog}.showModal()`);
      if (zeigen === -1) continue;
      assert.ok(
        treffer.index < zeigen,
        `${datei}: ${dialog}.returnValue wird erst nach showModal() gesetzt`
      );
    }
  }
});
