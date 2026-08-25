// Die Wahrheitstabelle der Warteschlange.
//
// „Warteschlange" hiess bisher „alles, was zwischen drafts und main abweicht". Das ist etwas
// anderes als „alles, was sich am Blog ändert" — ein nie veröffentlichter Entwurf steht in der
// ersten Menge und nicht in der zweiten. Er trägt `draft: true`, wird also weder gerendert
// (.eleventy.js) noch syndiziert (scripts/lib/publish-utils.js).

const assert = require("node:assert/strict");
const test = require("node:test");

let aktionen;
test.before(async () => { aktionen = await import("../blog/admin/admin-src/04c-queue-actions.js"); });

function aktion(warOeffentlich, wirdOeffentlich) {
  return aktionen.queueAktion({ warOeffentlich, wirdOeffentlich });
}

// null heisst „gibt es dort nicht" — auf main für einen neuen Beitrag, auf drafts für einen
// gelöschten. Ohne diesen dritten Wert fiele „neu angelegt" mit „war ein Entwurf" zusammen.
test("ein nie veröffentlichter Entwurf ändert am Blog nichts", () => {
  assert.equal(aktion(null, false), aktionen.OHNE_WIRKUNG, "neu angelegt und Entwurf geblieben");
  assert.equal(aktion(false, false), aktionen.OHNE_WIRKUNG, "war schon auf main, aber als Entwurf");
  assert.equal(aktion(false, null), aktionen.OHNE_WIRKUNG, "ein gelöschter Entwurf ebenso");
});

test("was den Blog erweitert, heisst veröffentlichen", () => {
  assert.equal(aktion(null, true), "veroeffentlichen", "neuer öffentlicher Beitrag");
  assert.equal(aktion(false, true), "veroeffentlichen", "aus einem Entwurf wird ein Beitrag");
});

test("was einen bestehenden Beitrag ändert, heisst aktualisieren", () => {
  assert.equal(aktion(true, true), "aktualisieren");
});

test("was den Blog verkleinert, wird benannt statt zusammengefasst", () => {
  assert.equal(aktion(true, false), "zurueckziehen", "bleibt liegen, verschwindet aber von der Seite");
  assert.equal(aktion(true, null), "loeschen", "ist danach ganz weg");
});

// Vier Wirkungen, vier Namen. Eine gemeinsame Beschriftung („Änderung") war der Grund, warum in
// der Warteschlange nicht zu sehen war, was das Senden anrichtet.
test("jede Aktion hat einen eigenen i18n-Schlüssel", () => {
  const schluessel = new Set(aktionen.AKTIONEN.map((name) => aktionen.AKTIONS_SCHLUESSEL[name]));
  assert.equal(schluessel.size, aktionen.AKTIONEN.length, "keine zwei Aktionen teilen sich einen Schlüssel");
  aktionen.AKTIONEN.forEach((name) => assert.ok(aktionen.AKTIONS_SCHLUESSEL[name], `${name} ohne Schlüssel`));
});

test("istWirksam trennt genau das Unwirksame ab", () => {
  aktionen.AKTIONEN.forEach((name) => assert.equal(aktionen.istWirksam(name), true, name));
  assert.equal(aktionen.istWirksam(aktionen.OHNE_WIRKUNG), false);
});

// Und die Beschriftung selbst, gegen die drei Auskünfte, aus denen sie entsteht: der Stand auf
// main (Baum), der Admin-Index für Beiträge, und das Frontmatter der Entwurfsfassung.
function beschriften(changes, { main = {}, index = {}, entwuerfe = {} } = {}) {
  return aktionen.beschrifteAktionen(changes, new Map(Object.entries(main)), {
    index: new Map(Object.entries(index)),
    istEntwurf: async (sha) => Boolean(entwuerfe[sha])
  }).then(() => changes.map((change) => change.aktion));
}

test("ein neuer öffentlicher Beitrag heisst veröffentlichen, ein neuer Entwurf gar nichts", async () => {
  const gelesen = await beschriften(
    [
      { path: "blog/posts/a.md", kind: "upsert", sha: "sha-a", collection: "posts" },
      { path: "blog/posts/b.md", kind: "upsert", sha: "sha-b", collection: "posts" }
    ],
    { entwuerfe: { "sha-b": true } }
  );
  assert.deepEqual(gelesen, ["veroeffentlichen", aktionen.OHNE_WIRKUNG]);
});

