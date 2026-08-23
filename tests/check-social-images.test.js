// Dieses Gate hatte keine Abdeckung, obwohl es in jedem Produktions-Build läuft und ihn
// abbrechen kann. Es prüft, ob das Vorschaubild eines Beitrags wirklich existiert — und
// verglich dafür den Pfad der Auslieferungs-URL direkt mit den Manifest-Schlüsseln.
//
// Das ging, solange beide dasselbe waren. Seit Uploads inhaltsadressiert sind, lautet die URL
// eines neuen Bildes cas/<hash>, und ein solcher Schlüssel steht nirgends im Manifest: Der
// Check hätte den ersten Beitrag mit neu hochgeladenem Vorschaubild als "nicht im Manifest"
// gemeldet und den Deploy angehalten.

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const projectRoot = path.join(__dirname, "..");

function articleWith(imageUrl) {
  return [
    "<html><head>",
    '<meta property="og:type" content="article">',
    `<meta property="og:image" content="${imageUrl}">`,
    `<meta name="twitter:image" content="${imageUrl}">`,
    '<meta property="og:image:alt" content="Beschreibung">',
    "</head><body></body></html>"
  ].join("\n");
}

function projectWith(manifest, imageUrl) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-social-images-"));
  fs.mkdirSync(path.join(root, "_site/post"), { recursive: true });
  fs.writeFileSync(path.join(root, "_site/post/index.html"), articleWith(imageUrl));
  fs.mkdirSync(path.join(root, "automation"), { recursive: true });
  fs.writeFileSync(path.join(root, "automation/media-manifest.json"), JSON.stringify(manifest));

  for (const relative of ["scripts/check-social-images.js", "lib/media-manifest.js"]) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, relative), destination);
  }
  return root;
}

function run(root) {
  return execFileAsync("node", ["scripts/check-social-images.js"], { cwd: root });
}

test("accepts a social image that is in the manifest under its historic path key", async () => {
  const root = projectWith(
    { "images/uploads/alt.webp": { sha256: "irrelevant" } },
    "https://media.mysite.example/images/uploads/alt.webp"
  );
  const { stdout } = await run(root);
  assert.match(stdout, /OK|1 article/i);
});

// Der Fall, an dem der nächste Beitrag mit frisch hochgeladenem Vorschaubild gescheitert wäre.
test("accepts a social image delivered from its content address", async () => {
  const objectKey = `cas/aa/${"aa".repeat(32)}.webp`;
  const root = projectWith(
    { "images/uploads/neu.webp": { sha256: "irrelevant", objectKey } },
    `https://media.mysite.example/${objectKey}`
  );
  const { stdout } = await run(root);
  assert.match(stdout, /OK|1 article/i);
});

// Und der Fall eines ersetzten Bildes, dessen alte Adresse noch in einem älteren Beitrag steht.
test("accepts a social image at an address the entry was superseded from", async () => {
  const current = `cas/bb/${"bb".repeat(32)}.webp`;
  const previous = "images/uploads/vorher.webp";
  const root = projectWith(
    { "images/uploads/vorher.webp": { sha256: "irrelevant", objectKey: current, supersededObjectKeys: [previous] } },
    `https://media.mysite.example/${previous}`
  );
  const { stdout } = await run(root);
  assert.match(stdout, /OK|1 article/i);
});

// Die Gegenprobe: Der Check darf nicht so weit aufmachen, dass er alles durchwinkt.
test("still rejects a social image that no manifest entry accounts for", async () => {
  const root = projectWith(
    { "images/uploads/andere.webp": { sha256: "irrelevant" } },
    `https://media.mysite.example/cas/cc/${"cc".repeat(32)}.webp`
  );
  await assert.rejects(run(root), (error) => {
    assert.match(error.stderr, /is not in the media manifest/);
    return true;
  });
});
