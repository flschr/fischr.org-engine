const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const adminSource = require("./helpers/admin-source");

test("admin source is split into bounded responsibilities", () => {
  const root = path.join(__dirname, "..");
  const sourceDir = path.join(root, "blog/admin/admin-src");
  const modules = fs.readdirSync(sourceDir).filter((name) => name.endsWith(".js")).sort();
  assert.ok(modules.length >= 20);
  // Gezählt wird ohne den Importkopf. Die Regel misst Verantwortung, und eine Importliste ist
  // keine — sie schreibt nur auf, was das frühere Modell verschwieg, als noch alle 490
  // Bezeichner einander sahen. Sie mitzuzählen würde bestrafen, dass Abhängigkeiten jetzt
  // sichtbar sind, und wäre ein Anreiz, sie wieder zu verstecken.
  for (const name of modules) {
    const body = fs
      .readFileSync(path.join(sourceDir, name), "utf8")
      .replace(/^import[^\n]*\n/gm, "");
    const lines = body.split("\n").length - 1;
    assert.ok(lines <= 200, `${name} must stay at or below 200 lines of its own`);
  }
});

// Die alte Fassung verglich das Bündel Byte für Byte mit der Verkettung der Quelldateien. Das
// war die einzige Zusicherung, die eine Aneinanderreihung überhaupt zulässt — und sie sagte
// nichts darüber, ob der Code zusammenpasst, weil eine Verkettung immer "funktioniert".
//
// Ein Modulbaum lässt eine echte Aussage zu: esbuild ordnet ihn statisch, solange kein Zyklus
// im Weg ist. Taucht ein Lazy-Wrapper auf (__esm oder __commonJS), hat esbuild einen Zyklus
// gefunden und wertet Module verzögert aus — die Reihenfolge ist dann eine andere als die im
// Quelltext gelesene, und genau daran scheitern Initialisierungen, die auf ein const zugreifen.
// Diese Zusicherung hält den Baum flach.
test("the admin bundles into one statically ordered scope", () => {
  const root = path.join(__dirname, "..");
  const built = fs.readFileSync(path.join(root, "blog/admin/vendor/app/admin.js"), "utf8");

  assert.match(built, /^\(\(\) => \{/, "the bundle stays a single immediately invoked scope");
  assert.doesNotMatch(built, /__commonJS\(/, "a CommonJS wrapper means a module was not treated as ESM");
  assert.doesNotMatch(built, /__esm\(/, "a lazy wrapper means esbuild found a cycle it could not order");
  assert.match(built, /\n\s*init\(\);\n\}\)\(\);\s*$/, "the application still starts itself at the end");

  // Die Quelle ist nicht mehr im Bündel wiederzufinden, aber sie muss vollständig eingegangen
  // sein: jedes Modul steuert mindestens seinen ersten Bezeichner bei.
  assert.ok(adminSource().length > 100000, "the module tree is still the source of the bundle");
});

// Die eine Fehlerklasse, die der Wechsel von einer Closure auf einen Modulbaum überhaupt neu
// einführt — und die weder der Build noch ein Unit-Test bemerkt.
//
// In der alten Fassung lief alles in Dateinamen-Reihenfolge, ein `const x = fremdesObjekt.y`
// weiter unten fand sein Objekt also immer fertig vor. Im Modulgraph entscheidet der Bündler die
// Reihenfolge, und wo zwei Module einander importieren, sieht eine Seite die andere noch
// uninitialisiert. Am 2026-08-23 startete der Admin deshalb nicht mehr: "Cannot read properties
// of undefined (reading 'docKey')" — sichtbar erst in den Browser-Tests, nicht im Build.
//
// Funktionen und Pfeilfunktionen sind unbedenklich: Sie verschieben den Zugriff auf den Aufruf.
// Entfernt die Rümpfe von Pfeilfunktionen aus einem Ausdruck.
//
// Was in einem Rückruf steht, liest erst der Aufruf — ein Dienst, dem einer übergeben wird,
// greift beim Auswerten nicht darauf zu. Ohne diesen Schnitt meldet die Prüfung praktisch jeden
// Dienst-Aufbau und wird deshalb überlesen statt gelesen. Zeilenweise zu schneiden reicht nicht:
// `getAccess: () => ({` öffnet den Rumpf, der Zugriff steht zwei Zeilen darunter.
function ohneRueckrufe(text) {
  let out = "";
  let index = 0;

  while (index < text.length) {
    const pfeil = text.indexOf("=>", index);
    if (pfeil === -1) return out + text.slice(index);

    out += text.slice(index, pfeil);
    let cursor = pfeil + 2;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;

    const auf = text[cursor];
    const zu = auf === "(" ? ")" : auf === "{" ? "}" : "";
    if (!zu) {
      // Rumpf ohne Klammer: bis zum Ende des Ausdrucks auf gleicher Ebene.
      let tiefe = 0;
      while (cursor < text.length) {
        const zeichen = text[cursor];
        if ("({[".includes(zeichen)) tiefe += 1;
        else if (")}]".includes(zeichen)) { if (tiefe === 0) break; tiefe -= 1; }
        else if (zeichen === "," && tiefe === 0) break;
        cursor += 1;
      }
      index = cursor;
      continue;
    }

    let tiefe = 0;
    while (cursor < text.length) {
      const zeichen = text[cursor];
      if (zeichen === auf) tiefe += 1;
      else if (zeichen === zu) { tiefe -= 1; if (tiefe === 0) { cursor += 1; break; } }
      cursor += 1;
    }
    index = cursor;
  }

  return out;
}

test("no module reads another module's binding while it is still being evaluated", () => {
  const sourceDir = path.join(__dirname, "..", "blog/admin/admin-src");
  const modules = fs.readdirSync(sourceDir).filter((name) => name.endsWith(".js") && name !== "main.js");
  const offenders = [];

  // Nur const/let-Bindungen sind gefährlich. Eine Funktionsdeklaration ist gehoistet und steht
  // auch mitten in einem Importzyklus schon bereit — sie an einen Dienst zu übergeben ist
  // unbedenklich. Ohne diese Unterscheidung meldet die Prüfung fast jeden Aufbau eines
  // Dienstes und wird ignoriert statt gelesen.
  //
  // Und nur aus Modulen, die selbst importieren. Ein Blattmodul ohne Importe steht in keinem
  // Zyklus und wird immer vor seinen Nutzern ausgewertet — seine Werte stehen also fest.
  const bindingKind = new Map();
  const bindingSource = new Map();
  const hatImporte = new Map();
  for (const name of modules) {
    const text = fs.readFileSync(path.join(sourceDir, name), "utf8");
    hatImporte.set(name, /^import /m.test(text));
    for (const match of text.matchAll(/^export (?:async )?function ([A-Za-z_$][\w$]*)/gm)) {
      bindingKind.set(match[1], "function");
      bindingSource.set(match[1], name);
    }
    for (const match of text.matchAll(/^export (?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
      bindingKind.set(match[1], "binding");
      bindingSource.set(match[1], name);
    }
    for (const match of text.matchAll(/^export (?:const|let|var)\s*\{([^}]+)\}/gm)) {
      match[1].split(",").map((part) => part.trim().split(":").pop().trim())
        .forEach((ident) => { bindingKind.set(ident, "binding"); bindingSource.set(ident, name); });
    }
  }

  for (const name of modules) {
    const text = fs.readFileSync(path.join(sourceDir, name), "utf8");
    const imported = new Set();
    for (const match of text.matchAll(/^import \{([^}]+)\} from/gm)) {
      match[1].split(",").map((part) => part.trim()).forEach((ident) => imported.add(ident));
    }
    if (!imported.size) continue;

    const body = text.replace(/^import[^\n]*\n/gm, "");
    // Eine Deklaration reicht bis zur nächsten auf oberster Ebene. Zeilenweise zu prüfen war die
    // Lücke, an der der Fehler durchkam: `const { a, b } = Service.create({` steht in einer
    // Zeile, der gelesene Import zwei Zeilen darunter.
    const statements = body.split(/\n(?=(?:export )?(?:const|let|var|function|async function|class)\b)/);

    for (const statement of statements) {
      // Auch Destrukturierungen: `const { a, b } = …` deklariert genauso beim Auswerten.
      const declaration = statement.match(/^(?:export )?(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/);
      if (!declaration) continue;
      const initializer = ohneRueckrufe(declaration[2]).trim();
      // Eine Funktion oder Pfeilfunktion als ganzer Initialisierer verschiebt jeden Zugriff auf
      // den Aufruf und ist damit unbedenklich.
      if (/^(?:async\s+)?function\b/.test(initializer)) continue;
      if (/^(?:async\s*)?\(?[\w{[,\s)]*\)?\s*=>/.test(initializer)) continue;

      for (const ident of imported) {
        if (bindingKind.get(ident) !== "binding") continue;
        if (!hatImporte.get(bindingSource.get(ident))) continue;
        const escaped = ident.replace(/\$/g, "\\$");
        if (new RegExp(`(^|[^.\\w$])${escaped}\\b`).test(initializer)) {
          offenders.push(`${name}: ${declaration[1].replace(/\s+/g, " ")} reads ${ident} at evaluation time`);
          break;
        }
      }
    }
  }

  assert.deepEqual(offenders, [], "move the value into a leaf module, or wrap the access in a function");
});

// Die Prüfung, die der Build nicht macht: Ein Bezeichner, der weder deklariert noch importiert
// ist, wird von esbuild stillschweigend als globale Variable durchgereicht. Im Browser ist er
// dann `undefined` — beim Umbau auf Module fehlten so neun Importe, und die Admin-Oberfläche
// meldete "splitDocument is not defined" erst in den Browser-Tests.
//
// eslint kann das, weil es den Geltungsbereich wirklich analysiert statt nach Mustern zu suchen.
// Ein selbstgeschriebener Regex-Check hatte genau diese neun übersehen.
//
// Der Umbau brachte zwei ältere Fehler dieser Art ans Licht, die unverändert im
// Vorgängerstand standen und dort in denselben ReferenceError liefen. Beide sind inzwischen
// behoben — publishPlan in #96, commitTree beim Reparieren des Einstellungen-Speicherns.
// Die Liste zugelassener Ausnahmen ist damit leer und wieder verschwunden: Es gibt keinen
// Bezeichner mehr, den dieser Test durchlassen darf.

test("every identifier a module uses is either declared or imported", async () => {
  const { ESLint } = require("eslint");
  const browserGlobals = [
    "window", "document", "console", "navigator", "location", "localStorage", "sessionStorage",
    "fetch", "URL", "URLSearchParams", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "requestAnimationFrame", "queueMicrotask", "AbortController", "Intl", "atob", "btoa",
    "TextDecoder", "TextEncoder", "Uint8Array", "Blob", "File", "FileReader", "FormData",
    "Headers", "Request", "Response", "CustomEvent", "Event", "MutationObserver",
    "IntersectionObserver", "DOMParser", "crypto", "performance", "history", "matchMedia",
    "HTMLElement", "Image", "alert", "confirm", "prompt", "structuredClone", "getComputedStyle",
    "ResizeObserver"
  ];
  // Die Bausteine, die der Admin über <script> lädt statt zu importieren. Sie stehen hier
  // namentlich, damit ein Tippfehler in einem davon nicht als "ist halt global" durchgeht.
  const runtimeGlobals = [
    "RWGithubService", "RWEditorRecovery", "RWContentService", "RWMarkdownMedia", "RWIcons",
    "RWEditor", "RWPublishStatus", "RWDraftRepository", "RWMediaService", "RWGpxUpload",
    "RWPreviewRenderer", "RWSourcePages", "RWPublishPlan", "RWAdmonitions",
    "RWMarkdownConventions", "RWSocialConfig", "RWGpxService", "RWSearchText", "markdownit"
  ];

  const eslint = new ESLint({
    cwd: path.join(__dirname, ".."),
    overrideConfigFile: true,
    overrideConfig: {
      files: ["**/*.js"],
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        globals: Object.fromEntries([...browserGlobals, ...runtimeGlobals].map((name) => [name, "readonly"]))
      },
      rules: { "no-undef": "error" }
    }
  });

  const results = await eslint.lintFiles(["blog/admin/admin-src/*.js"]);
  assert.ok(results.length >= 20, "the check must actually have seen the modules");

  const found = results.flatMap((result) =>
    // Ohne Zeilennummer: Die verschiebt sich bei jedem hinzugefügten Import, und die Ausnahme
    // soll den Fehler benennen, nicht seine Position.
    result.messages.map((message) => `${path.basename(result.filePath)} ${message.message}`)
  );

  assert.deepEqual(found.sort(), []);
});

// Die Fehlerklasse, die weder der Build noch ein Unit-Test bemerkt: Ein Bezeichner, der
// nirgends deklariert ist, ist im Browser einfach `undefined` — der Aufruf scheitert erst,
// wenn ein Mensch den Knopf drückt, und dann nur als Text in der Statuszeile.
//
// eslint findet das in einer Sekunde, aber es muss die Datei auch wirklich lesen. Bis zum
// 23.08.2026 tat es das nicht: `npm run lint` übergab das gebaute Bündel zwar ausdrücklich,
// der Regelblock galt aber für `blog/admin/*.js` und traf die Datei zwei Ebenen darunter
// nicht. In der Flat Config heisst "kein passender Block" nicht Fehler, sondern *keine
// Regeln* — grün, ohne gelesen zu haben. So blieb `commitTree` fünf Wochen stehen und das
// Speichern der Social-Konfiguration lief in einen ReferenceError.
//
// Dieser Test hält beides fest: dass die Regel für das Bündel wirklich gilt, und dass sie
// nichts findet.
test("the admin lint gate really covers the built bundle", async () => {
  const { ESLint } = require("eslint");
  const root = path.join(__dirname, "..");
  const bundle = path.join(root, "blog/admin/vendor/app/admin.js");
  const eslint = new ESLint({ cwd: root });

  // Ohne diese Zusicherung wäre der Rest bedeutungslos: eine Datei ohne passenden Block
  // meldet nichts, weil nichts geprüft wird.
  const applied = await eslint.calculateConfigForFile(bundle);
  assert.equal(applied.rules?.["no-undef"]?.[0], 2, "no-undef must apply to the bundle as an error");

  const results = await eslint.lintFiles([bundle]);
  assert.equal(results.length, 1, "the check must actually have seen the bundle");
  // Nur Fehler: Warnungen lassen auch `npm run lint` durch, und tote Bezeichner sind eine
  // andere Aufräumaufgabe als ein Aufruf, der im Browser abstürzt.
  const errors = results[0].messages.filter((message) => message.severity === 2);
  assert.deepEqual(errors.map((message) => `${message.line} ${message.message}`), []);
});

test("no debugging scaffolding survives into the shipped bundle", () => {
  // A probe written onto `window` during troubleshooting once made it all the
  // way into a commit: eslint has no opinion about it, the tests stayed green,
  // and it would have shipped internal state to the page. The admin talks to
  // the outside through named globals it declares on purpose (RWEditor,
  // RWIcons, RWPublishStatus and their kin); anything scratch-shaped is not
  // that.
  const source = adminSource();

  assert.doesNotMatch(source, /window\.__/, "a window.__ global is debugging scaffolding, not an interface");
  assert.doesNotMatch(source, /\bdebugger\b/, "a debugger statement would stop the editor for whoever opens devtools");
  // console.log is the other thing that survives a debugging session. Warnings
  // and errors are how this admin reports real trouble and stay allowed.
  assert.doesNotMatch(source, /console\.log\(/, "console.log is left over from debugging; use showStatus() or console.warn");
});
