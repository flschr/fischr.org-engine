#!/usr/bin/env node
"use strict";

// Übersetzt einen GoatCounter-Site-Export (JSONL) in SQL für die eigene
// Analytics-Datenbank.
//
// Der Export ist die aggregierte Variante: hit_stats liegt stündlich pro Pfad
// und Referrer vor, Sessions und Bot-Kennzeichen fehlen. Damit lassen sich die
// Tagesaggregate vollständig rekonstruieren — "eindeutige Besucher" der
// Vergangenheit dagegen nicht. Das wird hier nicht geraten, sondern als
// visitors = 0 eingetragen. Das Dashboard erkennt am ersten Tag mit eigener
// Messung, ab wann Besucherzahlen belastbar sind.
//
// Aufruf:
//   node scripts/import-goatcounter-export.js <export-verzeichnis> [--out datei.sql]

const fs = require("node:fs");
const path = require("node:path");

const SOURCE = "goatcounter";

// Derselbe Tagesbegriff wie in der eigenen Zählung (functions/_analytics.js,
// berlinDay): Berliner Kalendertag, nicht UTC. Der Export führt seine Stunden
// in UTC; ein Besuch um 00:30 Berliner Zeit steht dort als 22:30 des Vortags
// und liefe sonst einen Tag zu früh in die Datenbank. Beide Reihen liegen in
// derselben Tabelle und müssen deshalb dasselbe unter einem Tag verstehen.
const berlinFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function berlinDay(iso) {
  const zeitpunkt = new Date(iso);
  if (Number.isNaN(zeitpunkt.getTime())) throw new Error(`Unlesbarer Zeitstempel im Export: ${iso}`);
  return berlinFormat.format(zeitpunkt);
}

