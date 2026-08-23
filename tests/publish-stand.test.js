// Wann eine Bewegung auf main die Freigabe entwertet.
//
// Die Regel gibt es zweimal: in scripts/admin-publish.js, das im Lauf entscheidet, und in
// worker/publish-stand.js, das vorher entscheidet. Weichen sie ab, lehnt die frühere Prüfung
// ab, was die spätere durchgelassen hätte — der Weg wird brüchiger statt verlässlicher.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
let stand;
test.before(async () => { stand = await import("../worker/publish-stand.js"); });

function musterAus(quelle, name) {
  const start = quelle.indexOf(`${name} = [`);
  assert.notEqual(start, -1, `Fehlende Liste: ${name}`);
  const ende = quelle.indexOf("];", start);
  return quelle.slice(quelle.indexOf("[", start) + 1, ende)
    .split("\n").map((zeile) => zeile.trim().replace(/,$/, ""))
    .filter(Boolean);
}

test("beide Stellen tolerieren dieselben Pfade", () => {
  const skript = fs.readFileSync(path.join(root, "scripts/admin-publish.js"), "utf8");
  const geteilt = fs.readFileSync(path.join(root, "worker/publish-stand.js"), "utf8");

  assert.deepEqual(
    musterAus(geteilt, "unkritischeMainPfade"),
    musterAus(skript, "safelyConcurrentMainPaths"),
    "worker/publish-stand.js und scripts/admin-publish.js müssen dieselben Muster führen"
  );
});

test("Automationsstand entwertet die Freigabe nicht", () => {
  assert.equal(stand.bewegungEntwertetFreigabe(["automation/media-manifest.json"]), false);
  assert.equal(stand.bewegungEntwertetFreigabe([".github/scheduled-publish-state.json"]), false);
  assert.equal(stand.bewegungEntwertetFreigabe([
    "automation/media-manifest.json",
    "automation/social/state.json"
  ]), false);
});

test("eine geprüfte Datei entwertet sie sehr wohl", () => {
  assert.equal(stand.bewegungEntwertetFreigabe(["blog/pages/datenschutz.md"]), true);
  // Auch dann, wenn sie zwischen lauter Unkritischem steht.
  assert.equal(stand.bewegungEntwertetFreigabe([
    "automation/media-manifest.json",
    "blog/posts/2026-08-23-etwas.md"
  ]), true);
});

function vergleichsStub(antwort) {
  const gefragt = [];
  return {
    gefragt,
    github: async (pfad) => { gefragt.push(pfad); return antwort; }
  };
}

test("gleiche SHA fragt gar nicht erst nach", async () => {
  const { github, gefragt } = vergleichsStub({});
  const urteil = await stand.freigabeGiltNoch({ repository: "r", erwartet: "a", aktuell: "a", github });
  assert.deepEqual(urteil, { gilt: true, grund: "unverändert" });
  assert.deepEqual(gefragt, [], "kein Netzaufruf für einen unveränderten Stand");
});

test("ein reiner Manifest-Fold lässt die Veröffentlichung zu", async () => {
  const { github, gefragt } = vergleichsStub({
    status: "ahead",
    total_commits: 1,
    files: [{ filename: "automation/media-manifest.json" }]
  });
  const urteil = await stand.freigabeGiltNoch({ repository: "example/example-blog", erwartet: "a", aktuell: "b", github });

  assert.equal(urteil.gilt, true);
  assert.deepEqual(gefragt, ["repos/example/example-blog/compare/a...b"]);
});

test("ein Artikel-Commit auf main lehnt ab", async () => {
  const { github } = vergleichsStub({
    status: "ahead",
    total_commits: 1,
    files: [{ filename: "blog/posts/2026-08-23-etwas.md" }]
  });
  const urteil = await stand.freigabeGiltNoch({ repository: "r", erwartet: "a", aktuell: "b", github });
  assert.equal(urteil.gilt, false);
  assert.match(urteil.grund, /geprüfte Dateien/);
});

// Im Zweifel gilt die Freigabe nicht. Ein Verlauf, den wir nicht als "aktuell enthält erwartet"
// belegen können, ist genau so ein Zweifel — dort weiterzumachen hiesse, etwas anderes zu
// veröffentlichen als das, was jemand gesehen hat.
test("ein unerwarteter Verlauf lehnt ab", async () => {
  for (const status of ["diverged", "behind", "identical"]) {
    const { github } = vergleichsStub({ status, total_commits: 1, files: [] });
    const urteil = await stand.freigabeGiltNoch({ repository: "r", erwartet: "a", aktuell: "b", github });
    assert.equal(urteil.gilt, false, `Verlauf ${status} darf nicht durchgehen`);
    assert.match(urteil.grund, new RegExp(status));
  }
});

// Die Compare-API liefert höchstens 300 Dateien. Eine gekappte Liste sieht harmlos aus, wenn
// gerade die kritische Datei abgeschnitten wurde.
test("eine gekappte Vergleichsliste lehnt ab, statt zu raten", async () => {
  const viele = Array.from({ length: 300 }, (unused, index) => ({ filename: `automation/datei-${index}.json` }));
  const { github } = vergleichsStub({ status: "ahead", total_commits: 3, files: viele });
  const urteil = await stand.freigabeGiltNoch({ repository: "r", erwartet: "a", aktuell: "b", github });

  assert.equal(urteil.gilt, false);
  assert.match(urteil.grund, /zu viele Änderungen/);
});

test("sehr viele Commits lehnen ebenfalls ab", async () => {
  const { github } = vergleichsStub({ status: "ahead", total_commits: 251, files: [] });
  const urteil = await stand.freigabeGiltNoch({ repository: "r", erwartet: "a", aktuell: "b", github });
  assert.equal(urteil.gilt, false);
});
