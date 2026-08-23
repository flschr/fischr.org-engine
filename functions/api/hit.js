// Nimmt den Zähl-Beacon der öffentlichen Seiten entgegen.
//
// Der Pfad heißt bewusst unauffällig. Blocklisten greifen Muster wie /analytics
// oder /track; genau daran ist die frühere Zählung über einen fremden Dienst
// gescheitert, dessen Domain auf den einschlägigen Listen steht. Ein
// First-Party-Endpunkt auf derselben Domain ist der einzige Weg, diese Leser
// überhaupt mitzuzählen.
//
// Antwortet immer 204 und niemals mit einem Fehler, den der Browser bemerkt:
// Eine kaputte Statistik darf keine Seite stören. Fehlt die Datenbank-Anbindung,
// zählt die Seite eben nicht — sie bricht nicht.

import { berlinDay, classify, dailySalt, normalizePath, recordHit, referrer, visitorHash } from "../_analytics.js";

const MAX_BODY = 2048;

// Ein durchsichtiges 1x1-GIF, das kleinste gültige Bild überhaupt.
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

// Der Zählpixel im RSS-Feed. Ein Bild schickt einen GET, deshalb dieser zweite
// Weg neben dem Beacon der Webseiten.
//
// Was er misst, ist ausdrücklich nicht "gelesen", sondern "das Leseprogramm hat
// die Bilder dieses Beitrags geladen". Programme mit abgeschalteten Bildern
// tauchen nie auf, Programme mit Vorab-Laden zu oft, und Dienste wie Feedly
// holen das Bild einmal über ihren Proxy für alle Nutzer. Als absolute Zahl ist
// das wertlos; im Vergleich zwischen den eigenen Beiträgen taugt es, weil die
// Verzerrung alle gleich trifft. Das Dashboard beschriftet es entsprechend.
//
// Eine Herkunftsprüfung gibt es hier nicht — ein Bildabruf aus einem
// Leseprogramm bringt keine mit. Die Zahl landet deshalb in einer eigenen Art
// und kann die Seitenaufrufe nicht aufblähen.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pfad = url.searchParams.get("p");

  if (env.ANALYTICS && typeof pfad === "string" && url.searchParams.get("k") === "feedread") {
    context.waitUntil(storeFeedRead(env, request, pfad).catch((error) => {
      console.error("Feed-Lesezählung fehlgeschlagen:", error);
    }));
  }

  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      // Ohne no-store zählt der Proxy eines Dienstes genau einmal und danach nie
      // wieder — die Zahl fröre auf dem ersten Abruf ein.
      "Cache-Control": "no-store, max-age=0"
    }
  });
}

async function storeFeedRead(env, request, pfad) {
  const path = normalizePath(pfad);
  if (path.startsWith("/admin")) return;

  // Land und Anbieter stehen bewusst nicht dabei: recordHit schriebe sie nur in
  // die Rohzeile, die hier entfällt — und beim Pixel wäre es ohnehin das Land
  // des Bildproxys eines Dienstes, nicht das seines Nutzers.
  await recordHit(env.ANALYTICS, {
    day: berlinDay(),
    kind: "feedread",
    path,
    refHost: "",
    verdict: { class: "feed", reason: "feed-lesen" },
    visitor: null,
    raw: false
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const self = new URL(request.url);

  if (!sameOrigin(request, self)) return empty();
  if (!env.ANALYTICS) return empty();

  let payload;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return empty();
    payload = JSON.parse(text);
  } catch {
    return empty();
  }
  if (!payload || typeof payload !== "object") return empty();

  // context.waitUntil und nicht die herausgelöste Funktion: In der
  // Workers-Laufzeit ist das eine Methode, die ihren Kontext braucht.
  context.waitUntil(store(env, request, self.hostname, payload).catch((error) => {
    console.error("Zählung fehlgeschlagen:", error);
  }));

  return empty();
}

// Der Treffer soll von einer Seite dieser Domain kommen. Browser belegen das
// über mindestens einen von drei Headern; ein Aufruf per curl bringt im
// Standardfall keinen davon mit.
//
// Das ist eine Bremsschwelle, kein Schloss: Alle drei Header setzt der Client,
// ein `curl -H "Origin: https://mysite.example"` kommt durch. Gegen gelegentliches
// Rauschen genügt das. Sollten die Zahlen einmal öffentlich unter den
// Beiträgen stehen, trägt die Annahme nicht mehr — dann braucht es ein
// serverseitig ausgestelltes Merkmal statt eines selbst gesetzten Headers.
//
// Der Origin wird verglichen, nicht geparst: "null" ist ein gültiger
// Origin-Wert (sandboxed iframes), und new URL("null") wirft.
export function sameOrigin(request, self) {
  const origin = request.headers.get("Origin");
  if (origin) return origin === self.origin;

  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin";

  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === self.origin;
  } catch {
    return false;
  }
}

async function store(env, request, host, payload) {
  // Nur Zeichenketten werden als Pfad akzeptiert. Ohne diese Prüfung macht
  // {"p":{}} aus einem Objekt die Seite "/[object Object]/".
  if (typeof payload.p !== "string") return;
  const path = normalizePath(payload.p);
  // Der Admin ist nicht Teil der Reichweite dieses Blogs.
  if (path.startsWith("/admin")) return;

  const cf = request.cf || {};
  const userAgent = request.headers.get("User-Agent") || "";
  const day = berlinDay();

  // Der Beacon kommt aus einem Browser, der JavaScript ausgeführt hat — das ist
  // das Signal, das Crawler nicht liefern.
  const verdict = classify({ userAgent, asOrganization: cf.asOrganization || "", hasScript: true });

  const salt = await dailySalt(env.ANALYTICS, day);
  const visitor = await visitorHash(salt, [
    request.headers.get("CF-Connecting-IP") || "",
    userAgent,
    host
  ]);

  const source = referrer(typeof payload.r === "string" ? payload.r : "", host);

  await recordHit(env.ANALYTICS, {
    day,
    kind: "page",
    path,
    title: typeof payload.t === "string" ? payload.t.slice(0, 300) : null,
    refHost: source.host,
    refPath: source.path,
    country: cf.country || null,
    asn: typeof cf.asn === "number" ? cf.asn : null,
    asOrg: cf.asOrganization || null,
    client: clientName(userAgent),
    verdict,
    // Ein Bot bekommt keinen Besucher-Hash: Er soll die Besucherzahl nicht
    // aufblähen, auch nicht, wenn jemand den Filter später lockert.
    visitor: verdict.class === "human" ? visitor : null
  });
}

// Grobe Kennung statt Versions-Parsing. Für "welcher Browser ungefähr" reicht
// das, und alles Feinere wäre bloß eine zweite Fingerabdruck-Fläche.
function clientName(userAgent) {
  const value = userAgent.toLowerCase();
  if (value.includes("firefox")) return "firefox";
  if (value.includes("edg/")) return "edge";
  if (value.includes("chrome") && !value.includes("chromium")) return "chrome";
  if (value.includes("safari")) return "safari";
  return "sonstige";
}

function empty() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
