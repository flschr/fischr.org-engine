// Eigene Webanalytics: Einstufung, Besucher-Hash und Schreibpfad.
//
// Entwurfsentscheidungen, die hier nicht offensichtlich sind:
//
// 1. Gezählt wird über einen Beacon vom Browser, nicht über eine Middleware vor
//    jeder Auslieferung. Das kostet Reichweite bei JS-losen Clients, kauft dafür
//    aber den besten kostenlosen Bot-Filter, den es gibt: Crawler führen kein
//    JavaScript aus. Außerdem bleibt das HTML im Edge-Cache und die Seite läuft
//    weiter, wenn das Tageskontingent reißt — dann fehlen Zahlen, keine Seiten.
//
// 2. Tagesaggregate werden beim Schreiben mitgeführt, nicht nachts aggregiert.
//    Pages Functions kennen keinen Cron; ein zweiter Worker nur fürs Rollup
//    wäre ein weiteres bewegliches Teil. Bei dieser Größenordnung sind die paar
//    zusätzlichen Schreibzeilen billiger als das Bauteil.
//
// 3. Eingestuft wird, nicht verworfen. class trägt das Urteil, class_reason
//    seinen Grund. Wer den Filter später anders zieht, kann die Vergangenheit
//    neu bewerten, statt sie verloren zu haben.
//
// 4. Datei bewusst über 350 Zeilen (STANDARD.md §8): Einstufung, Schreibpfad
//    und die Berliner Tages-/Stundenrechnung hängen eng aneinander — jede
//    Schreibfunktion braucht dieselbe Tagesgrenze wie die Einstufung darüber,
//    und ein Split entlang dieser Nähte würde die meisten Funktionen ihre
//    Nachbarn importieren lassen, statt Kopplung zu verringern.

const encoder = new TextEncoder();

// Was in die Tagesaggregate einfließt. Alles andere wird trotzdem in hits
// festgehalten — eingestuft, nicht verworfen.
const COUNTED_CLASSES = new Set(["human", "feed", "feed_bot"]);

// Grobe Kennungen selbstidentifizierender Crawler. Bewusst kurz gehalten: Der
// Beacon siebt Bots schon dadurch aus, dass sie kein JavaScript ausführen —
// diese Liste ist die zweite Reihe, nicht die erste.
//
// Dazu Aggregatoren und Werkzeuge, die sich nicht als Bot bezeichnen, aber
// keine Menschen vertreten: Rivva und UberBlogr sammeln Blogs für ihre eigenen
// Übersichten, rss-parser ist eine Programmbibliothek. Sie holen den Feed
// jeweils einmal für sich selbst, nicht für Abonnenten — als Reichweite
// gezählt würden sie die Abonnentenschätzung verfälschen. Als Quelle tauchen
// sie ohnehin dort auf, wo sie hingehören: in der Quellenliste, wenn sie
// jemanden herbringen.
//
// Drei weitere aus derselben Arbeitsliste: marginalia betreibt eine
// Suchmaschine und holt den Feed zum Indexieren, nicht zum Lesen. hypefactors
// steht hinter der Kennung "Buck" — ein Media-Monitoring-Dienst, der Erwähnungen
// sammelt. blogme ist ein Aggregator wie Rivva, nur kleiner.
const BOT_PATTERN = /bot\b|bots\b|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|ia_archiver|semrush|ahrefs|mj12|dotbot|petalbot|yandex|duckduck|baidu|sogou|exabot|gptbot|ccbot|claudebot|perplexity|applebot|headlesschrome|phantomjs|python-requests|curl\/|wget\/|libwww|okhttp|go-http-client|java\/|rivva|uberblogr|rss-parser|marginalia|hypefactors|blogme/i;

