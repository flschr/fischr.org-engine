// Abmelden muss abgemeldet bleiben.
//
// Bis zum 2026-08-23 leitete der Endpunkt auf /admin/ weiter. Dort greift ohne Sitzung die
// Login-Weiterleitung, GitHub kennt den Benutzer und hat die App autorisiert, also kam die
// Antwort ohne Rückfrage zurück — abgemeldet und sofort wieder angemeldet. Der Knopf sah aus,
// als täte er nichts.

const assert = require("node:assert/strict");
const test = require("node:test");

async function ladeEndpunkt() {
  return import("../functions/api/admin/auth/logout.js");
}

test("signing out ends on a page of its own instead of bouncing back into the login", async () => {
  const { onRequest } = await ladeEndpunkt();
  const response = onRequest();

  assert.equal(response.status, 200, "keine Weiterleitung — die liefe direkt in die Anmeldung");
  assert.match(response.headers.get("Content-Type") || "", /text\/html/);
  assert.equal(response.headers.get("Location"), null);
});

test("the session cookie is cleared and the page is never cached", async () => {
  const { onRequest } = await ladeEndpunkt();
  const response = onRequest();

  const cookie = response.headers.get("Set-Cookie") || "";
  assert.match(cookie, /^rw_admin_session=;/, "die Sitzung muss geleert werden");
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  // Eine zwischengespeicherte Fassung behauptete den Zustandswechsel auch dann noch, wenn er
  // längst vorbei ist.
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("the page offers a way back and says nothing that needs translating", async () => {
  const { onRequest } = await ladeEndpunkt();
  const html = await onRequest().text();

  assert.match(html, /<a href="\/admin\/">/, "ohne Rückweg wäre die Seite eine Sackgasse");
  assert.match(html, /Abgemeldet/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});
