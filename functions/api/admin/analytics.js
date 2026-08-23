// Liest die eigenen Zahlen für das Admin-Dashboard.
//
// Gegenstück zu stats.js, das dieselben Panels aus GoatCounter holt. Beide
// existieren nebeneinander, solange parallel gezählt wird.
//
// Zwei Dinge, die diese Zahlen von den bisherigen unterscheiden und die das
// Dashboard deshalb sichtbar machen muss:
//
//   - Historie vor der Umstellung stammt aus dem GoatCounter-Import und kennt
//     nur Aufrufe, keine Besucher. Erfundene Besucherkurven gibt es hier nicht;
//     stattdessen sagt das Feld visitorsFrom, ab wann die Zahl belastbar ist.
//   - Aufrufe werden als eine Zahl geliefert, egal ob importiert oder selbst
//     gemessen. Die Herkunft auseinanderzuhalten war ausdrücklich nicht
//     gewünscht: Wer nur GoatCounter sehen will, geht zu GoatCounter. Ein Tag
//     wird trotzdem nur aus einer Quelle gelesen, sonst zählte der
//     Parallelbetrieb doppelt.

import { berlinDay, classifyFeed, feedReader } from "../../_analytics.js";
import { jsonResponse, readSession } from "../../_admin-auth.js";
import { readStatsConfig } from "../../_admin-settings.js";

const LIMIT = 25;

// Ein Tag, eine Quelle.
//
// Solange beide Zählungen parallel laufen, kann derselbe Tag sowohl importierte
// als auch selbst gemessene Zeilen tragen — spätestens, wenn ein frischer
// GoatCounter-Export nachgezogen wird. Ohne diese Bedingung summierten die
// Abfragen beides auf und zeigten für genau die Tage, an denen verglichen
// werden soll, ungefähr doppelte Zahlen.
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

export async function onRequest(context) {
  const { request, env } = context;

  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: "unauthorized" }, { status: 401 });
  if (!env.ANALYTICS) return jsonResponse({ error: "Die Analytics-Datenbank ist nicht angebunden." }, { status: 503 });

  // Derselbe Schalter wie beim GoatCounter-Proxy. Ohne diese Prüfung würde das
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

  const [series, totals, visitors, pages, refs, feed, feedReads, readers, feedBots, abos, feedPages, feedCountries, agents, since] = await Promise.all([
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
    one(
      `SELECT COALESCE(SUM(hits), 0) AS hits FROM daily_page
       WHERE kind = 'feed' AND day BETWEEN ?1 AND ?2 ${eineQuelle("feed")}`,
      start, end
    ),
    // Getrennt geführt: GoatCounter zählte das Lesen einzelner Beiträge im
    // Feed, die eigene Zählung zählt Abrufe des Feeds. Zusammengeworfen ergäbe
    // das eine Zeitreihe, die an der Umstellung springt.
    one(
      `SELECT COALESCE(SUM(hits), 0) AS hits FROM daily_page
       WHERE kind = 'feedread' AND day BETWEEN ?1 AND ?2 ${eineQuelle("feedread")}`,
      start, end
    ),
    all(
      `SELECT reader, MAX(subscribers) AS subscribers, SUM(hits) AS hits FROM feed_readers
       WHERE day BETWEEN ?1 AND ?2 GROUP BY reader ORDER BY hits DESC LIMIT ${LIMIT}`,
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
    //
    // Der Sammelpfad '/feed.xml' bleibt bewusst drin, obwohl er kein Beitrag
    // ist: Darunter liegt die importierte Historie, die beim Import
    // zusammengefasst wurde. Ihn auszusortieren hieße, dass die Liste weniger
    // ergibt als die Zahl darüber — und die Liste ist gerade dafür da, diese
    // Zahl aufzulösen. Das Dashboard beschriftet die Zeile entsprechend.
    all(
      `SELECT path, MAX(title) AS title, SUM(hits) AS hits FROM daily_page
       WHERE kind = 'feedread' AND day BETWEEN ?1 AND ?2 ${eineQuelle("feedread")}
       GROUP BY path ORDER BY hits DESC LIMIT ${LIMIT}`,
      start, end
    ),
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
    // Die Kennungen hinter "unbekannt" — der größte Posten der Leserliste.
    // Mehr als die Anzeige braucht, weil unten aussortiert wird, was das Muster
    // inzwischen kennt.
    all(
      `SELECT agent, SUM(hits) AS hits FROM feed_agents
       WHERE day BETWEEN ?1 AND ?2 GROUP BY agent ORDER BY hits DESC LIMIT 50`,
      start, end
    ),
    one(`SELECT MIN(day) AS tag FROM daily_page WHERE source = 'live'`)
  ]);

  return jsonResponse({
    range: { start, end },
    total: {
      hits: Number(totals?.hits) || 0,
      visitors: Number(visitors?.besucher) || 0,
      feed: Number(feed?.hits) || 0,
      feedReads: Number(feedReads?.hits) || 0,
      feedBots: Number(feedBots?.hits) || 0,
      // Getrennt geliefert, damit das Dashboard beide Teile benennen kann
      // statt nur eine Summe zu behaupten.
      abosGemeldet: Number(abos?.gemeldet) || 0,
      abosInstallationen: Number(abos?.installationen) || 0
    },
    series: series.map((row) => ({ day: row.day, hits: Number(row.hits) || 0 })),
    pages: pages.map((row) => ({
      path: row.path,
      title: row.title || null,
      hits: Number(row.hits) || 0
    })),
    refs: refs.map((row) => ({
      name: row.ref_host || "(direkt)",
      hits: Number(row.hits) || 0
    })),
    feedCountries: feedCountries.map((row) => ({ country: row.country, hits: Number(row.n) || 0 })),
    feedPages: feedPages.map((row) => ({ path: row.path, title: row.title || null, hits: Number(row.hits) || 0 })),
    // Eine Kennung bleibt in feed_agents stehen, auch nachdem sie zugeordnet
    // wurde — die Zeilen von gestern wissen nichts vom Muster von heute. Ohne
    // diese Prüfung führt die Arbeitsliste dauerhaft Namen, die längst erkannt
    // sind, und jemand ordnet sie ein zweites Mal zu. Die Muster liegen hier
    // ohnehin, also wird beim Lesen entschieden.
    feedAgents: agents
      .filter((row) => feedReader(row.agent).reader === "unbekannt" && classifyFeed(row.agent).kind !== "feedbot")
      .slice(0, 10)
      .map((row) => ({ agent: row.agent, hits: Number(row.hits) || 0 })),
    feedReaders: readers.map((row) => ({
      reader: row.reader,
      subscribers: row.subscribers === null ? null : Number(row.subscribers),
      hits: Number(row.hits) || 0
    })),
    // Ab diesem Tag stammt die Messung aus eigener Zählung. Davor gibt es keine
    // Besucherzahlen, nur Aufrufe.
    visitorsFrom: since?.tag || null
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
