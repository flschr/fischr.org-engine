// Der Zählendpunkt ist die einzige Stelle, an der Fremde in die Datenbank
// schreiben können. Diese Tests halten die Schranke fest, die ihn schützt —
// und die Fälle, an denen eine frühere Fassung gescheitert ist:
// ein "Origin: null" ließ new URL() werfen, ein fehlender Origin galt als
// unverdächtig, und ein Objekt statt einer Zeichenkette wurde zum Pfad
// "/[object Object]/".
const assert = require("node:assert/strict");
const test = require("node:test");

let endpoint;
let analytics;
test.before(async () => {
  endpoint = await import("../functions/api/hit.js");
  analytics = await import("../functions/_analytics.js");
});

const SELF = new URL("https://mysite.example/api/hit");
const anfrage = (headers) => new Request("https://mysite.example/api/hit", { method: "POST", headers });

test("ein Beacon von der eigenen Seite wird angenommen", () => {
  assert.equal(endpoint.sameOrigin(anfrage({ Origin: "https://mysite.example" }), SELF), true);
  assert.equal(endpoint.sameOrigin(anfrage({ "Sec-Fetch-Site": "same-origin" }), SELF), true);
  assert.equal(endpoint.sameOrigin(anfrage({ Referer: "https://mysite.example/beitrag/" }), SELF), true);
});

test("Origin null wirft nicht, sondern wird abgelehnt", () => {
  // Sandboxed iframes senden genau diesen Wert. new URL("null") wirft — die
  // Prüfung darf deshalb vergleichen, nicht parsen.
  assert.doesNotThrow(() => endpoint.sameOrigin(anfrage({ Origin: "null" }), SELF));
  assert.equal(endpoint.sameOrigin(anfrage({ Origin: "null" }), SELF), false);
});

test("ohne jeden Herkunftsnachweis wird abgelehnt", () => {
  // So sieht ein Aufruf per curl aus: kein Origin, kein Sec-Fetch-Site, kein
  // Referer. Vorher zählte er mit.
  assert.equal(endpoint.sameOrigin(anfrage({}), SELF), false);
});

test("fremde Herkunft wird in jeder Form abgelehnt", () => {
  assert.equal(endpoint.sameOrigin(anfrage({ Origin: "https://evil.example" }), SELF), false);
  assert.equal(endpoint.sameOrigin(anfrage({ "Sec-Fetch-Site": "cross-site" }), SELF), false);
  assert.equal(endpoint.sameOrigin(anfrage({ Referer: "https://evil.example/x" }), SELF), false);
  assert.equal(endpoint.sameOrigin(anfrage({ Referer: "kein-url" }), SELF), false);
});

test("ein Origin schlägt einen widersprechenden Referer", () => {
  const gemischt = anfrage({ Origin: "https://evil.example", Referer: "https://mysite.example/" });
  assert.equal(endpoint.sameOrigin(gemischt, SELF), false);
});

test("nur Zeichenketten ergeben einen Pfad", () => {
  // normalizePath ist gutmütig: Ohne vorgelagerte Typprüfung macht es aus
  // einem Objekt eine gültig aussehende Seite.
  assert.equal(analytics.normalizePath("/beitrag"), "/beitrag/");
  assert.equal(analytics.normalizePath(String({})), "/[object%20Object]/");
});

test("Cloudflare WARP gilt nicht als Rechenzentrum", () => {
  // WARP-Nutzer erscheinen mit "Cloudflare" als Organisation. Sie sind echte
  // Leser — und ausgerechnet die datenschutzbewussten.
  const verdict = analytics.classify({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    asOrganization: "Cloudflare, Inc.",
    hasScript: true
  });
  assert.equal(verdict.class, "human");
});
