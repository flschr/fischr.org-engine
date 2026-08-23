// Die Einstufung entscheidet, welche Zahl am Ende "echte Besucher" heißt.
// Sie ist damit die Stelle, an der ein Fehler nicht auffällt, sondern nur die
// Statistik still verfälscht — deshalb hier ausgeführt und nicht bloß gelesen.
const assert = require("node:assert/strict");
const test = require("node:test");

let analytics;
test.before(async () => {
  analytics = await import("../functions/_analytics.js");
});

test("der Tag ist Berliner Lokaldatum, nicht UTC", () => {
  // 22:30 UTC im Sommer ist in Berlin bereits der nächste Tag.
  assert.equal(analytics.berlinDay(new Date("2026-08-22T22:30:00Z")), "2026-08-23");
  // Im Winter verschiebt sich die Grenze um eine Stunde.
  assert.equal(analytics.berlinDay(new Date("2026-01-15T22:30:00Z")), "2026-01-15");
  assert.equal(analytics.berlinDay(new Date("2026-01-15T23:30:00Z")), "2026-01-16");
});

test("selbstidentifizierende Crawler werden am User-Agent erkannt", () => {
  const bots = [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "GPTBot/1.0",
    "ClaudeBot/1.0",
    "python-requests/2.31.0",
    "curl/8.4.0",
    "Mozilla/5.0 HeadlessChrome/120.0.0.0"
  ];
  for (const userAgent of bots) {
    const verdict = analytics.classify({ userAgent, hasScript: true });
    assert.equal(verdict.class, "bot_ua", userAgent);
  }
});

test("Rechenzentren gelten als automatisiert, auch mit unauffälligem User-Agent", () => {
  const browser = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
  for (const org of ["Amazon.com, Inc.", "Hetzner Online GmbH", "DigitalOcean, LLC", "OVH SAS"]) {
    const verdict = analytics.classify({ userAgent: browser, asOrganization: org, hasScript: true });
    assert.equal(verdict.class, "bot_dc", org);
    assert.match(verdict.reason, /asn:/);
  }
});

test("ein echter Browser aus einem Wohnnetz zählt als Mensch", () => {
  const verdict = analytics.classify({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    asOrganization: "Deutsche Telekom AG",
    hasScript: true
  });
  assert.equal(verdict.class, "human");
});

test("ohne ausgeführtes Skript bleibt es unentschieden statt menschlich", () => {
  const verdict = analytics.classify({ userAgent: "Mozilla/5.0", asOrganization: "Vodafone", hasScript: false });
  assert.equal(verdict.class, "unknown");
});

test("die eigene Domain ist kein Referrer", () => {
  assert.deepEqual(analytics.referrer("https://mysite.example/blog", "mysite.example"), { host: "", path: null });
  assert.deepEqual(analytics.referrer("https://www.mysite.example/blog", "mysite.example"), { host: "", path: null });
  assert.deepEqual(analytics.referrer("", "mysite.example"), { host: "", path: null });
  assert.deepEqual(analytics.referrer("kaputt", "mysite.example"), { host: "", path: null });
});

test("fremde Referrer behalten Host und Pfad, ohne www", () => {
  assert.deepEqual(analytics.referrer("https://www.uberblogr.de/artikel/x", "mysite.example"), {
    host: "uberblogr.de",
    path: "/artikel/x"
  });
  assert.deepEqual(analytics.referrer("https://news.ycombinator.com/", "mysite.example"), {
    host: "news.ycombinator.com",
    path: null
  });
});

test("Pfade werden vereinheitlicht, damit eine Seite eine Zeile bleibt", () => {
  assert.equal(analytics.normalizePath("/beyond-blogging-platforms"), "/beyond-blogging-platforms/");
  assert.equal(analytics.normalizePath("/beyond-blogging-platforms/"), "/beyond-blogging-platforms/");
  assert.equal(analytics.normalizePath("/x/?utm_source=newsletter"), "/x/");
  assert.equal(analytics.normalizePath("/x/#kapitel"), "/x/");
  assert.equal(analytics.normalizePath(""), "/");
  assert.equal(analytics.normalizePath("/"), "/");
});

test("Feed-Leser melden ihre Abonnentenzahl im User-Agent", () => {
  const feedly = analytics.feedReader("Feedly/1.0 (+http://www.feedly.com/fetcher.html; 42 subscribers; like FeedFetcher-Google)");
  assert.equal(feedly.reader, "feedly");
  assert.equal(feedly.subscribers, 42);

  const reeder = analytics.feedReader("Reeder/5.3 CFNetwork/1494 Darwin/23.4.0");
  assert.equal(reeder.reader, "reeder");
  assert.equal(reeder.subscribers, null);

  const fremd = analytics.feedReader("irgendwas");
  assert.equal(fremd.reader, "unbekannt");
});

