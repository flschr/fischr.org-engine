// Ein Beitrag, dessen Bild unter seiner Inhaltsadresse steht, muss dieses Bild auch an den
// Social-Beitrag anhängen können.
//
// Das ist der leiseste der drei Fälle, in denen dieselbe Rückabbildung gebraucht wird: Er
// bricht nichts ab und meldet nichts. Findet getLocalImage die Datei nicht, geht der Beitrag
// bei GoToSocial und Bluesky einfach ohne Bild raus — bei einem Fotoblog ausgerechnet dort,
// wo das Bild die halbe Nachricht ist.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");

// publish-utils.js liest root aus process.cwd() beim Laden, also läuft die Prüfung in einem
// eigenen Prozess mit eigenem Arbeitsverzeichnis.
function resolveIn(root, imageValue) {
  const script = `
    const { getLocalImage } = require("./scripts/lib/publish-utils.js");
    const image = getLocalImage({ image: ${JSON.stringify(imageValue)}, imageAlt: "Alt", title: "Titel" });
    process.stdout.write(JSON.stringify(image && { name: image.name, mimeType: image.mimeType }));
  `;
  return JSON.parse(execFileSync("node", ["-e", script], { cwd: root, encoding: "utf8" }) || "null");
}

function projectWith(manifest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-media-address-"));
  for (const relative of ["scripts/lib/publish-utils.js", "lib/media-manifest.js"]) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, relative), destination);
  }
  fs.symlinkSync(path.join(projectRoot, "node_modules"), path.join(root, "node_modules"), "dir");

  fs.mkdirSync(path.join(root, "blog/assets/images/uploads"), { recursive: true });
  fs.writeFileSync(path.join(root, "blog/assets/images/uploads/foto.webp"), Buffer.from("bytes"));
  fs.mkdirSync(path.join(root, "automation"), { recursive: true });
  fs.writeFileSync(path.join(root, "automation/media-manifest.json"), JSON.stringify(manifest));
  return root;
}

test("a post naming its image by path still finds the file", () => {
  const root = projectWith({ "images/uploads/foto.webp": { sha256: "x" } });
  assert.deepEqual(resolveIn(root, "/assets/images/uploads/foto.webp"), {
    name: "foto.webp",
    mimeType: "image/webp"
  });
});

test("a post naming its image by the historic delivery URL still finds the file", () => {
  const root = projectWith({ "images/uploads/foto.webp": { sha256: "x" } });
  assert.deepEqual(resolveIn(root, "https://media.mysite.example/images/uploads/foto.webp"), {
    name: "foto.webp",
    mimeType: "image/webp"
  });
});

test("a post naming its image by its content address finds the file too", () => {
  const objectKey = `cas/aa/${"aa".repeat(32)}.webp`;
  const root = projectWith({ "images/uploads/foto.webp": { sha256: "x", objectKey } });
  assert.deepEqual(resolveIn(root, `https://media.mysite.example/${objectKey}`), {
    name: "foto.webp",
    mimeType: "image/webp"
  });
});

test("an address no entry accounts for stays unresolved", () => {
  const root = projectWith({ "images/uploads/foto.webp": { sha256: "x" } });
  assert.equal(resolveIn(root, `https://media.mysite.example/cas/bb/${"bb".repeat(32)}.webp`), null);
});
