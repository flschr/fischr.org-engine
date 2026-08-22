const assert = require("node:assert/strict");
const test = require("node:test");
const readAdminSource = require("./helpers/admin-source");

// Evaluates the real slug helpers out of the admin source, so these assertions cover the code
// the browser actually runs rather than a copy that can drift.
function loadSlugHelpers() {
  const source = readAdminSource();
  const declarations = ["function transliterateGerman(value) {", "function slugify(value) {", "function slugifyLive(value) {"]
    .map((anchor) => extractDeclaration(source, anchor));
  return new Function(`${declarations.join("\n")}\nreturn { slugify, slugifyLive };`)();
}

function extractDeclaration(source, anchor) {
  const start = source.indexOf(anchor);
  assert.notEqual(start, -1, `Missing declaration: ${anchor}`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed declaration: ${anchor}`);
}

const { slugify, slugifyLive } = loadSlugHelpers();

test("slugify spells out German characters instead of dropping them", () => {
  // "ß" has no canonical decomposition, so before the transliteration it became a hyphen.
  assert.equal(slugify("Bratwürste an den Füßen"), "bratwuerste-an-den-fuessen");
  assert.equal(slugify("Straße & Gasse"), "strasse-and-gasse");
  assert.equal(slugify("Öl Ärger Übung"), "oel-aerger-uebung");
});

test("slugify keeps stripping other diacritics and stays URL-safe", () => {
  assert.equal(slugify("Café Añejo"), "cafe-anejo");
  assert.equal(slugify("  Hallo   Welt!  "), "hallo-welt");
  assert.equal(slugify(""), "new-post");
  assert.equal(slugify("!!!"), "new-post");
});

test("slugify treats a decomposed umlaut like a composed one", () => {
  // macOS filenames and some paste sources deliver "u" + combining diaeresis rather than a
  // composed umlaut character.
  assert.equal(slugify("Fu\u0308\u00dfe"), "fuesse");
  assert.equal(slugify("Fu\u0308\u00dfe"), slugify("F\u00fc\u00dfe"));
});

test("slugifyLive sanitizes while typing and keeps a trailing separator", () => {
  assert.equal(slugifyLive("Füße "), "fuesse-");
  assert.equal(slugifyLive("Grüße aus Köln"), "gruesse-aus-koeln");
});
