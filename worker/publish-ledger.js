// Zugriff auf das Buch der Veröffentlichungen (lib/publish/schema.sql).
//
// Das Schloss steht in der Datenbank, nicht hier: Ein partieller Unique-Index lässt genau eine
// Zeile mit status='laeuft' zu. Dieser Code prüft deshalb nicht vorher nach, ob etwas läuft — er
// schreibt und lässt sich die Kollision sagen. Ein Vorher-Nachsehen hätte ein Fenster zwischen
// Prüfung und Schreiben, und genau darum geht es hier.

// Wie lange eine laufende Zeile das Schloss halten darf.
//
// Der Workflow wartet höchstens 180 Runden à 10 Sekunden, also eine halbe Stunde, und meldet
// danach selbst eine Zeitüberschreitung. Was darüber hinaus als laufend eingetragen bleibt, hat
// den Weg nicht bis zum Ende gefunden — die Instanz ist gestorben, bevor sie aufräumen konnte.
// Fünfundvierzig Minuten lassen dem regulären Weg Luft und geben das Schloss trotzdem zurück,
// ohne dass jemand von Hand eingreifen muss.
const SCHLOSS_VERFAELLT_NACH = 45 * 60;

export const laufendeZustaende = ["laeuft"];
export const abgeschlosseneZustaende = ["fertig", "gescheitert", "veraltet", "zeitueberschreitung"];

export function ledgerAus(db) {
  if (!db) return null;

  // Gibt Schlösser zurück, die niemand mehr halten kann. Eigene Anweisung, nicht Teil des
  // Einfügens: In einer gemeinsamen Transaktion nähme eine scheiternde Einfügung die Freigabe
  // mit zurück, und ein totes Schloss bliebe für immer liegen.
  async function gibVerfalleneSchloesserFrei(jetzt) {
    await db.prepare(
      `UPDATE publishes
          SET status = 'zeitueberschreitung',
              grund = 'Die Veröffentlichung hat sich nie zurückgemeldet.',
              finished_at = ?
        WHERE status = 'laeuft' AND started_at < ?`
    ).bind(jetzt, jetzt - SCHLOSS_VERFAELLT_NACH).run();
  }

  return {
    // Trägt die Veröffentlichung ein und nimmt damit das Schloss. Schlägt fehl, wenn schon eine
    // läuft — das ist der Zweck, nicht ein Störfall.
    async reserviere({ requestId, mainSha, draftSha, changeCount, jetzt }) {
      await gibVerfalleneSchloesserFrei(jetzt);
      try {
        await db.prepare(
          `INSERT INTO publishes (request_id, main_sha, draft_sha, change_count, status, started_at)
           VALUES (?, ?, ?, ?, 'laeuft', ?)`
        ).bind(requestId, mainSha, draftSha, changeCount, jetzt).run();
        return { ok: true };
      } catch (fehler) {
        const kollision = welcheKollision(fehler);
        if (!kollision) throw fehler;

        // Zwei verschiedene Absagen, die vorher gleich aussahen. Verletzt sind sie nie beide
        // sichtbar: SQLite meldet die Schloss-Zusicherung zuerst, also wird sie zuerst gedeutet.
        if (kollision === "schloss") {
          const laufend = await this.laufende();
          // Dieselbe Anfrage noch einmal — ein zweiter Klick, ein wiederholtes Senden nach einem
          // Netzaussetzer. Das ist keine zweite Veröffentlichung, sondern dieselbe.
          if (laufend?.request_id === requestId) return { ok: false, grund: "laeuft-schon", zeile: laufend };
          return { ok: false, grund: "schloss", laufend };
        }

        // Die Kennung gibt es schon, aber nichts läuft: Diese Veröffentlichung ist durch.
        return { ok: false, grund: "abgeschlossen", zeile: await this.nachAnfrage(requestId) };
      }
    },

    async verknuepfeInstanz(requestId, instanceId) {
      await db.prepare("UPDATE publishes SET instance_id = ? WHERE request_id = ?")
        .bind(instanceId, requestId).run();
    },

    async haltLaufFest(requestId, runId, runUrl) {
      await db.prepare("UPDATE publishes SET run_id = ?, run_url = ? WHERE request_id = ?")
        .bind(runId, runUrl || null, requestId).run();
    },

    // Schliesst die Zeile ab und gibt damit das Schloss zurück.
    async schliesseAb(requestId, status, grund, jetzt) {
      await db.prepare("UPDATE publishes SET status = ?, grund = ?, finished_at = ? WHERE request_id = ?")
        .bind(status, grund || null, jetzt, requestId).run();
    },

    async laufende() {
      return db.prepare("SELECT * FROM publishes WHERE status = 'laeuft'").first();
    },

    async nachInstanz(instanceId) {
      return db.prepare("SELECT * FROM publishes WHERE instance_id = ?").bind(instanceId).first();
    },

    async nachAnfrage(requestId) {
      return db.prepare("SELECT * FROM publishes WHERE request_id = ?").bind(requestId).first();
    }
  };
}

// Welche Zusicherung gehalten hat. Der Spaltenname steht in der Meldung — bei D1 wie bei
// SQLite, weil D1 die Meldung von SQLite durchreicht.
function welcheKollision(fehler) {
  const meldung = String(fehler?.message || fehler);
  if (!/UNIQUE constraint failed/i.test(meldung)) return null;
  if (/publishes\.status/.test(meldung)) return "schloss";
  if (/publishes\.request_id/.test(meldung)) return "kennung";
  // Eine Eindeutigkeit, die es hier nicht geben sollte, ist kein Fall zum Raten.
  return null;
}