// Rechenzentren beherbergen fast keine Leser, aber fast alle Scraper. Der
// Organisationsname kommt aus request.cf und ist auf jedem Cloudflare-Plan da —
// im Gegensatz zum Bot-Score, der Enterprise voraussetzt.
//
// Cloudflare selbst steht bewusst NICHT auf dieser Liste: Wer WARP benutzt,
// erscheint mit "Cloudflare" als Organisation. Das sind echte Leser, und
// ausgerechnet die datenschutzbewussten würden sonst wieder herausfallen —
// also genau die, die diese Zählung zurückgewinnen soll. Automatisierte
// Zugriffe von Cloudflare-Adressen fängt die Skript-Regel ohnehin ab.
const DATACENTER_PATTERN = /amazon|aws|google (llc|cloud)|microsoft|azure|hetzner|ovh|digitalocean|linode|akamai|fastly|alibaba|tencent|oracle|scaleway|contabo|leaseweb|choopa|vultr|m247|datacamp/i;

// Feed-Leser melden ihre Abonnentenzahl im User-Agent. Das ist die einzige
// Reichweitenangabe, die ein RSS-Feed überhaupt hergibt.
const SUBSCRIBER_PATTERN = /([0-9]+)\s+subscribers?/i;
// Die Liste wächst aus feed_agents: Was dort als unerkannte Kennung auftaucht
// und sich als Leseprogramm entpuppt, kommt hierher. So sind Unread und
// Blogosphere dazugekommen, keine zwei Stunden nachdem die Tabelle existierte.
//
// "flat" nur mit folgendem Schrägstrich, also als Produktname vor der Version.
// Ohne diese Bedingung fischt das Muster jedes Wort mit "flat" darin aus einer
// beliebigen Kennung. justasimple steht daneben, weil Flat künftig seine
// Produktadresse mitschicken will — dann greift die Erkennung auch, wenn sich
// der Name einmal ändert.
const FEED_READER_PATTERN = /(feedly|inoreader|newsblur|feedbin|miniflux|reeder|netnewswire|feedland|tiny ?tiny ?rss|freshrss|rssowl|akregator|thunderbird|bazqux|theoldreader|feeder|readwise|granary|elfeed|flat(?=\/)|justasimple|unread rss|goldenhillsoftware|blogosphere|feedcity|feed\.city|readyou)/i;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

// Der Tag ist Berliner Lokaldatum, nicht UTC. Damit ist jede Auswertung über
// ein Zeitfenster ein simples BETWEEN — und die Grenze liegt dort, wo sie für
// den Leser dieses Blogs auch gefühlt liegt.
export function berlinDay(date = new Date()) {
  return dayFormatter.format(date);
}

const hourFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23"
});

// Dieselbe Berliner Stunde, als 'YYYY-MM-DDTHH'. Der Admin bildet daraus
// dieselben Schlüssel client-seitig nach (21b-stats-period.js), um die
// stündlichen Reihen ohne eigene Zeitzonenrechnung im Browser zu füllen —
// beide Formatierungen müssen deshalb in Sync bleiben.
export function berlinHour(date = new Date()) {
  const teile = Object.fromEntries(hourFormatter.formatToParts(date).map((teil) => [teil.type, teil.value]));
  return `${teile.year}-${teile.month}-${teile.day}T${teile.hour}`;
}

// Ein Salz pro Tag, in der Datenbank abgelegt und im Isolate gemerkt. Ohne Salz
// ließe sich aus dem Hash die IP zurückrechnen — der Adressraum ist klein genug.
//
// Der tägliche Wechsel beendet die Verknüpfung über Tage hinweg. Damit auch die
// Wiedererkennbarkeit *innerhalb* eines vergangenen Tages endet, müssen die
// alten Salze weg: Solange eines von ihnen in der Datenbank steht, lässt sich zu
// einer vermuteten IP nachrechnen, ob sie an diesem Tag da war. Ohne Salz ist
// derselbe Hash nicht mehr überprüfbar.
const SALZ_TAGE = 3;

