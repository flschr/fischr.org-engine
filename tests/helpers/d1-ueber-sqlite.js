// Ein D1-Bindungsnachbau über node:sqlite, damit die Abfragen des Ledgers als echtes SQL laufen.
//
// Ein handgeschriebener Stub prüfte nur, ob die richtigen Zeichenketten weitergereicht werden.
// Das Schloss ist aber kein Code, sondern ein partieller Unique-Index — und ob der greift,
// beantwortet ausschliesslich SQLite.

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function d1UeberSqlite() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "lib/publish/schema.sql"), "utf8"));

  function anweisung(sql) {
    let werte = [];
    return {
      bind(...neue) { werte = neue; return this; },
      // D1 wirft bei einer verletzten Zusicherung; node:sqlite tut dasselbe, nur mit eigenem
      // Wortlaut. Beide enthalten "UNIQUE constraint failed", worauf der Ledger prüft.
      async run() { return { success: true, meta: db.prepare(sql).run(...werte) }; },
      async first() { return db.prepare(sql).get(...werte) ?? null; },
      async all() { return { results: db.prepare(sql).all(...werte) }; }
    };
  }

  return { binding: { prepare: anweisung }, db };
}

module.exports = d1UeberSqlite;
