// Liest die eigenen Zahlen für das Admin-Dashboard.
//
// Die einzige Quelle des Dashboards, seit die frühere, fremde Zählung
// abgeschaltet ist. Alles kommt aus der eigenen D1-Datenbank.
//
// Import und eigene Messung gelten dabei als eine Quelle. Die Antwort trennt sie
// nicht, und das Dashboard zeigt nirgends, woher eine Zahl stammt — die
// importierte Historie ist einfach die Vorgeschichte der eigenen Reihe. Intern
// wird ein Tag trotzdem nur aus einer Quelle gelesen, sonst zählten die Tage des
// damaligen Parallelbetriebs doppelt.

import { berlinDay, classifyFeed, feedReader } from "../../_analytics.js";
import { jsonResponse, readSession } from "../../_admin-auth.js";
import { readStatsConfig } from "../../_admin-settings.js";

const LIMIT = 25;

// Ein Tag, eine Quelle.
//
// Aus den Tagen des Parallelbetriebs trägt derselbe Tag sowohl importierte als
// auch selbst gemessene Zeilen. Ohne diese Bedingung summierten die Abfragen
// beides auf und zeigten für genau diese Tage ungefähr doppelte Zahlen.
//
// Die eigene Messung hat Vorrang: Ein Tag, an dem selbst gezählt wurde, wird
// ausschließlich aus 'live' gelesen. Die Prüfung läuft pro Tag und nicht über
// einen einzelnen Stichtag, damit auch eine Lücke im Parallelbetrieb sauber
// bleibt.
//
// Entscheidend ist dabei die Art: Ein Feed-Abruf sagt nichts darüber aus, ob an
// diesem Tag auch Seiten selbst gezählt wurden. Ohne diese Unterscheidung
// genügte ein einziger live gezählter Feed-Abruf, um sämtliche importierten
// Seitenaufrufe desselben Tages verschwinden zu lassen — und Feed-Abrufe kommen
// stündlich, Seitenaufrufe an ruhigen Tagen gar nicht.
//
// Für daily_ref und daily_page_ref zählt 'page': Beide Tabellen führen nur
// Seitenaufrufe.
export const eineQuelle = (kind) =>
  `AND (source = 'live' OR day NOT IN (
     SELECT day FROM daily_page WHERE source = 'live' AND kind = '${kind}' GROUP BY day
   ))`;

// Abonnenten je Leseprogramm. Steht als Konstante hier, damit der Test dieselbe
// Abfrage prüft, die das Dashboard stellt — die Regel darin ist der Grund, dass
// die Liste die Zahl über ihr ergibt, und eine Kopie im Test hielte davon nichts.
export const ABOS_JE_LESER = `
  WITH spitzentag AS (
    SELECT day FROM feed_fetchers
    WHERE day BETWEEN ?1 AND ?2 AND subscribers IS NULL
    GROUP BY day ORDER BY COUNT(*) DESC LIMIT 1
  ),
  eigen AS (
    SELECT reader, COUNT(*) AS abos FROM feed_fetchers
    WHERE subscribers IS NULL AND day = (SELECT day FROM spitzentag)
    GROUP BY reader
  ),
  gemeldet AS (
    SELECT reader, MAX(subscribers) AS abos FROM feed_fetchers
    WHERE day BETWEEN ?1 AND ?2 AND subscribers IS NOT NULL
    GROUP BY reader
  ),
  leser AS (SELECT reader FROM eigen UNION SELECT reader FROM gemeldet)
  SELECT l.reader, COALESCE(g.abos, 0) AS gemeldet, COALESCE(e.abos, 0) AS eigen
  FROM leser l
  LEFT JOIN gemeldet g ON g.reader = l.reader
  LEFT JOIN eigen e ON e.reader = l.reader`;