// Die Rohtabelle wird von keiner Auswertung gelesen; sie existiert, um eine
// Bot-Einstufung später rückwirkend korrigieren zu können. Ein halbes Jahr
// reicht dafür weit und macht aus dem offenen Aufbewahrungsversprechen eine
// eingehaltene Zusage. Die Tagesaggregate bleiben unberührt und für immer.
const ROHDATEN_TAGE = 180;

// hourly_feed lebt nur für den 1-Tag-Blick des Dashboards. Acht Tage lassen
// auch einen freien Zeitraum zu, der auf einen einzelnen zurückliegenden Tag
// fällt, ohne die Tabelle über eine Handvoll Zeilen pro Stunde hinauswachsen
// zu lassen.
//
// Exportiert, weil der Statistik-Endpunkt dieselbe Grenze kennen muss: Ein
// einzelner Tag außerhalb dieses Fensters hat keine stündliche Feed-Zeile
// mehr, und die Kurve darf dafür keine erfundene Nulllinie zeichnen (siehe
// functions/api/admin/analytics.js).
export const STUNDEN_TAGE = 8;

const saltCache = new Map();

export function tagMinus(day, tage) {
  const zeitpunkt = new Date(`${day}T12:00:00Z`);
  zeitpunkt.setUTCDate(zeitpunkt.getUTCDate() - tage);
  return zeitpunkt.toISOString().slice(0, 10);
}

// Läuft nur, wenn für einen Tag zum ersten Mal ein Salz angelegt wird — also
// höchstens einmal je Tag und Isolate, und immer innerhalb von waitUntil.
// Deshalb braucht es weder Cron noch einen zweiten Worker.
export async function raeumeAuf(db, day) {
  await db.batch([
    db.prepare("DELETE FROM meta WHERE key LIKE 'salt:%' AND key < ?").bind(`salt:${tagMinus(day, SALZ_TAGE)}`),
    db.prepare("DELETE FROM hits WHERE day < ?").bind(tagMinus(day, ROHDATEN_TAGE)),
    // Die Arbeitsliste der unerkannten Kennungen läuft mit derselben Frist.
    // Sie ist zum Zuordnen da, nicht zum Aufbewahren: Was ein halbes Jahr lang
    // niemand zugeordnet hat, wird es auch nicht mehr — und es sind fremde
    // Kennungen, kein eigener Bestand.
    db.prepare("DELETE FROM feed_agents WHERE day < ?").bind(tagMinus(day, ROHDATEN_TAGE)),
    db.prepare("DELETE FROM hourly_feed WHERE hour < ?").bind(`${tagMinus(day, STUNDEN_TAGE)}T00`)
  ]);
}

export async function dailySalt(db, day) {
  const cached = saltCache.get(day);
  if (cached) return cached;

  const key = `salt:${day}`;
  const existing = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first();
  if (existing?.value) {
    saltCache.set(day, existing.value);
    return existing.value;
  }

  const fresh = crypto.randomUUID();
  // ON CONFLICT DO NOTHING: Zwei gleichzeitige erste Anfragen des Tages dürfen
  // sich nicht gegenseitig das Salz unter den Füßen wegziehen.
  await db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING").bind(key, fresh).run();
  const settled = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first();
  const value = settled?.value || fresh;
  saltCache.set(day, value);

  // Ein neuer Tag ist der natürliche Anlass zum Aufräumen. Scheitert es, ist
  // das kein Grund, den Treffer zu verlieren.
  try {
    await raeumeAuf(db, day);
  } catch (error) {
    console.error("Aufräumen fehlgeschlagen:", error);
  }

  return value;
}

