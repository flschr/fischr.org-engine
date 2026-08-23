-- Das Buch der Veröffentlichungen.
--
-- Eine Zeile pro Veröffentlichung, von ihrem Beginn bis zu ihrem Ausgang. Vorher gab es diesen
-- Ort nicht: Was gerade läuft, stand verteilt in einer Workflow-Instanz, einem Actions-Lauf und
-- einem Titel, über den der Browser die beiden zusammensuchte.
--
-- Zwei Dinge werden dadurch möglich, die vorher nicht gingen:
--
--   Das Schloss. Zwei gleichzeitig gestartete Veröffentlichungen stiessen bisher beide einen Bau
--   an. Es ist unten eine Zusicherung der Datenbank, kein Vorher-Nachsehen im Code: Ein
--   partieller Unique-Index lässt genau eine Zeile mit status='laeuft' zu. Damit gibt es kein
--   Fenster zwischen Prüfen und Schreiben, in das eine zweite Anfrage passen könnte.
--
--   Der Lauf ohne Titelabgleich. Der Workflow schreibt run_id hierher, sobald er den Lauf
--   gefunden hat. Der Admin liest sie und fragt den Lauf direkt ab, statt dreissig Läufe zu
--   listen und deren Titel mit einer selbst gebauten Zeichenkette zu vergleichen.
--
-- Personenbezug: keiner. Commit-Kennungen, Zeitstempel, Lauf-Nummern.

CREATE TABLE IF NOT EXISTS publishes (
  request_id   TEXT    PRIMARY KEY,      -- vom Admin vergeben, auch der Titel des Actions-Laufs
  instance_id  TEXT    UNIQUE,           -- NULL bis die Workflow-Instanz existiert
  main_sha     TEXT    NOT NULL,         -- der freigegebene Stand
  draft_sha    TEXT    NOT NULL,
  change_count INTEGER NOT NULL,
  status       TEXT    NOT NULL,         -- laeuft | fertig | gescheitert | veraltet | zeitueberschreitung
  grund        TEXT,                     -- warum, wenn der Ausgang das erklären muss
  run_id       INTEGER,                  -- NULL bis der Workflow den Actions-Lauf gefunden hat
  run_url      TEXT,
  started_at   INTEGER NOT NULL,         -- Unix-Sekunden
  finished_at  INTEGER
);

-- Das Schloss. Partiell, damit abgeschlossene Zeilen sich nicht gegenseitig ausschliessen:
-- SQLite prüft die Eindeutigkeit nur für Zeilen, die der WHERE-Klausel genügen.
CREATE UNIQUE INDEX IF NOT EXISTS eine_laufende_veroeffentlichung
  ON publishes (status) WHERE status = 'laeuft';

-- Für die Wiederaufnahme nach einem Neuladen und für die Historie.
CREATE INDEX IF NOT EXISTS publishes_nach_zeit ON publishes (started_at DESC);