test("der Besucher-Hash hängt am Tagessalz und ist nicht umkehrbar kurz", async () => {
  const a = await analytics.visitorHash("salz-montag", ["203.0.113.7", "Safari", "mysite.example"]);
  const b = await analytics.visitorHash("salz-dienstag", ["203.0.113.7", "Safari", "mysite.example"]);
  const c = await analytics.visitorHash("salz-montag", ["203.0.113.7", "Safari", "mysite.example"]);
  assert.notEqual(a, b, "anderes Tagessalz muss einen anderen Hash ergeben");
  assert.equal(a, c, "gleiche Eingaben am selben Tag ergeben denselben Hash");
  assert.match(a, /^[0-9a-f]{32}$/);
});

// --- Gleichlauf von Import und eigener Zählung -------------------------------
//
// Beide Reihen liegen in derselben Tabelle. Verstehen sie Verschiedenes unter
// einem Pfad oder einem Tag, entstehen doppelte Zeilen und verschobene
// Zeiträume — beides ist in diesem Zweig schon einmal passiert. Der
// Projektstandard verlangt für doppelt geführte Logik geteilten Code oder
// einen Test, der beim Auseinanderlaufen fehlschlägt. Das ist dieser Test.
test("Importer und Live-Zählung normalisieren Pfade gleich", () => {
  const importer = require("../scripts/import-goatcounter-export.js");
  for (const pfad of ["/beitrag", "/beitrag/", "/", "", "/x/?utm_source=n", "/x/#k", "/tief/verschachtelt/pfad"]) {
    assert.equal(
      importer.normalizePath(pfad),
      analytics.normalizePath(pfad),
      `Pfad "${pfad}" wird unterschiedlich behandelt — derselbe Beitrag stünde zweimal in der Auswertung`
    );
  }
});

test("Importer und Live-Zählung meinen denselben Tag", () => {
  const importer = require("../scripts/import-goatcounter-export.js");
  const zeitpunkte = [
    "2026-08-22T22:30:00Z", // Sommerzeit: in Berlin schon der 23.
    "2026-08-22T21:59:00Z",
    "2026-01-15T23:30:00Z", // Winterzeit: in Berlin schon der 16.
    "2026-01-15T22:30:00Z",
    "2026-03-29T00:30:00Z"  // Nacht der Zeitumstellung
  ];
  for (const iso of zeitpunkte) {
    assert.equal(
      importer.berlinDay(iso),
      analytics.berlinDay(new Date(iso)),
      `Zeitpunkt ${iso} landet auf verschiedenen Tagen`
    );
  }
});

// --- Feed-Einstufung ---------------------------------------------------------
//
// Feeds werden anders eingestuft als Seiten: Kein Feed-Abruf führt JavaScript
// aus, und die großen Dienste holen den Feed aus Rechenzentren. Beide Merkmale,
// die bei Seiten tragen, fallen hier aus — bleibt die Kennung.
test("Crawler werden vom Feed getrennt, Leseprogramme nicht", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "GPTBot/1.0",
    "python-requests/2.31.0"
  ]) {
    assert.equal(analytics.classifyFeed(ua).kind, "feedbot", ua);
  }
});

test("ein Leseprogramm aus dem Rechenzentrum bleibt ein Leseprogramm", () => {
  // Feedly holt den Feed aus AWS. Als Rechenzentrums-Bot gewertet, wären echte
  // Abonnenten weg — deshalb greift die Rechenzentrums-Regel bei Feeds nicht.
  const feedly = "Feedly/1.0 (+http://www.feedly.com/fetcher.html; 42 subscribers)";
  assert.equal(analytics.classifyFeed(feedly).kind, "feed");
  assert.equal(analytics.classifyFeed("FreshRSS/1.24 (Linux)").kind, "feed");
  assert.equal(analytics.classifyFeed("MiniFlux/2.0").kind, "feed");
});

test("ein bekanntes Leseprogramm gewinnt gegen das Crawler-Muster", () => {
  // "Feedfetcher" enthält kein Bot-Muster, aber die Reihenfolge muss trotzdem
  // festliegen: erst Leseprogramm, dann Crawler.
  const gemischt = "Feedly/1.0 (+http://feedly.com/fetcher.html; like FeedFetcher-Google; bot)";
  assert.equal(analytics.classifyFeed(gemischt).kind, "feed");
});

test("eine unbekannte Kennung gilt als Leseprogramm, nicht als Crawler", () => {
  // Im Zweifel für den Leser: Wer sich nicht als Bot zu erkennen gibt, wird
  // gezählt. Die Kennung landet in feed_agents und kann später zugeordnet
  // werden.
  const verdict = analytics.classifyFeed("MeinSelbstgebauterReader/0.1");
  assert.equal(verdict.kind, "feed");
  assert.equal(verdict.reason, "unbekannt");
});