export async function visitorHash(salt, parts) {
  const data = encoder.encode([salt, ...parts].join(" "));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function classify({ userAgent = "", asOrganization = "", hasScript = false }) {
  if (BOT_PATTERN.test(userAgent)) return { class: "bot_ua", reason: "user-agent" };
  if (DATACENTER_PATTERN.test(asOrganization)) return { class: "bot_dc", reason: `asn:${asOrganization}` };
  if (!hasScript) return { class: "unknown", reason: "kein script" };
  return { class: "human", reason: "" };
}

// Feeds werden anders eingestuft als Seiten, aus zwei Gründen:
//
// Ein Feed-Abruf führt kein JavaScript aus — das Hauptmerkmal für Seiten fällt
// also aus. Und die großen Dienste holen den Feed aus Rechenzentren; Feedly aus
// AWS als Bot zu werten hieße, echte Abonnenten wegzuwerfen. Bleibt die
// Kennung, und die reicht hier: Crawler nennen sich, Leseprogramme auch.
//
// Ein bekanntes Leseprogramm gewinnt immer, auch wenn seine Kennung ein
// Bot-Muster enthält. Danach erst greift die Crawler-Liste.
export function classifyFeed(userAgent = "") {
  if (FEED_READER_PATTERN.test(userAgent)) return { class: "feed", kind: "feed", reason: "leseprogramm" };
  if (BOT_PATTERN.test(userAgent)) return { class: "feed_bot", kind: "feedbot", reason: "crawler" };
  return { class: "feed", kind: "feed", reason: "unbekannt" };
}

export function feedReader(userAgent = "") {
  const named = userAgent.match(FEED_READER_PATTERN);
  const subscribers = userAgent.match(SUBSCRIBER_PATTERN);
  return {
    reader: named ? named[1].toLowerCase().replace(/\s+/g, "") : "unbekannt",
    subscribers: subscribers ? Number(subscribers[1]) : null
  };
}

// Dieselbe Quelle kommt unter mehreren Rohformen an: eine Landes-TLD von
// Google, die Kennung ihrer Android-App als Referrer-Host
// (android-app://com.google.android.googlequicksearchbox/…) und, aus dem
// GoatCounter-Import, ein bloßes Label ohne Adresse ("Google"). Ohne diese
// Zusammenführung zählt "google.com", die App-Kennung und das Label als drei
// Quellen in der Liste, wo es eine ist.
//
// Die Mastodon-App bekommt bewusst keine Instanz zugeordnet: Ihr Referrer
// nennt nie, von welcher Instanz der Klick kam — das gibt die App gar nicht
// mit, anders als deren Weboberfläche. "mastodon.social" wäre geraten. Die
// Projektadresse benennt die Quelle ehrlich, ohne eine Instanz zu behaupten.
export const APP_REFERRER_HOSTS = {
  "com.google.android.googlequicksearchbox": "google.com",
  "org.joinmastodon.android": "joinmastodon.org"
};

export function normalizeRefHost(host) {
  const value = String(host || "").trim();
  if (!value) return value;
  const lower = value.toLowerCase();
  if (APP_REFERRER_HOSTS[lower]) return APP_REFERRER_HOSTS[lower];
  // Höchstens zwei kurze TLD-Teile (com, de, co.uk, com.br, …), sonst matchte
  // das Muster auch eine fremde Domain wie "google.com.irgendwas-langes.tld".
  if (/^google((\.[a-z]{2,3}){1,2})?$/.test(lower)) return "google.com";
  return value;
}

// Eigene Adressen sind kein Referrer, sondern Navigation. Sie fallen auf den
// leeren Host zurück, damit die Quellenliste zeigt, woher Leser wirklich kommen.
export function referrer(value, selfHost) {
  if (!value) return { host: "", path: null };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { host: "", path: null };
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === String(selfHost || "").replace(/^www\./, "")) return { host: "", path: null };
  return { host: normalizeRefHost(host), path: url.pathname === "/" ? null : url.pathname };
}

