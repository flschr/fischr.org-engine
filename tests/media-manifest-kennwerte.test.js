// Was das Manifest über ein Bild weiss, ersetzt seit der Umstellung das Lesen der Bytes im Bau.
// Diese Tests halten fest, dass die Ersetzung wirklich gleichwertig ist — und nicht nur bei den
// beiden Werten, die sichtbar sind. `hasAlpha` ist der stille dritte: Bei einem durchsichtigen
// Bild bleibt der unscharfe Platzhalter absichtlich weg, sonst schiene er durch. Ein hart
// gesetztes `false` an dieser Stelle gab 22 durchsichtigen Bildern einen Platzhalter zurück,
// ohne dass ein Test rot wurde.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const sharp = require("sharp");
const { createMediaAssetHelpers } = require("../lib/eleventy/media-assets");
const { vollstaendigBeschrieben } = require("../scripts/lib/r2-media");

const LQIP = "data:image/webp;base64,GESPEICHERT";

// Die Bytes liegen in den ersten beiden Tests bewusst mit *anderen* Werten daneben, als das
// Manifest behauptet: Läse der Bau sie, käme etwas anderes heraus als das Erwartete. Nötig sind
// sie nur, weil hier keine responsiven Varianten im Manifest stehen; im Bau werden auch die
// übersprungen (siehe generateResponsiveImageVariant).
async function deckendeBytes(width = 40, height = 20) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } }
  }).webp().toBuffer();
}

function aufbau(eintraege, dateien = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-kennwerte-"));
  const imageRoot = path.join(tmp, "blog/assets/images");
  fs.mkdirSync(path.join(imageRoot, "uploads"), { recursive: true });
  for (const [name, bytes] of Object.entries(dateien)) {
    fs.writeFileSync(path.join(imageRoot, "uploads", name), bytes);
  }
  const media = createMediaAssetHelpers({ root: tmp, localImageRoot: imageRoot, mediaManifest: eintraege });
  return { tmp, media };
}

function eintrag(name, extra) {
  return {
    sourcePath: `blog/assets/images/uploads/${name}`,
    objectKey: `images/uploads/${name}`,
    sha256: "f".repeat(64),
    size: 1,
    contentType: "image/webp",
    ...extra
  };
}

test("ein durchsichtiges Bild bekommt keinen Platzhalter, auch wenn nur das Manifest es weiss", async () => {
  const { media } = aufbau(
    { "images/uploads/durchsichtig.webp": eintrag("durchsichtig.webp", { width: 800, height: 600, hasAlpha: true }) },
    { "durchsichtig.webp": await deckendeBytes() }
  );

  const html = await media.addMediaPerformanceAttributes(
    '<img src="/assets/images/uploads/durchsichtig.webp" alt="x">',
    "/test/"
  );

  assert.equal(html.includes("background-image"), false, "durchsichtiges Bild darf keinen Platzhalter bekommen");
  assert.match(html, /width="800"/);
  assert.match(html, /height="600"/);
});

test("ein deckendes Bild bekommt genau den Platzhalter aus dem Manifest", async () => {
  const { media } = aufbau(
    { "images/uploads/deckend.webp": eintrag("deckend.webp", { width: 800, height: 600, hasAlpha: false, lqip: LQIP }) },
    { "deckend.webp": await deckendeBytes() }
  );

  const html = await media.addMediaPerformanceAttributes(
    '<img src="/assets/images/uploads/deckend.webp" alt="x">',
    "/test/"
  );

  assert.ok(html.includes(`background-image:url(${LQIP})`), "gespeicherter Platzhalter muss unverändert durchgereicht werden");
});

test("ohne Angabe im Manifest wird nicht geraten, sondern aus den Bytes gelesen", async () => {
  const bytes = await deckendeBytes();

  const { media } = aufbau(
    { "images/uploads/unbekannt.webp": eintrag("unbekannt.webp", {}) },
    { "unbekannt.webp": bytes }
  );

  const html = await media.addMediaPerformanceAttributes(
    '<img src="/assets/images/uploads/unbekannt.webp" alt="x">',
    "/test/"
  );

  assert.match(html, /width="40"/, "Abmessungen müssen aus den Bytes kommen");
  assert.match(html, /height="20"/);
  assert.ok(html.includes("background-image:url(data:image/webp;base64,"), "Platzhalter muss aus den Bytes entstehen");
  assert.equal(html.includes(LQIP), false);
});

test("vollständig beschrieben heisst: der Bau braucht die Bytes nicht mehr", () => {
  const basis = { sha256: "a", width: 1, height: 1 };

  assert.equal(vollstaendigBeschrieben({ ...basis, hasAlpha: true }), true, "durchsichtig: kein Platzhalter nötig");
  assert.equal(vollstaendigBeschrieben({ ...basis, hasAlpha: false, lqip: LQIP }), true);
  assert.equal(vollstaendigBeschrieben({ ...basis, hasAlpha: false }), false, "deckend ohne Platzhalter fehlt etwas");
  assert.equal(vollstaendigBeschrieben({ ...basis, lqip: LQIP }), false, "ohne hasAlpha darf nicht geraten werden");
  assert.equal(vollstaendigBeschrieben({ width: 1, height: 1, hasAlpha: true }), false, "ohne sha256 kein Beleg");
  assert.equal(vollstaendigBeschrieben(null), false);
});