function readJsonl(directory, name) {
  const file = path.join(directory, name);
  if (!fs.existsSync(file)) throw new Error(`Datei fehlt im Export: ${name}`);
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

// GoatCounter führt Feed-Ereignisse als Pseudopfade ohne führenden Schrägstrich.
// Dabei sind zwei verschiedene Dinge zusammengefasst, die auseinandergehalten
// werden müssen: feed-fetch ist ein echter Abruf des Feeds, feed-read-* ist das
// Lesen eines einzelnen Beitrags darin. Die eigene Zählung erfasst nur Abrufe.
// Würde beides als kind='feed' importiert, zeigte die Kennzahl "Feed-Abrufe"
// vor der Umstellung Artikelaufrufe und danach HTTP-Abrufe — die Zeitreihe
// spränge an der Grenze, ohne dass sich etwas geändert hätte.
//
// Seitenpfade werden auf dieselbe Form gebracht wie in der Live-Zählung
// (functions/_analytics.js, normalizePath): Query und Fragment weg, immer mit
// abschließendem Schrägstrich. Ohne das stünde derselbe Beitrag zweimal in der
// Auswertung — einmal aus der Historie, einmal aus der eigenen Messung.
function classifyPath(value) {
  if (value === "feed-fetch") return { kind: "feed", path: "/feed.xml", event: "fetch" };
  if (value.startsWith("feed-read-")) return { kind: "feedread", path: "/feed.xml", event: "read" };
  return { kind: "page", path: normalizePath(value), event: null };
}

function normalizePath(value) {
  if (!value) return "/";
  let pathname;
  try {
    pathname = new URL(value, "https://mysite.example").pathname;
  } catch {
    return "/";
  }
  if (pathname.length > 1 && !pathname.endsWith("/")) pathname += "/";
  return pathname.slice(0, 512);
}

// Dieselbe Zusammenführung wie in der Live-Zählung (functions/_analytics.js,
// normalizeRefHost): Eine Landes-TLD von Google und das GoatCounter-Label
// "Google" ohne Adresse sind dieselbe Quelle wie "google.com".
const APP_REFERRER_HOSTS = {
  "com.google.android.googlequicksearchbox": "google.com"
};

function normalizeRefHost(host) {
  const value = String(host || "").trim();
  if (!value) return value;
  const lower = value.toLowerCase();
  if (APP_REFERRER_HOSTS[lower]) return APP_REFERRER_HOSTS[lower];
  // Höchstens zwei kurze TLD-Teile (com, de, co.uk, com.br, …), sonst matchte
  // das Muster auch eine fremde Domain wie "google.com.irgendwas-langes.tld".
  if (/^google((\.[a-z]{2,3}){1,2})?$/.test(lower)) return "google.com";
  return value;
}

// Referrer stehen als "host/pfad" oder als Label ("Google") im Export. Für die
// Tagesaggregate zählt der Host; ein leerer Wert heißt Direktzugriff.
function referrerHost(value) {
  if (!value) return "";
  const host = String(value).split("/")[0].replace(/^www\./, "");
  return normalizeRefHost(host);
}

const quote = (value) =>
  value === null || value === undefined ? "NULL" : `'${String(value).replace(/'/g, "''")}'`;

function build(directory) {
  const paths = new Map(readJsonl(directory, "paths.jsonl").map((row) => [row.id, row]));
  const refs = new Map(readJsonl(directory, "refs.jsonl").map((row) => [row.id, row.ref || ""]));
  const hits = readJsonl(directory, "hit_stats.jsonl");

  const pages = new Map();
  const referrers = new Map();
  // Die Paarung Seite x Quelle steckt im Export, weil hit_stats beide IDs pro
  // Stunde führt. Ohne sie ließe sich im Dashboard nicht mehr aufklappen,
  // welche Quelle auf welchen Beitrag geführt hat.
  const pageRefs = new Map();
  let counted = 0;
  let unknownPaths = 0;

  for (const hit of hits) {
    const known = paths.get(hit.path_id);
    if (!known) {
      unknownPaths += 1;
      continue;
    }
    const day = berlinDay(hit.hour);
    const { kind, path: cleanPath } = classifyPath(known.path);
    counted += hit.count;

    const pageKey = `${day} ${cleanPath} ${kind}`;
    const page = pages.get(pageKey) || { day, path: cleanPath, kind, title: known.title || null, hits: 0 };
    page.hits += hit.count;
    pages.set(pageKey, page);

    // Quellen gibt es nur für Seitenaufrufe. Ein Feed-Ereignis hat keine
    // Herkunft; mitgezählt ließe es das Panel "Quellen" auf eine höhere Summe
    // kommen als die Zahl der Aufrufe darüber.
    if (kind !== "page") continue;

    const host = referrerHost(refs.get(hit.ref_id));
    const refKey = `${day} ${host}`;
    const referrer = referrers.get(refKey) || { day, host, hits: 0 };
    referrer.hits += hit.count;
    referrers.set(refKey, referrer);

    {
      const pairKey = `${day} ${cleanPath} ${host}`;
      const pair = pageRefs.get(pairKey) || { day, path: cleanPath, host, hits: 0 };
      pair.hits += hit.count;
      pageRefs.set(pairKey, pair);
    }
  }

  return {
    pages: [...pages.values()],
    referrers: [...referrers.values()],
    pageRefs: [...pageRefs.values()],
    counted,
    unknownPaths
  };
}

// D1 verträgt lange Statements, aber nicht beliebig lange. Mehrzeilige INSERTs
// in Blöcken sind der Kompromiss aus wenigen Roundtrips und Sicherheit.
function chunked(rows, size, render) {
  const out = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(render(rows.slice(index, index + size)));
  }
  return out;
}