test("Flat wird als Leseprogramm erkannt, ohne falsche Treffer", () => {
  // Client-Reader mit generischem Namen: "flat" darf nur als Produktname vor
  // der Version greifen, sonst fischt das Muster beliebige Kennungen ein.
  assert.equal(analytics.feedReader("Flat/1.0 (Feed Reader)").reader, "flat");
  assert.equal(analytics.feedReader("Flat/1.1.4 (iOS; +https://justasimple.app/flat)").reader, "flat");
  assert.equal(analytics.feedReader("Mozilla/5.0 FlatpakBrowser/3").reader, "unbekannt");
  assert.equal(analytics.feedReader("Mozilla/5.0 (Macintosh) Safari/605.1.15").reader, "unbekannt");
  // Und als Leseprogramm, nicht als Crawler.
  assert.equal(analytics.classifyFeed("Flat/1.0 (Feed Reader)").kind, "feed");
});

test("die Leserliste wächst aus den unerkannten Kennungen", () => {
  // Unread und Blogosphere haben sich binnen zwei Stunden in feed_agents
  // gemeldet. Genau dafür ist die Tabelle da — dieser Test hält fest, dass der
  // Weg von dort in die Erkennung tatsächlich beschritten wurde.
  assert.equal(analytics.feedReader("Unread RSS Reader - https://www.goldenhillsoftware.com/unread/").reader, "unreadrss");
  assert.equal(analytics.feedReader("Blogosphere/1.0 (+https://blogosphere.app; ram@kramkarthik.com)").reader, "blogosphere");
});

test("gesammelte Kennungen sind zugeordnet: Leser, Aggregator, Werkzeug", () => {
  // Zweite Runde der Schleife. Entscheidend ist die Trennung dahinter: Ein
  // Leseprogramm holt den Feed für Menschen, ein Aggregator für seine eigene
  // Übersicht, eine Programmbibliothek für ein Skript. Nur die erste Gruppe
  // ist Reichweite und darf in die Abonnentenschätzung.
  for (const ua of ["FeedCity +https://feed.city", "ReadYou/0.16.2(47)"]) {
    assert.equal(analytics.classifyFeed(ua).kind, "feed", ua);
    assert.notEqual(analytics.feedReader(ua).reader, "unbekannt", ua);
  }
  for (const ua of [
    "Mozilla/5.0 (compatible; Rivva; http://rivva.de)",
    "UberBlogr Boti/2.0; https://uberblogr.de",
    "rss-parser"
  ]) {
    assert.equal(analytics.classifyFeed(ua).kind, "feedbot", ua);
  }
});

test("eine mehrdeutige Kennung bleibt im Zweifel ein Leser", () => {
  // Ein uralter Browser-Kennung auf dem Feed ist wahrscheinlich ein Skript —
  // aber eben nur wahrscheinlich. Sie als Crawler zu werten hieße, im Zweifel
  // gegen den Leser zu entscheiden; sie bleibt deshalb unerkannt und sichtbar
  // in der Arbeitsliste.
  const alt = "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)";
  assert.equal(analytics.classifyFeed(alt).kind, "feed");
  assert.equal(analytics.feedReader(alt).reader, "unbekannt");
});

test("zugeordnete Kennungen fallen aus der Arbeitsliste", () => {
  // feed_agents behält seine Zeilen, auch nachdem eine Kennung zugeordnet
  // wurde — die Zeilen von gestern wissen nichts vom Muster von heute. Der
  // Endpunkt entscheidet deshalb beim Lesen. Dieser Test hält fest, dass die
  // Entscheidung überhaupt möglich ist: erkannt heißt erkannt, egal wann die
  // Zeile entstanden ist.
  const zugeordnet = [
    "FeedCity +https://feed.city",
    "ReadYou/0.16.2(47)",
    "Unread RSS Reader - https://www.goldenhillsoftware.com/unread/",
    "Mozilla/5.0 (compatible; Rivva; http://rivva.de)",
    "rss-parser"
  ];
  for (const agent of zugeordnet) {
    const erkannt = analytics.feedReader(agent).reader !== "unbekannt"
      || analytics.classifyFeed(agent).kind === "feedbot";
    assert.ok(erkannt, `${agent} müsste inzwischen erkannt sein`);
  }
  // Und das Gegenstück: Was wirklich unerkannt ist, bleibt in der Liste.
  const offen = "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)";
  assert.equal(analytics.feedReader(offen).reader, "unbekannt");
  assert.notEqual(analytics.classifyFeed(offen).kind, "feedbot");
});
