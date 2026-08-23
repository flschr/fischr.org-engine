#!/usr/bin/env node
// Prüft jede Regel aus _site/_redirects gegen einen laufenden Server.
//
// Warum das existiert: Die Weiterleitungen sind der größte Einzelposten, der bei einem
// Plattformwechsel still kaputtgehen kann. Es sind rund 1.550 Regeln, fast alle aus der
// Bear-Blog-Migration, und niemand merkt es, wenn eine davon aufhört zu funktionieren — sie
// betreffen alte Adressen, die nur noch Suchmaschinen und alte Links ansteuern. Ein grüner
// Build sagt darüber nichts.
//
// Aufruf:  node scripts/check-redirects.js http://127.0.0.1:8787
//
// Bewusst gegen einen *Server* statt gegen die Datei: Was hier interessiert, ist nicht ob die
// Datei richtig aussieht, sondern ob die Plattform sie so auslegt wie die vorherige.

const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("Usage: node scripts/check-redirects.js <base-url>");
  process.exit(1);
}

const redirectsFile = path.join(process.cwd(), "_site/_redirects");
// Platzhalter-Regeln lassen sich nicht direkt abrufen; für sie wird ein Beispiel eingesetzt und
// die erwartete Zieladresse mitgerechnet.
const placeholderSamples = { ":page": "2", "*": "beispiel/pfad.webp" };
const concurrency = Number.parseInt(process.env.REDIRECT_CHECK_CONCURRENCY || "24", 10);

function parseRules(text) {
  return text
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line && !line.startsWith("#"))
    .map(({ line, number }) => {
      const [from, to, status = "301"] = line.split(/\s+/);
      return { from, to, status: Number.parseInt(status, 10), number, dynamic: /[*:]/.test(from) };
    });
}

// Setzt für eine Platzhalter-Regel ein Beispiel ein und leitet daraus die erwartete Zieladresse
// ab — :page wird im Ziel wieder :page, * wird dort zu :splat.
function resolve(rule) {
  if (!rule.dynamic) return { requestPath: rule.from, expected: rule.to };

  let requestPath = rule.from;
  let expected = rule.to;

  for (const [placeholder, sample] of Object.entries(placeholderSamples)) {
    if (!rule.from.includes(placeholder)) continue;
    requestPath = requestPath.split(placeholder).join(sample);
    const target = placeholder === "*" ? ":splat" : placeholder;
    expected = expected.split(target).join(sample);
  }

  return { requestPath, expected };
}

async function checkRule(rule) {
  const { requestPath, expected } = resolve(rule);
  let response;
  try {
    response = await fetch(new URL(requestPath, baseUrl), { redirect: "manual" });
  } catch (error) {
    return { rule, requestPath, problem: `Anfrage fehlgeschlagen: ${error.message}` };
  }

  if (response.status !== rule.status) {
    return { rule, requestPath, problem: `Status ${response.status} statt ${rule.status}` };
  }

  const location = response.headers.get("location");
  if (!location) return { rule, requestPath, problem: "keine Location-Kopfzeile" };

  // Die Plattform darf absolut antworten, wo die Regel relativ formuliert ist — verglichen wird
  // der aufgelöste Zielpfad, nicht die Schreibweise.
  const actual = new URL(location, baseUrl);
  const wanted = new URL(expected, baseUrl);
  if (actual.href !== wanted.href) {
    return { rule, requestPath, problem: `Ziel ${actual.href} statt ${wanted.href}` };
  }

  return null;
}

async function main() {
  if (!fs.existsSync(redirectsFile)) {
    console.error(`${redirectsFile} fehlt — erst bauen.`);
    process.exit(1);
  }

  const rules = parseRules(fs.readFileSync(redirectsFile, "utf8"));
  const failures = [];
  let next = 0;

  async function worker() {
    while (next < rules.length) {
      const rule = rules[next++];
      const failure = await checkRule(rule);
      if (failure) failures.push(failure);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rules.length) }, worker));

  const dynamic = rules.filter((rule) => rule.dynamic).length;
  console.log(`Weiterleitungen geprüft: ${rules.length} (${dynamic} mit Platzhalter) gegen ${baseUrl}`);

  if (failures.length) {
    failures.sort((a, b) => a.rule.number - b.rule.number);
    for (const { rule, requestPath, problem } of failures.slice(0, 25)) {
      console.error(`  _redirects:${rule.number}  ${requestPath} → ${problem}`);
    }
    if (failures.length > 25) console.error(`  … und ${failures.length - 25} weitere`);
    console.error(`${failures.length} von ${rules.length} Weiterleitungen stimmen nicht.`);
    process.exit(1);
  }

  console.log("Alle Weiterleitungen antworten wie aufgeschrieben.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
