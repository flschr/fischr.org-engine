-- Eigene Webanalytics für mysite.example.
--
-- Zwei Ebenen, mit Absicht:
--   hits          — Rohtreffer von Seitenaufrufen. Für Detailfragen und dafür,
--                   eine Bot-Einstufung später rückwirkend korrigieren zu
--                   können.
--
--                   Feed-Abfragen stehen hier bewusst nicht: Ein Feed-Leser
--                   meldet sich stündlich mit derselben Kennung, die Rohzeile
--                   trüge nichts über die Tagesaggregate und feed_readers
--                   hinaus, würde die Tabelle aber um ein Vielfaches schneller
--                   füllen als sämtliche Seitenaufrufe zusammen.
--
--                   Aufbewahrung: 180 Tage. Aufgeräumt wird beim ersten
--                   Zählvorgang eines neuen Tages (functions/_analytics.js,
--                   raeumeAuf) — kein Cron nötig. Die Tagesaggregate bleiben
--                   davon unberührt und für immer.
--
--   daily_*       — Tagesaggregate, langlebig. Das ist das Lesemodell des
--                   Dashboards und die einzige Form, in der importierte
--                   Historie überhaupt vorliegen kann.
--
-- Nichts wird beim Schreiben verworfen. Bots werden eingestuft, nicht gelöscht:
-- eine Fehleinstufung wäre sonst für immer weg, und niemand könnte nachweisen,
-- ob der Filter zu scharf war. Gefiltert wird erst beim Lesen.

CREATE TABLE IF NOT EXISTS hits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,          -- Unix-Sekunden
  day          TEXT    NOT NULL,          -- 'YYYY-MM-DD', Europe/Berlin
  kind         TEXT    NOT NULL,          -- 'page' | 'feed'
  path         TEXT    NOT NULL,
  title        TEXT,
  ref_host     TEXT,                      -- NULL = direkt
  ref_path     TEXT,
  country      TEXT,
  asn          INTEGER,
  as_org       TEXT,
  client       TEXT,                      -- grobe Client-Kennung
  class        TEXT    NOT NULL,          -- 'human' | 'bot_ua' | 'bot_dc' | 'feed' | 'unknown'
  class_reason TEXT,
  visitor      TEXT                       -- Tages-Hash, NULL bei Feeds
);
CREATE INDEX IF NOT EXISTS hits_day ON hits (day, kind, class);

-- Ein Eintrag pro Besucher pro Tag. Macht "eindeutige Besucher" über beliebige
-- Zeiträume exakt, ohne die Rohtreffer jahrelang halten zu müssen.
CREATE TABLE IF NOT EXISTS visitor_days (
  day     TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (day, visitor)
);

-- source trennt die eigene Messung von importierter GoatCounter-Historie.
-- Beide liegen nebeneinander, damit der Bruch beim Umstieg sichtbar bleibt
-- statt sich unbemerkt in eine Jahreskurve zu mischen.
CREATE TABLE IF NOT EXISTS daily_page (
  day      TEXT    NOT NULL,
  path     TEXT    NOT NULL,
  kind     TEXT    NOT NULL,              -- 'page' | 'feed' | 'feedread'
  source   TEXT    NOT NULL,              -- 'live' | 'goatcounter'
  title    TEXT,
  hits     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, kind, source)
);

CREATE TABLE IF NOT EXISTS daily_ref (
  day      TEXT    NOT NULL,
  ref_host TEXT    NOT NULL,              -- '' = direkt
  source   TEXT    NOT NULL,
  hits     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ref_host, source)
);

-- Ein Eintrag pro Besucher pro Tag und Seite. Damit ist "eindeutige Besucher"
-- auch pro Beitrag über beliebige Zeiträume exakt und nicht nur pro Tag.
CREATE TABLE IF NOT EXISTS visitor_page_days (
  day     TEXT NOT NULL,
  path    TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (day, path, visitor)
);

-- Seite mal Quelle. Das ist die Zahl hinter der aufklappbaren Zeile im
-- Dashboard: welche Quelle auf welchen Beitrag geführt hat.
CREATE TABLE IF NOT EXISTS daily_page_ref (
  day      TEXT    NOT NULL,
  path     TEXT    NOT NULL,
  ref_host TEXT    NOT NULL,
  source   TEXT    NOT NULL,
  hits     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, ref_host, source)
);

