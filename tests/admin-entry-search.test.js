// Die Artikelliste fand einen Beitrag bisher nur über Titel und Dateinamen. Was drinsteht,
// war unerreichbar — bei über vierhundert Beiträgen heißt das: wer den Satz noch weiß, aber
// die Überschrift nicht mehr, sucht von Hand.
//
// Diese Tests halten die Kette fest, über die der Text in die Suche kommt: Der Build leitet
// aus derselben Quelldatei, die der Editor öffnet, einen lesbaren Suchtext ab; der Admin
// leitet ihn für vorgemerkte Änderungen im Browser ab; beide Wege müssen dasselbe ergeben,
// sonst findet man eine gespeicherte Fassung anders als die ungespeicherte. Und sie halten
// fest, dass der Treffer erklärbar bleibt: Der Auszug zeigt die gefundene Stelle im
// Originaltext, nicht in der kleingeschriebenen Vergleichsform.
//
// Fixtures statt echter Beiträge: blog/posts/ fehlt im öffentlichen Engine-Export, ein Test,
// der dort liest, wäre in der Kopie rot.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const matter = require("gray-matter");

const searchText = require("../blog/admin/search-text");
const { createAdminSearchTextExtractor } = require("../lib/eleventy/admin-search");
const adminSource = require("./helpers/admin-source");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function extractFunction(sourceText, anchor) {
  const start = sourceText.indexOf(anchor);
  assert.notEqual(start, -1, `Missing function: ${anchor}`);
  const blockStart = sourceText.indexOf("{", start + anchor.length - 1);
  let depth = 0;
  for (let index = blockStart; index < sourceText.length; index += 1) {
    if (sourceText[index] === "{") depth += 1;
    if (sourceText[index] === "}") depth -= 1;
    if (depth === 0) return sourceText.slice(start, index + 1);
  }
  throw new Error(`Unclosed function: ${anchor}`);
}

function loadFunction(anchor, dependencies = {}) {
  const source = extractFunction(adminSource(), anchor);
  const names = Object.keys(dependencies);
  return new Function(...names, `return (${source});`)(...names.map((name) => dependencies[name]));
}

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "admin-search-"));
  test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// --- Der Suchtext ---------------------------------------------------------