// Pfade werden auf das reduziert, was eine Seite ausmacht: kein Query, kein
// Fragment, immer mit abschließendem Schrägstrich. Sonst zerfällt eine Seite in
// beliebig viele Zeilen, sobald jemand einen Kampagnenparameter anhängt.
export function normalizePath(value) {
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

// Ein Treffer, bis zu zwei Batches: zuerst die Rohzeile samt
// Besuchermerkmalen, dann — falls der Treffer überhaupt zählt — die
// Tagesaggregate. Der erste Batch entfällt ganz, wenn weder eine Rohzeile
// (raw: false, siehe unten) noch ein Besucher anfällt; ein Feed-Abruf schreibt
// deshalb nur Aggregate.
//
// visitor_days und visitor_page_days sind INSERT OR IGNORE. Ihr Ergebnis wird
// bewusst nicht ausgewertet: Besucherzahlen entstehen beim Lesen aus diesen
// beiden Tabellen, nicht durch Mitzählen in einer dritten.
export async function recordHit(db, hit) {
  const {
    day, kind, path, title = null, refHost = "", refPath = null,
    country = null, asn = null, asOrg = null, client = null,
    verdict, visitor = null, raw = true
  } = hit;

  const timestamp = Math.floor(Date.now() / 1000);

  const statements = [];

  // Feed-Abfragen bekommen keine Rohzeile. Ein Feed-Leser meldet sich
  // stündlich mit derselben Kennung; die Rohzeile trüge nichts, was die
  // Tagesaggregate und feed_readers nicht schon enthalten, würde die Tabelle
  // aber um ein Vielfaches schneller füllen als alle Seitenaufrufe zusammen.
  if (raw) {
    statements.push(
      db.prepare(
        `INSERT INTO hits (ts, day, kind, path, title, ref_host, ref_path, country, asn, as_org, client, class, class_reason, visitor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(timestamp, day, kind, path, title, refHost || null, refPath, country, asn, asOrg, client, verdict.class, verdict.reason || null, visitor)
    );
  }

  if (visitor) {
    statements.push(
      db.prepare("INSERT OR IGNORE INTO visitor_days (day, visitor) VALUES (?, ?)").bind(day, visitor),
      db.prepare("INSERT OR IGNORE INTO visitor_page_days (day, path, visitor) VALUES (?, ?, ?)").bind(day, path, visitor)
    );
  }

  if (statements.length) await db.batch(statements);

  // Die Tagesaggregate sind das, was das Dashboard zeigt — dort gehört nur
  // hinein, was auch gezählt werden soll. Bots bleiben in hits stehen und
  // lassen sich dort weiterhin auswerten, ohne die Kurven aufzublähen.
  if (!COUNTED_CLASSES.has(verdict.class)) return;

  // Besucher pro Seite werden nicht mitgezählt, sondern beim Lesen aus
  // visitor_page_days ermittelt. Zwei Wahrheiten für dieselbe Zahl wären eine
  // Quelle für stille Abweichungen, sobald Zeilen nachträglich gelöscht oder
  // neu eingespielt werden.
  const aggregates = [
    db.prepare(
      `INSERT INTO daily_page (day, path, kind, source, title, hits)
       VALUES (?, ?, ?, 'live', ?, 1)
       ON CONFLICT (day, path, kind, source) DO UPDATE SET
         hits = hits + 1,
         title = COALESCE(excluded.title, daily_page.title)`
    ).bind(day, path, kind, title)
  ];

  // Ein Feed-Abruf hat keine Quelle. Ihn als Direktzugriff mitzuzählen würde die
  // Quellenliste mit Zahlen füllen, die dort nichts aussagen.
  if (kind === "page") {
    aggregates.push(
      db.prepare(
        `INSERT INTO daily_ref (day, ref_host, source, hits)
         VALUES (?, ?, 'live', 1)
         ON CONFLICT (day, ref_host, source) DO UPDATE SET hits = hits + 1`
      ).bind(day, refHost || ""),
      // Seite mal Quelle: Das ist die Zahl hinter der aufklappbaren Zeile im
      // Dashboard — welche Quelle auf welchen Beitrag geführt hat.
      db.prepare(
        `INSERT INTO daily_page_ref (day, path, ref_host, source, hits)
         VALUES (?, ?, ?, 'live', 1)
         ON CONFLICT (day, path, ref_host, source) DO UPDATE SET hits = hits + 1`
      ).bind(day, path, refHost || ""),
      // Das Land, das Cloudflare der Anfrage beilegt. Es steht sonst nur in der
      // Rohzeile und wäre mit ihr nach 180 Tagen weg.
      //
      // Ohne erkanntes Land wird die leere Zeichenkette geschrieben, keine
      // Zeile ausgelassen: Die Liste im Dashboard schlüsselt die Aufrufe
      // darüber auf, und was fehlt, soll man sehen können.
      db.prepare(
        `INSERT INTO daily_country (day, country, hits)
         VALUES (?, ?, 1)
         ON CONFLICT (day, country) DO UPDATE SET hits = hits + 1`
      ).bind(day, country || "")
    );
  }

  // Der stündliche Verlauf des Feeds, für den 1-Tag-Blick des Dashboards — die
  // einzige Stelle, die eine Feed-Zeitauflösung unter einem Tag kennt, weil ein
  // Feed-Abruf sonst keine Rohzeile bekommt (siehe oben).
  if (kind === "feed") {
    aggregates.push(
      db.prepare(
        `INSERT INTO hourly_feed (hour, hits) VALUES (?, 1)
         ON CONFLICT (hour) DO UPDATE SET hits = hits + 1`
      ).bind(berlinHour(new Date(timestamp * 1000)))
    );
  }

  await db.batch(aggregates);
}

// Ein Programm, ein Eintrag pro Tag. Zusammen mit den gemeldeten Abo-Zahlen
// ergibt das die Abonnentenschätzung; ohne diese Tabelle wüsste man nur, wie oft
// gefragt wurde, nicht von wie vielen.
export async function recordFeedFetcher(db, day, fetcher, reader, subscribers, country) {
  await db.prepare(
    `INSERT INTO feed_fetchers (day, fetcher, reader, subscribers, country) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (day, fetcher) DO UPDATE SET
       reader = excluded.reader,
       subscribers = COALESCE(excluded.subscribers, feed_fetchers.subscribers),
       country = COALESCE(excluded.country, feed_fetchers.country)`
  ).bind(day, fetcher, reader, subscribers, country || null).run();
}

// Nur für Kennungen ohne erkanntes Leseprogramm. Gekürzt, weil eine Kennung
// beliebig lang sein kann und für die Zuordnung der Anfang genügt.
//
// Adressen werden vorher entfernt. Betreiber schreiben aus Höflichkeit ihre
// Kontaktadresse in die Kennung — "Blogosphere/1.0 (+https://blogosphere.app;
// name@example.com)" ist ein echter Fall aus dieser Datenbank. Für die
// Zuordnung eines Leseprogramms trägt sie nichts bei, und sie wäre der einzige
// Personenbezug in einem Datenbestand, der sonst keinen enthält.
const MAIL_MUSTER = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;

export async function recordFeedAgent(db, day, userAgent) {
  const ohneAdresse = String(userAgent || "").replace(MAIL_MUSTER, "(Adresse entfernt)");
  const gekuerzt = ohneAdresse.slice(0, 200) || "(ohne Kennung)";
  await db.prepare(
    `INSERT INTO feed_agents (day, agent, hits) VALUES (?, ?, 1)
     ON CONFLICT (day, agent) DO UPDATE SET hits = hits + 1`
  ).bind(day, gekuerzt).run();
}

export async function recordFeedReader(db, day, reader, subscribers) {
  await db.prepare(
    `INSERT INTO feed_readers (day, reader, subscribers, hits)
     VALUES (?, ?, ?, 1)
     ON CONFLICT (day, reader) DO UPDATE SET
       hits = hits + 1,
       subscribers = COALESCE(excluded.subscribers, feed_readers.subscribers)`
  ).bind(day, reader, subscribers).run();
}