// Der Index kennt den Entwurfszustand von main für Beiträge — eine Abfrage für alle, statt eines
// Blob-Abrufs je Zeile.
test("für einen Beitrag beantwortet der Index, ob er öffentlich war", async () => {
  const gelesen = await beschriften(
    [
      { path: "blog/posts/live.md", kind: "upsert", sha: "neu", collection: "posts" },
      { path: "blog/posts/entwurf.md", kind: "upsert", sha: "neu2", collection: "posts" }
    ],
    {
      main: { "blog/posts/live.md": "alt", "blog/posts/entwurf.md": "alt2" },
      index: { "blog/posts/live.md": { draft: false }, "blog/posts/entwurf.md": { draft: true } }
    }
  );
  assert.deepEqual(gelesen, ["aktualisieren", "veroeffentlichen"]);
});

// Seiten führt der Index nicht. Für sie wird der Stand von main gelesen — pro Warteschlange
// ein bis zwei Dateien, nicht vierhundert.
test("für eine Seite wird der Stand von main gelesen", async () => {
  const gelesen = await beschriften(
    [{ path: "blog/pages/impressum.md", kind: "upsert", sha: "neu", collection: "pages" }],
    { main: { "blog/pages/impressum.md": "alt" }, entwuerfe: { alt: true } }
  );
  assert.deepEqual(gelesen, ["veroeffentlichen"], "war auf main ein Entwurf, wird jetzt öffentlich");
});

test("Löschen und Zurückziehen werden auseinandergehalten", async () => {
  const gelesen = await beschriften(
    [
      { path: "blog/posts/weg.md", kind: "delete", sha: "alt", collection: "posts" },
      { path: "blog/posts/zurueck.md", kind: "upsert", sha: "neu", collection: "posts" },
      { path: "blog/posts/nie.md", kind: "delete", sha: "alt3", collection: "posts" }
    ],
    {
      main: { "blog/posts/weg.md": "alt", "blog/posts/zurueck.md": "alt2", "blog/posts/nie.md": "alt3" },
      index: {
        "blog/posts/weg.md": { draft: false },
        "blog/posts/zurueck.md": { draft: false },
        "blog/posts/nie.md": { draft: true }
      },
      entwuerfe: { neu: true }
    }
  );
  assert.deepEqual(gelesen, ["loeschen", "zurueckziehen", aktionen.OHNE_WIRKUNG]);
});

test("Medien tragen ihre eigene Aktion und fragen nichts nach", async () => {
  const gelesen = await beschriften([{ path: "blog/assets/images/uploads/x.webp", kind: "upsert", sha: "m", collection: "media" }]);
  assert.deepEqual(gelesen, ["medien"]);
});

// --- Auswahl ---------------------------------------------------------------
//
// Der gefährliche Teil ist nicht die Kaste, sondern was mit den Medien passiert. Ein Artikel
// ohne sein Bild ergibt eine kaputte Seite; ein Bild ohne seinen Artikel ist eine Datei, die
// niemand sieht. Nur der erste Fall richtet Schaden an.

const artikel = (pfad, aktion = "aktualisieren") => ({ path: pfad, collection: "posts", aktion });
const medium = (pfad, publicPath) => ({ path: pfad, collection: "media", aktion: "medien", publicPath });

function senden(changes, abgewaehlt = [], medien = {}) {
  return aktionen.pfadeZumSenden(
    changes,
    new Set(abgewaehlt),
    new Map(Object.entries(medien))
  );
}

test("ohne Abwahl geht alles mit", () => {
  const changes = [artikel("blog/posts/a.md"), medium("blog/assets/images/uploads/x.webp", "/assets/images/uploads/x.webp")];
  assert.deepEqual(senden(changes), ["blog/assets/images/uploads/x.webp", "blog/posts/a.md"]);
});

test("ein abgewählter Artikel bleibt liegen", () => {
  const changes = [artikel("blog/posts/a.md"), artikel("blog/posts/b.md")];
  assert.deepEqual(senden(changes, ["blog/posts/a.md"]), ["blog/posts/b.md"]);
});