// Welche Beiträge im Leseprogramm angezeigt wurden. Als Konstante hier, damit
// der Test dieselbe Abfrage prüft, die das Dashboard stellt.
//
// Der Sammelpfad '/feed.xml' bleibt draußen: Er ist kein Beitrag, sondern die
// beim Import zusammengefasste Historie der früheren Zählung. Solange über der
// Liste eine Gesamtzahl stand, musste er als eigene Zeile mit hinein, damit die
// Liste diese Zahl aufging. Die Zahl gibt es nicht mehr, und ohne sie bliebe
// eine Zeile stehen, die niemandem etwas sagt — und die nebenbei einen Platz
// der Liste belegte, weil sie die größte von allen ist.
export const BEITRAEGE_IM_READER = `
  SELECT path, MAX(title) AS title, SUM(hits) AS hits FROM daily_page
  WHERE kind = 'feedread' AND path <> '/feed.xml'
    AND day BETWEEN ?1 AND ?2 ${eineQuelle("feedread")}
  GROUP BY path ORDER BY hits DESC LIMIT ${LIMIT}`;

export async function onRequest(context) {
  const { request, env } = context;

  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: "unauthorized" }, { status: 401 });
  if (!env.ANALYTICS) return jsonResponse({ error: "Die Analytics-Datenbank ist nicht angebunden." }, { status: 503 });

  // Der Schalter aus den Einstellungen. Ohne diese Prüfung würde das
  // Abschalten der Statistik nur den Tab im Browser ausblenden, während der
  // Endpunkt weiter Zahlen herausgibt — der Schalter verspräche mehr, als er
  // hält.
  const config = await readStatsConfig(env, session.token);
  if (config.enabled === false) {
    return jsonResponse({ error: "Die Statistik ist in den Einstellungen abgeschaltet." }, { status: 403 });
  }

  const url = new URL(request.url);
  const start = toDay(url.searchParams.get("start"));
  const end = toDay(url.searchParams.get("end"));
  if (!start || !end) return jsonResponse({ error: "Zeitraum fehlt oder ist ungültig." }, { status: 400 });

  const db = env.ANALYTICS;
  const all = async (sql, ...params) => (await db.prepare(sql).bind(...params).all()).results || [];
  const one = async (sql, ...params) => await db.prepare(sql).bind(...params).first();

  // Aufklappbare Zeile im Dashboard: Welche Quellen führten auf diese Seite,
  // und wie viele Menschen waren es?
  //
  // Die Besucherzahl steht hier und nicht in der Hauptantwort. Dort wurde sie
  // für jede Seite mitgeliefert und von der Darstellung nie gelesen — eine
  // Abfrage bei jedem Öffnen des Dashboards für eine Zahl, die niemand sah.
  // Beim Aufklappen kostet sie eine Abfrage, und dann will jemand sie wissen.
  const drill = url.searchParams.get("path");
  if (drill) {
    const [rows, besucher] = await Promise.all([
      all(
        `SELECT ref_host, SUM(hits) AS hits FROM daily_page_ref
         WHERE path = ?1 AND day BETWEEN ?2 AND ?3 ${eineQuelle("page")}
         GROUP BY ref_host ORDER BY hits DESC LIMIT ${LIMIT}`,
        drill, start, end
      ),
      one(
        `SELECT COUNT(DISTINCT visitor) AS besucher FROM visitor_page_days
         WHERE path = ?1 AND day BETWEEN ?2 AND ?3`,
        drill, start, end
      )
    ]);
    return jsonResponse({
      rows: rows.map((row) => ({ name: row.ref_host || "(direkt)", count: Number(row.hits) || 0 })),
      visitors: Number(besucher?.besucher) || 0
    });
  }

  // Die Gegenrichtung: Welche Seiten hat diese Quelle gebracht?
  //
  // Dieselbe Tabelle, andere Achse — daily_page_ref trägt beide Richtungen,
  // eine eigene Tabelle braucht es dafür nicht. Die leere Quelle ist ein
  // gültiger Schlüssel und keine fehlende Angabe: Sie steht für Direktzugriffe.
  // Deshalb has() statt get(), sonst fiele ausgerechnet die größte Zeile der
  // Quellenliste durch.
  //
  // Eine Besucherzahl gibt es hier nicht. Besucher werden je Tag und Seite
  // festgehalten, nicht je Quelle; eine Zahl an dieser Stelle müsste erfunden
  // oder eine dritte Tabelle geführt werden.
  if (url.searchParams.has("ref")) {
    const host = url.searchParams.get("ref");
    const rows = await all(
      `SELECT path, SUM(hits) AS hits FROM daily_page_ref
       WHERE ref_host = ?1 AND day BETWEEN ?2 AND ?3 ${eineQuelle("page")}
       GROUP BY path ORDER BY hits DESC LIMIT ${LIMIT}`,
      host, start, end
    );
    return jsonResponse({
      rows: rows.map((row) => ({ name: row.path, count: Number(row.hits) || 0 }))
    });
  }

  // Die Kennungen hinter "unbekannt" in der Leserliste.
  //
  // Sie hingen vorher als eigene Liste am Ende der Ansicht, ohne sichtbaren
  // Zusammenhang zu der Zeile, die sie auflösen. Jetzt kommen sie beim
  // Aufklappen dieser Zeile — und damit auch erst dann, statt bei jedem Laden
  // des Dashboards mitgeliefert zu werden.
  //
  // Eine Kennung bleibt in feed_agents stehen, auch nachdem sie zugeordnet
  // wurde: Die Zeilen von gestern wissen nichts vom Muster von heute. Ohne die
  // Prüfung beim Lesen führte die Arbeitsliste dauerhaft Namen, die längst
  // erkannt sind, und jemand ordnet sie ein zweites Mal zu.
  const reader = url.searchParams.get("reader");
  if (reader) {
    // Nur "unbekannt" hat eine Auflösung. Ein erkanntes Leseprogramm ist bereits
    // das Ergebnis der Zuordnung; darunter stünde dieselbe Zeile noch einmal.
    if (reader !== "unbekannt") return jsonResponse({ rows: [] });
    const rows = await all(
      `SELECT agent, SUM(hits) AS hits FROM feed_agents
       WHERE day BETWEEN ?1 AND ?2 GROUP BY agent ORDER BY hits DESC LIMIT 50`,
      start, end
    );
    return jsonResponse({
      rows: rows
        .filter((row) => feedReader(row.agent).reader === "unbekannt" && classifyFeed(row.agent).kind !== "feedbot")
        .slice(0, LIMIT)
        .map((row) => ({ name: row.agent, count: Number(row.hits) || 0 }))
    });
  }

  const [series, totals, visitors, besucherAb, pages, refs, countries, feed, feedSeries, readers, abosJeLeser, feedBots, abos, feedPages, feedCountries] = await Promise.all([
    all(
      `SELECT day, SUM(hits) AS hits FROM daily_page
       WHERE kind = 'page' AND day BETWEEN ?1 AND ?2 ${eineQuelle("page")}
       GROUP BY day ORDER BY day`,
      start, end
    ),
    one(
      `SELECT COALESCE(SUM(hits), 0) AS hits FROM daily_page
       WHERE kind = 'page' AND day BETWEEN ?1 AND ?2 ${eineQuelle("page")}`,
      start, end
    ),
    // Über visitor_days, nicht als Summe der Tageswerte: Wer an drei Tagen
    // liest, ist ein Besucher, nicht drei.
    one(`SELECT COUNT(DISTINCT visitor) AS besucher FROM visitor_days WHERE day BETWEEN ?1 AND ?2`, start, end),
    // Der erste Tag, an dem überhaupt Besucher gezählt wurden. Ohne ihn behauptet
    // die Kennzahl für jeden längeren Zeitraum eine Zahl, die nur die Tage seit
    // der Umstellung umfasst — neben Aufrufen, die weit davor beginnen.
    one("SELECT MIN(day) AS tag FROM visitor_days"),
    all(
      `SELECT path, MAX(title) AS title, SUM(hits) AS hits FROM daily_page
       WHERE kind = 'page' AND day BETWEEN ?1 AND ?2 ${eineQuelle("page")}
       GROUP BY path ORDER BY hits DESC LIMIT ${LIMIT}`,
      start, end
    ),
    all(
      `SELECT ref_host, SUM(hits) AS hits FROM daily_ref
       WHERE day BETWEEN ?1 AND ?2 ${eineQuelle("page")}
       GROUP BY ref_host ORDER BY hits DESC LIMIT ${LIMIT}`,
      start, end
    ),
    // Woher gelesen wird. Aufrufe je Land, dieselbe Einheit wie die Listen
    // daneben — und anders als beim Feed keine Schätzung über Personen.
    //
    // Ohne eineQuelle-Regel: Die Tabelle kennt nur eigene Messung, der Import
    // trägt keine Länder. Für Zeiträume, die weiter zurückreichen, ergibt die
    // Liste deshalb weniger als die Aufrufe darüber; das Dashboard sagt das an
    // der Liste, statt hier eine Vollständigkeit zu behaupten, die es nicht gibt.
    all(
      `SELECT country, SUM(hits) AS hits FROM daily_country
       WHERE day BETWEEN ?1 AND ?2
       GROUP BY country ORDER BY hits DESC LIMIT ${LIMIT}`,
      start, end
    ),
    one(
      `SELECT COALESCE(SUM(hits), 0) AS hits FROM daily_page
       WHERE kind = 'feed' AND day BETWEEN ?1 AND ?2 ${eineQuelle("feed")}`,
      start, end
    ),
    // Derselbe Verlauf wie für die Seitenaufrufe, nur für den Feed — und
    // getrennt geführt, weil er etwas anderes zählt: Abrufe durch Programme,
    // nicht Aufrufe durch Menschen. Eine gemeinsame Kurve läge um den Faktor
    // zehn auseinander und behauptete damit einen Vergleich, den es nicht gibt.
    all(
      `SELECT day, SUM(hits) AS hits FROM daily_page
       WHERE kind = 'feed' AND day BETWEEN ?1 AND ?2 ${eineQuelle("feed")}
       GROUP BY day ORDER BY day`,
      start, end
    ),
    all(
      `SELECT reader, MAX(subscribers) AS subscribers, SUM(hits) AS hits FROM feed_readers
       WHERE day BETWEEN ?1 AND ?2 GROUP BY reader ORDER BY hits DESC LIMIT ${LIMIT}`,
      start, end
    ),
    // Abonnenten je Leseprogramm — dieselbe Schätzung wie die Zahl über der
    // Liste, nur aufgeteilt. Sie ist es, wonach die Liste sortiert wird: Wie
    // oft ein Programm abruft, sagt nichts über seine Reichweite; ein
    // selbstgehosteter Leser fragt stündlich für einen Menschen, ein Dienst
    // einmal für hundert.
    //
    // Beide Hälften rechnen wie die Kopfzahl, sonst ergäbe die Liste nicht die
    // Zahl, die sie aufschlüsselt: gemeldete Zahlen je Dienst als höchster Wert
    // des Zeitraums, selbstgehostete Installationen gezählt am stärksten Tag.
    // Je Programm den höchsten Tageswert zu nehmen, läge höher als die Kopfzahl
    // — Programme haben ihre stärksten Tage nicht gemeinsam.
    all(
      ABOS_JE_LESER,
      start, end
    ),
    // Crawler getrennt, damit die Feed-Zahl Reichweite bedeutet und nicht
    // Googlebot enthält.
    one(
      `SELECT COALESCE(SUM(hits), 0) AS hits FROM daily_page
       WHERE kind = 'feedbot' AND day BETWEEN ?1 AND ?2 ${eineQuelle("feedbot")}`,
      start, end
    ),
    // Abonnentenschätzung, zwei Teile:
    //
    // Dienste holen den Feed einmal für alle ihre Nutzer und melden deren Zahl
    // selbst — für die zählt die gemeldete Zahl, nicht die Zahl ihrer Abrufer.
    // Selbstgehostete Installationen melden nichts und stehen für je einen
    // Menschen — für die zählt die Zahl unterscheidbarer Abrufer.
    //
    // Über mehrere Tage wird jeweils der höchste Tageswert genommen, nicht die
    // Summe: Derselbe Abonnent taucht an jedem Tag erneut auf.
    one(
      `SELECT
         (SELECT COALESCE(SUM(gemeldet), 0) FROM (
            SELECT MAX(subscribers) AS gemeldet FROM feed_fetchers
            WHERE day BETWEEN ?1 AND ?2 AND subscribers IS NOT NULL
            GROUP BY reader)) AS gemeldet,
         (SELECT COALESCE(MAX(anzahl), 0) FROM (
            SELECT COUNT(*) AS anzahl FROM feed_fetchers
            WHERE day BETWEEN ?1 AND ?2 AND subscribers IS NULL
            GROUP BY day)) AS installationen`,
      start, end
    ),
    // Welche Beiträge im Reader angezeigt wurden.
    all(BEITRAEGE_IM_READER, start, end),
    // Woher abgerufen wird — mit derselben Rechnung wie die Abonnentenzahl:
    // der höchste Tageswert je Land, nicht die Summe über den Zeitraum.
    //
    // Summiert stünde eine Liste über Abruftagen neben einer Zahl über
    // Abonnenten, beide aus derselben Tabelle und um ein Vielfaches
    // auseinander. Wer sie in Beziehung setzt, und dazu stehen sie
    // nebeneinander, müsste eine von beiden für falsch halten.
    //
    // Bei den Diensten ist es das Land ihres Rechenzentrums, nicht das ihrer
    // Nutzer; das Dashboard beschriftet es entsprechend.
    all(
      `SELECT country, MAX(n) AS n FROM (
         SELECT day, country, COUNT(*) AS n FROM feed_fetchers
         WHERE country IS NOT NULL AND day BETWEEN ?1 AND ?2
         GROUP BY day, country
       ) GROUP BY country ORDER BY n DESC LIMIT ${LIMIT}`,
      start, end
    ),
  ]);

  return jsonResponse({
    range: { start, end },
    total: {
      hits: Number(totals?.hits) || 0,
      visitors: Number(visitors?.besucher) || 0,
      feed: Number(feed?.hits) || 0,
      feedBots: Number(feedBots?.hits) || 0,
      // Getrennt geliefert, damit das Dashboard beide Teile benennen kann
      // statt nur eine Summe zu behaupten.
      abosGemeldet: Number(abos?.gemeldet) || 0,
      abosInstallationen: Number(abos?.installationen) || 0
    },
    series: series.map((row) => ({ day: row.day, hits: Number(row.hits) || 0 })),
    feedSeries: feedSeries.map((row) => ({ day: row.day, hits: Number(row.hits) || 0 })),
    pages: pages.map((row) => ({
      path: row.path,
      title: row.title || null,
      hits: Number(row.hits) || 0
    })),
    refs: refs.map((row) => ({
      name: row.ref_host || "(direkt)",
      // Der rohe Host neben dem Anzeigenamen: Er ist der Schlüssel, mit dem die
      // Zeile aufgeklappt wird, und '' ist dabei ein Wert und keine Lücke.
      host: row.ref_host || "",
      hits: Number(row.hits) || 0
    })),
    countries: countries.map((row) => ({ country: row.country || "", hits: Number(row.hits) || 0 })),
    feedCountries: feedCountries.map((row) => ({ country: row.country, hits: Number(row.n) || 0 })),
    feedPages: feedPages.map((row) => ({ path: row.path, title: row.title || null, hits: Number(row.hits) || 0 })),
    // Nach Abonnenten sortiert, nicht nach Abrufen. Bei gleicher Schätzung
    // entscheiden die Abrufe, damit die Reihenfolge stabil bleibt.
    feedReaders: readers
      .map((row) => {
        const geschaetzt = abosJeLeser.find((eintrag) => eintrag.reader === row.reader);
        return {
          reader: row.reader,
          subscribers: row.subscribers === null ? null : Number(row.subscribers),
          abos: (Number(geschaetzt?.gemeldet) || 0) + (Number(geschaetzt?.eigen) || 0),
          hits: Number(row.hits) || 0
        };
      })
      .sort((a, b) => b.abos - a.abos || b.hits - a.hits),
    // Ab wann es Besucher gibt. Das ist keine Herkunftsangabe zu einer Zahl,
    // sondern der Anfang einer Messung: Aufrufe reichen weiter zurück als
    // Besucher, und ohne diesen Tag stünde neben den Aufrufen eines Jahres die
    // Besucherzahl weniger Tage.
    besucherAb: besucherAb?.tag || null
  });
}

// Der Client schickt ISO-Zeitstempel, die Datenbank rechnet in Berliner
// Kalendertagen. Ein Zeitstempel um 23:30 UTC gehört im Sommer schon zum
// nächsten Tag — deshalb wird hier umgerechnet und nicht abgeschnitten.
function toDay(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return berlinDay(parsed);
}
