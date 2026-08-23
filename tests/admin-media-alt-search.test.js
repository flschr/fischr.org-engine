// Die Mediathek findet ein Bild bisher nur über seinen Pfad, seinen Dateinamen und die Titel
// der Beiträge, die es verwenden. Bilder aus dem Upload heißen aber "img_2481.webp" — was das
// Bild zeigt, steht ausschließlich im Alt-Text im Markdown des Beitrags.
//
// Diese Tests halten die Kette fest, über die der Alt-Text in die Suche kommt: Der Build legt
// ihn je Referenz in den Posts-Index, der Admin normalisiert beide Index-Formen, und der
// Suchtext trägt ihn mit. Und sie halten fest, dass die Karte den Treffer erklärt: Ohne
// sichtbaren Alt-Text sieht ein Treffer auf "img_2481.webp" wie ein Fehler aus.

const test = require("node:test");
const assert = require("node:assert/strict");
const adminSource = require("./helpers/admin-source");

function extractFunction(sourceText, anchor) {
  const start = sourceText.indexOf(anchor);
  assert.notEqual(start, -1, `Missing function: ${anchor}`);
  const blockStart = sourceText.indexOf("{", start);
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

test("the media search matches the alt text of a referencing article", () => {
  const mediaSearchText = loadFunction("function mediaSearchText(item)");
  const item = {
    path: "blog/assets/images/uploads/img_2481.webp",
    publicPath: "/assets/images/uploads/img_2481.webp",
    name: "img_2481.webp",
    references: [{ title: "Sommerabend", path: "./blog/posts/sommerabend.md", publicPath: "/sommerabend/", alt: "Zwei Kraniche im Nebel" }]
  };

  const text = mediaSearchText(item);
  assert.ok(text.includes("kraniche"), "alt text is part of the searchable text");
  assert.ok(text.includes("img_2481"), "the file name stays searchable");
  assert.ok(!mediaSearchText({ ...item, references: [] }).includes("kraniche"));
});

test("shows every distinct alt text once, and nothing for images without one", () => {
  const mediaAltTexts = loadFunction("function mediaAltTexts(item)");

  assert.deepEqual(mediaAltTexts({ references: [
    { alt: "Zwei Kraniche im Nebel" },
    { alt: "Zwei Kraniche im Nebel" },
    { alt: " Derselbe Vogel, anders beschrieben " },
    { alt: "" }
  ] }), ["Zwei Kraniche im Nebel", "Derselbe Vogel, anders beschrieben"]);

  assert.deepEqual(mediaAltTexts({ references: [{ alt: "" }, {}] }), []);
  assert.deepEqual(mediaAltTexts({}), []);
});

// Der Posts-Index wird als JSON ausgeliefert und im Browser zwischengespeichert. Ein Index, der
// noch die alte Form mit reinen Adressen trägt, darf die Mediathek nicht um ihre Referenzen
// bringen — er trägt dann nur keinen Alt-Text.
test("reads both the old and the new media entry of the posts index", () => {
  const normalizeIndexMedia = loadFunction("function normalizeIndexMedia(media)");

  assert.deepEqual(normalizeIndexMedia(["/assets/images/alt-form.webp"]), [
    { url: "/assets/images/alt-form.webp", alt: "" }
  ]);
  assert.deepEqual(normalizeIndexMedia([{ url: "/assets/images/neu.webp", alt: "Ein Reh" }]), [
    { url: "/assets/images/neu.webp", alt: "Ein Reh" }
  ]);
  assert.deepEqual(normalizeIndexMedia([{ alt: "ohne Adresse" }, "", null]), []);
  assert.deepEqual(normalizeIndexMedia(undefined), []);
});

// Der Hintergrundabgleich erneuert eine Karte nur bei geänderter Signatur. Fehlt der Alt-Text
// darin, bleibt die Karte beim Nachladen der Referenzen ohne ihn stehen.
test("the reference signature notices a changed alt text", () => {
  const mediaReferencesSignature = loadFunction("function mediaReferencesSignature(item)");
  const reference = { path: "./blog/posts/a.md", title: "A", publicPath: "/a/", orderInEntry: 0 };

  assert.notEqual(
    mediaReferencesSignature({ references: [{ ...reference, alt: "Zwei Kraniche" }] }),
    mediaReferencesSignature({ references: [{ ...reference, alt: "" }] })
  );
});
