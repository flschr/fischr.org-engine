// Zählt Feed-Abrufe beim Ausliefern.
//
// Ein Feed kann sich nicht selbst melden: Kein RSS-Leser führt JavaScript aus,
// der Beacon der Webseiten greift hier also nicht. Für Feeds ist die Zählung
// beim Ausliefern die einzige Möglichkeit — und anders als bei Webseiten ist der
// "Bot" hier genau das, was gemessen werden soll.
//
// Die Zählung nach GoatCounter bleibt vorerst stehen, damit im Parallelbetrieb
// beide Reihen entstehen. Sie hing bisher an einem Token und lief praktisch nie:
// in sechzehn Monaten fünf aufgezeichnete Abrufe. Die eigene Zählung braucht
// keinen Token und keinen fremden Dienst.

import {
  berlinDay,
  classifyFeed,
  dailySalt,
  feedReader,
  recordFeedAgent,
  recordFeedFetcher,
  recordFeedReader,
  recordHit,
  visitorHash
} from "./_analytics.js";

const GOATCOUNTER_COUNT_API_URL = "https://stats.mysite.example/api/v0/count";
const FEED_FETCH_EVENT_PATH = "feed-fetch";
const FEED_PATH = "/feed.xml";

export async function onRequest(context) {
  context.passThroughOnException();

  const response = await context.env.ASSETS.fetch(context.request);

  // 304 zählt mit. Ordentliche Feed-Leser schicken bei jedem Durchlauf ihren
  // ETag und bekommen "nichts Neues" zurück — das ist ein Abruf wie jeder
  // andere, nur ohne Nutzlast. Nur response.ok zu zählen hieße, das stündliche
  // Nachsehen zu übersehen und bloß den ersten Abruf nach einem neuen Beitrag
  // mitzunehmen. Genau daran ist die alte Zählung über GoatCounter gescheitert:
  // fünf aufgezeichnete Ereignisse in sechzehn Monaten, bei gesetztem Token.
  if (context.request.method === "GET" && (response.ok || response.status === 304)) {
    context.waitUntil(
      countOwn(context).catch((error) => {
        console.error("Eigene Feed-Zählung fehlgeschlagen:", error);
      })
    );
    context.waitUntil(
      countFeedFetch(context).catch((error) => {
        console.error("Failed to track feed fetch:", error);
      })
    );
  }

  return response;
}

async function countOwn({ env, request }) {
  if (!env.ANALYTICS) return;

  const userAgent = request.headers.get("User-Agent") || "";
  const cf = request.cf || {};
  const day = berlinDay();
  const reader = feedReader(userAgent);
  const verdict = classifyFeed(userAgent);

  await recordHit(env.ANALYTICS, {
    day,
    kind: verdict.kind,
    path: FEED_PATH,
    title: "Feed",
    refHost: "",
    country: cf.country || null,
    asn: typeof cf.asn === "number" ? cf.asn : null,
    asOrg: cf.asOrganization || null,
    client: reader.reader,
    verdict,
    visitor: null,
    // Keine Rohzeile: siehe recordHit. Was ein Feed-Abruf aussagt, steht in den
    // Tagesaggregaten und in feed_readers.
    raw: false
  });

  // Crawler tauchen in der Leserliste nicht auf und zählen nicht als
  // Abonnenten. Sie stehen als eigene Art in den Tagesaggregaten.
  if (verdict.kind === "feedbot") return;

  await recordFeedReader(env.ANALYTICS, day, reader.reader, reader.subscribers);

  // Wie viele Programme fragen, nicht wie oft. Derselbe Hash wie bei Besuchern:
  // aus dem Tagessalz gebildet, ohne Adresse zu speichern, mit dem Salz wertlos.
  const salt = await dailySalt(env.ANALYTICS, day);
  const fetcher = await visitorHash(salt, [
    request.headers.get("CF-Connecting-IP") || "",
    userAgent
  ]);
  await recordFeedFetcher(env.ANALYTICS, day, fetcher, reader.reader, reader.subscribers);

  // Der größte Posten der Leserliste hieß bislang "unbekannt" und blieb es.
  if (reader.reader === "unbekannt") {
    await recordFeedAgent(env.ANALYTICS, day, userAgent);
  }
}

async function countFeedFetch({ env }) {
  const token = env.GOATCOUNTER_API_TOKEN;
  if (!token) return;

  const response = await fetch(env.GOATCOUNTER_COUNT_API_URL || GOATCOUNTER_COUNT_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      no_sessions: true,
      hits: [
        {
          path: FEED_FETCH_EVENT_PATH,
          title: "Feed: Abruf",
          event: true
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`GoatCounter count API returned ${response.status}`);
  }
}