function toSql({ pages, referrers, pageRefs }) {
  const statements = [
    `DELETE FROM daily_page WHERE source = ${quote(SOURCE)};`,
    `DELETE FROM daily_ref WHERE source = ${quote(SOURCE)};`,
    `DELETE FROM daily_page_ref WHERE source = ${quote(SOURCE)};`
  ];

  statements.push(...chunked(pages, 200, (rows) =>
    `INSERT INTO daily_page (day, path, kind, source, title, hits) VALUES\n` +
    rows.map((row) =>
      `(${quote(row.day)}, ${quote(row.path)}, ${quote(row.kind)}, ${quote(SOURCE)}, ${quote(row.title)}, ${row.hits})`
    ).join(",\n") +
    `\nON CONFLICT (day, path, kind, source) DO UPDATE SET hits = excluded.hits, title = excluded.title;`
  ));

  statements.push(...chunked(referrers, 200, (rows) =>
    `INSERT INTO daily_ref (day, ref_host, source, hits) VALUES\n` +
    rows.map((row) => `(${quote(row.day)}, ${quote(row.host)}, ${quote(SOURCE)}, ${row.hits})`).join(",\n") +
    `\nON CONFLICT (day, ref_host, source) DO UPDATE SET hits = excluded.hits;`
  ));

  statements.push(...chunked(pageRefs, 200, (rows) =>
    `INSERT INTO daily_page_ref (day, path, ref_host, source, hits) VALUES\n` +
    rows.map((row) => `(${quote(row.day)}, ${quote(row.path)}, ${quote(row.host)}, ${quote(SOURCE)}, ${row.hits})`).join(",\n") +
    `\nON CONFLICT (day, path, ref_host, source) DO UPDATE SET hits = excluded.hits;`
  ));

  const stamp = new Date().toISOString();
  statements.push(
    // Nur der Zeitstempel. Ein Flag "diese Historie kennt keine Besucher" stand
    // hier einmal, wurde aber von niemandem gelesen: Das Dashboard leitet den
    // Beginn der Besucherzählung aus MIN(day) der eigenen Messung ab. Ein
    // Eintrag ohne Leser suggeriert eine Steuerung, die es nicht gibt.
    `INSERT INTO meta (key, value) VALUES ('goatcounter_import_at', ${quote(stamp)}) ` +
    `ON CONFLICT (key) DO UPDATE SET value = excluded.value;`,
    `DELETE FROM meta WHERE key = 'goatcounter_has_visitors';`
  );

  return statements.join("\n\n");
}

function main() {
  const [directory, ...rest] = process.argv.slice(2);
  if (!directory) {
    console.error("Aufruf: node scripts/import-goatcounter-export.js <export-verzeichnis> [--out datei.sql]");
    process.exit(1);
  }
  const outIndex = rest.indexOf("--out");
  const outFile = outIndex === -1 ? null : rest[outIndex + 1];

  const data = build(directory);
  const sql = toSql(data);

  const days = new Set(data.pages.map((row) => row.day));
  const sorted = [...days].sort();
  const feedHits = data.pages.filter((row) => row.kind === "feed").reduce((sum, row) => sum + row.hits, 0);
  const feedReads = data.pages.filter((row) => row.kind === "feedread").reduce((sum, row) => sum + row.hits, 0);

  console.error(`Treffer im Export      ${data.counted}`);
  console.error(`  davon Feed-Abrufe    ${feedHits}`);
  console.error(`  davon Feed-Lesen     ${feedReads}`);
  console.error(`Tage mit Daten         ${days.size}  (${sorted[0]} .. ${sorted.at(-1)})`);
  console.error(`Zeilen daily_page      ${data.pages.length}`);
  console.error(`Zeilen daily_ref       ${data.referrers.length}`);
  console.error(`Zeilen daily_page_ref  ${data.pageRefs.length}`);
  if (data.unknownPaths) console.error(`Übersprungen (Pfad-ID unbekannt): ${data.unknownPaths}`);

  if (outFile) {
    fs.writeFileSync(outFile, `${sql}\n`);
    console.error(`SQL geschrieben        ${outFile}`);
  } else {
    process.stdout.write(`${sql}\n`);
  }
}

if (require.main === module) main();

module.exports = { build, toSql, classifyPath, referrerHost, normalizeRefHost, APP_REFERRER_HOSTS, normalizePath, berlinDay };