-- Aufrufe je Land. Cloudflare legt das Land jeder Anfrage bei; ohne dieses
-- Aggregat stünde es nur in den Rohdaten und wäre nach 180 Tagen weg.
--
-- Ohne source-Spalte, anders als die Tabellen darüber: Länder gibt es nur aus
-- eigener Messung, der GoatCounter-Export trägt keine. Eine Spalte, die für
-- immer 'live' enthält, wäre eine Behauptung ohne Fall — die Auswertung müsste
-- sie trotzdem in jeder Abfrage mitschleppen.
--
-- Eine Anfrage ohne erkanntes Land bekommt die leere Zeichenkette statt gar
-- keine Zeile. Sonst ergäbe die Liste weniger als die Zahl, die sie aufschlüsselt,
-- und niemand könnte sehen, dass etwas fehlt.
CREATE TABLE IF NOT EXISTS daily_country (
  day     TEXT    NOT NULL,
  country TEXT    NOT NULL,             -- '' = kein Land ermittelt
  hits    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, country)
);

-- Feed-Leser melden ihre Abonnentenzahl im User-Agent
-- ("Feedly/1.0 (+http://feedly.com/; 42 subscribers)"). Das ist die einzige
-- Zahl, die ein RSS-Feed über seine Reichweite überhaupt hergibt.
CREATE TABLE IF NOT EXISTS feed_readers (
  day         TEXT    NOT NULL,
  reader      TEXT    NOT NULL,
  subscribers INTEGER,
  hits        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, reader)
);

-- Kleinkram: Zeitstempel des Imports und die Tagessalze für den Besucher-Hash.
--
-- Salze werden nach drei Tagen gelöscht. Das ist der Unterschied zwischen
-- "nicht über Tage hinweg wiedererkennbar" und "auch im Nachhinein nicht mehr
-- überprüfbar": Solange das Salz eines Tages existiert, lässt sich zu einer
-- vermuteten IP nachrechnen, ob sie an diesem Tag da war. Ohne Salz nicht mehr.
-- Ein Eintrag pro abrufendem Programm pro Tag. Der Schlüssel entsteht wie der
-- Besucher-Hash aus dem Tagessalz, speichert also keine Adresse und verliert
-- seine Bedeutung mit dem Salz.
--
-- Das ist die Grundlage der Abonnentenschätzung: Dienste wie Feedbin holen den
-- Feed einmal für alle ihre Nutzer und melden ihre Zahl selbst; eine
-- selbstgehostete Installation holt ihn für genau einen Menschen und meldet
-- nichts. Beide zusammen ergeben die Schätzung.
-- Diese Tabelle verfällt nicht, anders als feed_agents daneben, obwohl beide
-- im selben Vorgang entstehen. Der Grund: Sie trägt die Abonnentenhistorie.
-- Ohne ihre Zeilen lässt sich für vergangene Monate nicht mehr sagen, wie
-- viele Abonnenten es gab, und das ist nicht wiederherstellbar. Die Kennungen
-- daneben sind dagegen eine Arbeitsliste zum Zuordnen — was ein halbes Jahr
-- niemand zugeordnet hat, wird es nicht mehr. Wer die Aufbewahrung einmal
-- vereinheitlichen will, muss also hier aufhören.
--
-- country steht hier und nicht in den Rohdaten: Ein Feed-Abruf schreibt keine
-- Rohzeile, und eine Zeile je Abrufer und Tag reicht für die Frage, wo die
-- Abonnenten sitzen. Bei den Diensten ist es das Land ihres Rechenzentrums,
-- nicht das ihrer Nutzer — die Verteilung taugt deshalb als Verhältnis, nicht
-- als Landkarte.
CREATE TABLE IF NOT EXISTS feed_fetchers (
  day         TEXT    NOT NULL,
  fetcher     TEXT    NOT NULL,
  reader      TEXT    NOT NULL,
  subscribers INTEGER,
  country     TEXT,
  PRIMARY KEY (day, fetcher)
);

-- Kennungen, die keinem bekannten Leseprogramm zuzuordnen waren. Gekürzt und
-- einmal je Tag und Kennung, nicht je Abruf. Ohne diese Tabelle bleibt der
-- größte Posten der Leserliste für immer "unbekannt" — und es ließe sich nicht
-- einmal nachsehen, ob dahinter Menschen oder Crawler stecken.
--
-- Adressen werden vor dem Speichern entfernt: Betreiber schreiben aus
-- Höflichkeit ihre Kontaktadresse in die Kennung, und sie wäre der einzige
-- Personenbezug in einem Bestand, der sonst keinen enthält. Aufbewahrung wie
-- bei den Rohdaten, 180 Tage — die Liste ist zum Zuordnen da, nicht zum
-- Aufbewahren.
CREATE TABLE IF NOT EXISTS feed_agents (
  day   TEXT    NOT NULL,
  agent TEXT    NOT NULL,
  hits  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, agent)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