test("markdown becomes the words a reader would see", () => {
  const plain = searchText.plainText([
    "# Überschrift",
    "",
    "![Zwei Kraniche im Nebel](https://media.mysite.example/images/uploads/img_2481.webp)",
    "",
    "Ein *kursiver* Satz mit einem [Verweis](https://example.org/ziel) und `Code`.",
    "",
    "> [!WARNING]",
    "> **ACHTUNG**",
    "",
    "```js",
    "const versteckt = 1;",
    "```",
    "",
    "- Erster Punkt",
    "- Zweiter Punkt",
    "",
    "!video[Ein Clip](/assets/videos/uploads/clip.mp4)"
  ].join("\n"));

  assert.match(plain, /Überschrift/);
  assert.match(plain, /Zwei Kraniche im Nebel/, "der Alt-Text ist Inhalt und bleibt erhalten");
  assert.doesNotMatch(plain, /img_2481/, "die Bildquelle nicht — dafür gibt es den Medienindex");
  assert.match(plain, /Verweis https:\/\/example\.org\/ziel/, "Verweisziele bleiben durchsuchbar");
  assert.match(plain, /kursiver Satz/);
  assert.match(plain, /const versteckt = 1;/, "Code ist Inhalt, seine Zäune sind es nicht");
  assert.doesNotMatch(plain, /```/);
  assert.match(plain, /ACHTUNG/);
  assert.doesNotMatch(plain, /\[!WARNING\]/);
  assert.match(plain, /Erster Punkt Zweiter Punkt/);
  assert.match(plain, /Ein Clip/);
  assert.doesNotMatch(plain, /clip\.mp4/);
  assert.doesNotMatch(plain, /\s{2,}|\n/, "eine Zeile, einfache Abstände");
});

test("html and entities are read, not shown", () => {
  const plain = searchText.plainText('<p class="lead">Ein <strong>Satz</strong> &amp; ein Zeichen</p><!-- Notiz -->');
  assert.equal(plain, "Ein Satz & ein Zeichen");
});

test("nunjucks pages are searched without their template plumbing", () => {
  const plain = searchText.plainTextFromTemplate("{% extends 'layouts/base.njk' %}\n<h1>{{ title }}</h1>\n<p>Über mich</p>");
  assert.equal(plain, "Über mich");
});

// Die Vergleichsform muss zeichengleich zur lesbaren bleiben: Der Auszug findet die Stelle in
// der einen und schneidet sie aus der anderen. Eine Umschrift wie ß → ss würde jede folgende
// Position um eins verschieben — der Auszug träfe daneben.
test("normalizing keeps the length, so an offset means the same place in both forms", () => {
  // "İ" ist der Fall, an dem eine naive Kleinschreibung bricht: JavaScript macht daraus zwei
  // Zeichen, und jeder Treffer dahinter wäre um eins verschoben markiert.
  for (const sample of ["München", "Straße", "Œuvre", "Çağrı", "ÅÄÖ", "naïve café", "İstanbul", "😀 Ässe"]) {
    assert.equal(searchText.normalize(sample).length, sample.length, sample);
  }
  assert.equal(searchText.normalize("München"), "munchen");
  assert.equal(searchText.normalize("Straße"), "straße", "ß bleibt, weil es allein nicht faltbar ist");
  assert.equal(searchText.normalize("İstanbul"), "İstanbul", "was die Breite verschöbe, bleibt stehen");
});

// Der Build läuft über vierhundert Beiträge. Ein einziges kaputtes Zeichen darin darf ihn
// nicht abbrechen — String.fromCodePoint wirft außerhalb von Unicode.
test("a numeric entity outside Unicode is left alone instead of throwing", () => {
  assert.equal(searchText.plainText("Zeichen &#x110000; Ende"), "Zeichen &#x110000; Ende");
  assert.equal(searchText.plainText("Zeichen &#99999999; Ende"), "Zeichen &#99999999; Ende");
  assert.equal(searchText.plainText("Ein &#8211; Strich"), "Ein – Strich");
  assert.equal(searchText.plainText("Ein &#x2013; Strich"), "Ein – Strich");
  assert.equal(searchText.plainText("Ein &unbekannt; Wort"), "Ein &unbekannt; Wort");
});

test("an empty term cannot spin the excerpt", () => {
  assert.equal(searchText.excerpt("abc", [""]), null);
  assert.deepEqual(searchText.matchRanges("abc", ["", "b"]), [[1, 2]]);
});

test("a query is a set of words, quotes hold a phrase together", () => {
  assert.deepEqual(searchText.parseQuery("  Lego   München "), ["lego", "munchen"]);
  assert.deepEqual(searchText.parseQuery('"zwei kraniche" nebel'), ["zwei kraniche", "nebel"]);
  assert.deepEqual(searchText.parseQuery("   "), []);
  assert.deepEqual(searchText.parseQuery(undefined), []);
});

test("the excerpt shows the hit in the original text", () => {
  const text = "Ein langer Vorlauf, der nur da ist, damit der Auszug vorne abschneiden muss. Dann kommt die Prüfung in München und danach noch mehr Text, der hinten abgeschnitten wird.";
  const result = searchText.excerpt(text, searchText.parseQuery("prufung munchen"), { length: 60 });

  assert.ok(result, "es gibt einen Treffer");
  const rendered = result.segments.map((segment) => segment.text).join("");
  assert.ok(text.includes(rendered), "der Auszug ist ein wörtlicher Ausschnitt");
  assert.deepEqual(result.segments.filter((segment) => segment.match).map((segment) => segment.text), ["Prüfung", "München"]);
  assert.equal(result.prefix, "…");
  assert.equal(result.suffix, "…");

  assert.equal(searchText.excerpt(text, ["nichtvorhanden"]), null);
});

test("the haystack carries tags and description, but not the title", () => {
  const text = searchText.documentText([
    "---",
    "title: Eine Tour",
    "date: '2026-08-01T10:00:00.000Z'",
    "image: /assets/images/uploads/img_1.webp",
    "tags:",
    "  - radfahren",
    "  - bayern",
    "description: Eine Tour im Voralpenland",
    "---",
    "",
    "# Titel im Text",
    "",
    "Der Rumpf."
  ].join("\n"));

  assert.match(text, /radfahren bayern/);
  assert.match(text, /Eine Tour im Voralpenland/);
  assert.match(text, /Der Rumpf\./);
  assert.doesNotMatch(text, /2026-08-01|img_1|title:/, "Datum, Bildpfad und Schlüssel sind kein Inhalt");
  assert.equal(searchText.documentText(""), "");
  assert.equal(searchText.documentText(undefined), "");
});

test("inline lists and quoted values in the frontmatter are read too", () => {
  const text = searchText.documentText("---\ntags: [radfahren, bayern]\nsummary: 'Kurz gefasst'\n---\nRumpf.");
  assert.equal(text, "radfahren bayern Kurz gefasst Rumpf.");
});

// Ein Dokument ohne Frontmatter ist trotzdem ein Dokument — und ein "---" mitten im Text
// beginnt keines.
test("a document without frontmatter is all body", () => {
  assert.equal(searchText.documentText("Nur Text.\n\n---\n\nUnd mehr."), "Nur Text. Und mehr.");
});

// --- Der Build-Auszug -----------------------------------------------------

test("the build derives the text from the file the editor opens", () => {
  const directory = temporaryDirectory();
  const post = path.join(directory, "beitrag.md");
  fs.writeFileSync(post, "---\ntitle: Sommerabend\ntags:\n  - blog\ndescription: Kurzfassung\n---\n\nZwei Kraniche im Nebel.\n");
  const page = path.join(directory, "seite.njk");
  fs.writeFileSync(page, "---\ntitle: Über mich\n---\n{% set x = 1 %}<p>Ich schreibe hier.</p>\n");

  const getAdminSearchText = createAdminSearchTextExtractor();

  const postText = getAdminSearchText({ inputPath: post });
  assert.match(postText, /blog Kurzfassung Zwei Kraniche im Nebel\./);
  assert.doesNotMatch(postText, /Sommerabend/, "der Titel steht schon in der Liste");

  assert.equal(getAdminSearchText({ inputPath: page }), "Ich schreibe hier.");
  assert.equal(getAdminSearchText({ inputPath: path.join(directory, "fehlt.md") }), "");
  assert.equal(getAdminSearchText({}), "");
});

test("a source file is read once per state, and again once it changed", () => {
  const directory = temporaryDirectory();
  const file = path.join(directory, "beitrag.md");
  fs.writeFileSync(file, "---\ntitle: Erst\n---\nErster Rumpf.\n");

  let reads = 0;
  const fileSystem = {
    statSync: (target) => fs.statSync(target),
    readFileSync: (target, encoding) => {
      reads += 1;
      return fs.readFileSync(target, encoding);
    }
  };
  const getAdminSearchText = createAdminSearchTextExtractor({ fileSystem });

  assert.equal(getAdminSearchText({ inputPath: file }), "Erster Rumpf.");
  assert.equal(getAdminSearchText({ inputPath: file }), "Erster Rumpf.");
  assert.equal(reads, 1, "der zweite Aufruf im selben Build liest nicht erneut");

  const later = new Date(Date.now() + 4000);
  fs.writeFileSync(file, "---\ntitle: Erst\n---\nZweiter Rumpf.\n");
  fs.utimesSync(file, later, later);

  assert.equal(getAdminSearchText({ inputPath: file }), "Zweiter Rumpf.");
  assert.equal(reads, 2);
});

// Der Build liest das Frontmatter mit gray-matter, der Admin mit seinem eigenen Parser. Wenn
// die beiden Wege auseinanderlaufen, findet dieselbe Suche eine vorgemerkte Änderung anders
// als die veröffentlichte Fassung desselben Beitrags — und niemand sieht, warum.
test("build and browser derive the same text from the same document", () => {
  const document = [
    "---",
    "title: Sommerabend",
    "tags:",
    "  - blog",
    "  - natur",
    "description: Kurzfassung mit Umlauten — Prüfung",
    "---",
    "",
    "![Zwei Kraniche im Nebel](/assets/images/uploads/img_2481.webp)",
    "",
    "Ein Satz mit [Verweis](https://example.org) und `Code`.",
    ""
  ].join("\n");

  const directory = temporaryDirectory();
  const file = path.join(directory, "beitrag.md");
  fs.writeFileSync(file, document);

  const fromBuild = createAdminSearchTextExtractor()({ inputPath: file });
  const fromBrowser = searchText.documentText(document);

  assert.equal(fromBuild, fromBrowser);
  assert.match(fromBuild, /blog natur Kurzfassung mit Umlauten — Prüfung Zwei Kraniche im Nebel Ein Satz mit Verweis https:\/\/example\.org und Code\./);

  // Und der Build liest wirklich die Datei, nicht eine eigene Vorstellung davon.
  assert.equal(matter(document).content.trim().startsWith("!["), true);
});

// --- Die Liste ------------------------------------------------------------

test("an entry matches when title and text together carry every word", () => {
  const entrySearchMatch = loadFunction("function entrySearchMatch(entry, terms)", {
    normalize: searchText.normalize,
    matchesAll: searchText.matchesAll,
    excerpt: searchText.excerpt,
    normalizedOf: (record) => searchText.normalize(record.text),
    searchRecord: (path) => (path === "blog/posts/lego.md" ? { text: "Gebaut an einem Abend in München." } : null)
  });

  const entry = { title: "18 Kilogramm Lego", path: "blog/posts/lego.md" };

  assert.equal(entrySearchMatch(entry, []).match, true, "ohne Suchwort bleibt alles stehen");
  assert.equal(entrySearchMatch(entry, ["lego"]).excerpt, null, "ein Titeltreffer braucht keinen Auszug");
  assert.equal(entrySearchMatch(entry, ["kilogramm", "quatsch"]).match, false);

  const gemischt = entrySearchMatch(entry, ["lego", "munchen"]);
  assert.equal(gemischt.match, true, "ein Wort im Titel, eines im Text");
  assert.deepEqual(gemischt.excerpt.segments.filter((segment) => segment.match).map((segment) => segment.text), ["München"]);

  const ohneText = { title: "Ohne Index", path: "blog/posts/ohne.md" };
  assert.equal(entrySearchMatch(ohneText, ["munchen"]).match, false, "was kein Text hat, kann nicht im Text treffen");
});

test("a failed payload says so instead of claiming there is nothing", () => {
  const message = (status, terms) => loadFunction("function entryListEmptyMessage(terms, connected)", {
    state: { searchIndexStatus: status },
    searchIndexPending: (list) => Boolean(list.length) && status !== "ready" && status !== "failed"
  })(terms, true);

  assert.match(message("failed", ["lego"]), /Volltext ließ sich nicht laden/);
  assert.equal(message("ready", ["lego"]), "Keine Treffer.");
  assert.equal(message("loading", ["lego"]), "Volltext wird geladen …");
  assert.equal(message("failed", []), "Noch keine Einträge. Beginne mit „Neu“.");
  assert.match(
    loadFunction("function entryListEmptyMessage(terms, connected)", { state: {}, searchIndexPending: () => false })([], false),
    /Verbinde GitHub/
  );
});

test("the list says that the full text is still on its way", () => {
  const searchIndexPending = loadFunction("function searchIndexPending(terms)", {
    state: { searchIndexStatus: "loading" }
  });
  assert.equal(searchIndexPending(["lego"]), true);
  assert.equal(searchIndexPending([]), false, "ohne Suche wartet niemand");

  const fertig = loadFunction("function searchIndexPending(terms)", { state: { searchIndexStatus: "ready" } });
  assert.equal(fertig(["lego"]), false);

  const gescheitert = loadFunction("function searchIndexPending(terms)", { state: { searchIndexStatus: "failed" } });
  assert.equal(gescheitert(["lego"]), false, "ein gescheiterter Abruf wartet nicht ewig");
});

// Der Volltext ist ein Build-Ergebnis: Was gerade veröffentlicht wurde, steht erst in der
// nächsten Fassung. Die im Speicher würde weiter mit dem Text von vorhin antworten.
test("an explicit refresh drops the payload and lets a failed request try again", () => {
  const state = {
    searchIndex: new Map([["blog/posts/alt.md", { text: "Alter Text", normalized: "alter text" }]]),
    searchIndexStatus: "failed",
    searchIndexPromise: Promise.resolve(false),
    searchIndexRequest: 7,
    searchPendingTexts: new Map([["blog/posts/vorgemerkt.md", { source: "x", text: "x" }]])
  };

  loadFunction("function resetSearchIndex()", { state })();

  assert.equal(state.searchIndex.size, 0);
  assert.equal(state.searchIndexStatus, "idle", "auch ein gescheiterter Abruf darf wieder starten");
  assert.equal(state.searchIndexPromise, null);
  assert.equal(state.searchIndexRequest, 8, "eine noch laufende Antwort ist damit überholt");
  assert.equal(state.searchPendingTexts.size, 0);
});

// --- Die Verdrahtung ------------------------------------------------------

test("the index is built, served and loaded where it belongs", () => {
  const template = read("blog/admin-posts-search.njk");
  assert.match(template, /permalink: \/admin\/posts-search\.json/, "hinter der Anmeldung, wie der Posts-Index");
  assert.match(template, /collections\.adminSearchDocuments \| adminSearchIndex/);

  const config = read(".eleventy.js");
  assert.match(config, /addCollection\("adminSearchDocuments"/);
  assert.match(config, /addFilter\("adminSearchIndex"/);
  assert.match(config, /publishAdmin\n\s*\? collectionApi\.getAll\(\)/, "ohne veröffentlichten Admin bleibt der Index leer");

  const shell = read("blog/admin/index.html");
  const searchTag = shell.indexOf("/admin/search-text.js");
  const bundleTag = shell.indexOf("/admin/vendor/app/admin.js");
  assert.notEqual(searchTag, -1, "der geteilte Baustein wird geladen");
  assert.ok(searchTag < bundleTag, "und zwar vor dem Bündel, das ihn benutzt");

  const entries = read("blog/admin/admin-src/25-entries.js");
  const refresh = entries.slice(entries.indexOf("export async function refreshEntries"));
  assert.match(refresh.slice(0, 400), /if \(force\) \{ state\.postsIndex = null; resetSearchIndex\(\); \}/,
    "„Aktualisieren“ verwirft beide Indexe, bevor die Liste neu zeichnet");
  assert.match(entries, /if \(terms\.length && searchIndexStatus\(\) === "idle"\) ensureSearchIndex\(\)/,
    "und jede Zeichnung holt nach, was einer offenen Suche fehlt");

  // Dass die Vorlage in der öffentlichen Engine landet, prüft tests/public-engine-export.test.js.
  // Hier wäre es nicht prüfbar: scripts/export-public-engine.js schickt sich selbst nicht mit,
  // und im Snapshot scheiterte deshalb diese ganze Datei — samt ihrer Suchtests.
});