// Der Schadensfall: Ginge das Bild nicht mit, stünde der Artikel auf main mit einer Bildadresse,
// hinter der nichts liegt.
test("das Bild eines gewählten Artikels reist zwingend mit", () => {
  const changes = [artikel("blog/posts/a.md"), medium("blog/assets/images/uploads/x.webp", "/assets/images/uploads/x.webp")];
  const gesendet = senden(changes, [], { "blog/posts/a.md": ["/assets/images/uploads/x.webp"] });
  assert.ok(gesendet.includes("blog/assets/images/uploads/x.webp"));
});

test("ein Bild, auf das nur abgewählte Artikel zeigen, bleibt liegen", () => {
  const changes = [artikel("blog/posts/a.md"), medium("blog/assets/images/uploads/x.webp", "/assets/images/uploads/x.webp")];
  const gesendet = senden(changes, ["blog/posts/a.md"], { "blog/posts/a.md": ["/assets/images/uploads/x.webp"] });
  assert.deepEqual(gesendet, []);
});

// Zwei Artikel, ein Bild: Solange einer von beiden mitgeht, muss das Bild mit.
test("ein geteiltes Bild folgt dem gewählten Artikel", () => {
  const changes = [
    artikel("blog/posts/a.md"),
    artikel("blog/posts/b.md"),
    medium("blog/assets/images/uploads/x.webp", "/assets/images/uploads/x.webp")
  ];
  const medien = { "blog/posts/a.md": ["/assets/images/uploads/x.webp"], "blog/posts/b.md": ["/assets/images/uploads/x.webp"] };
  assert.deepEqual(
    senden(changes, ["blog/posts/a.md"], medien),
    ["blog/assets/images/uploads/x.webp", "blog/posts/b.md"]
  );
});

// Ein Bild, das kein Artikel benennt, ist auf main höchstens überflüssig — es bleibt deshalb
// dabei, statt eine Auswahl zu erfinden, die niemand getroffen hat.
test("ein unreferenziertes Bild reist mit", () => {
  const changes = [artikel("blog/posts/a.md"), medium("blog/assets/images/uploads/frei.webp", "/assets/images/uploads/frei.webp")];
  const gesendet = senden(changes, ["blog/posts/a.md"], {});
  assert.deepEqual(gesendet, ["blog/assets/images/uploads/frei.webp"]);
});

// Was öffentlich nichts bewirkt, wird nicht gezeigt und kann daher nicht abgewählt werden. Es
// muss trotzdem mit, sonst laufen drafts und main dauerhaft auseinander.
test("wirkungslose Änderungen reisen immer mit", () => {
  const changes = [
    { path: "blog/posts/entwurf.md", collection: "posts", aktion: aktionen.OHNE_WIRKUNG },
    artikel("blog/posts/a.md")
  ];
  assert.deepEqual(senden(changes, ["blog/posts/a.md"]), ["blog/posts/entwurf.md"]);
});

test("erzwungene Medien nennt genau die, die ein gewählter Artikel braucht", () => {
  const changes = [artikel("blog/posts/a.md"), artikel("blog/posts/b.md")];
  const medien = { "blog/posts/a.md": ["/bild-a.webp"], "blog/posts/b.md": ["/bild-b.webp"] };
  const erzwungen = aktionen.erzwungeneMedien(changes, new Set(["blog/posts/b.md"]), new Map(Object.entries(medien)));
  assert.deepEqual([...erzwungen], ["/bild-a.webp"]);
});

// Der Medien-Wächter sieht nur, was mitreist.
//
// Er hält die Veröffentlichung an, solange ein Bild noch verarbeitet wird — sonst stünde der
// Artikel auf main mit einer Adresse, hinter der nichts liegt. Gehört das Bild aber
// ausschliesslich zu einem abgewählten Artikel, reist es nicht mit und kann nichts kaputt
// machen. Ohne diese Einschränkung blockierte es trotzdem alles andere: Die Auswahl hälfe genau
// dort nicht, wo sie gedacht ist.
test("ein Bild eines abgewählten Artikels steht nicht mehr im Weg", () => {
  const changes = [
    artikel("blog/posts/fertig.md"),
    artikel("blog/posts/halb.md"),
    medium("blog/assets/images/uploads/halb.webp", "/assets/images/uploads/halb.webp")
  ];
  const medien = { "blog/posts/halb.md": ["/assets/images/uploads/halb.webp"] };

  const gesendet = senden(changes, ["blog/posts/halb.md"], medien);
  assert.deepEqual(gesendet, ["blog/posts/fertig.md"], "weder der Artikel noch sein Bild reisen mit");
});
