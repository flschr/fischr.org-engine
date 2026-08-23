// Abmelden endet auf einer eigenen Seite, nicht mit einer Weiterleitung auf /admin/.
//
// Der Grund ist der Anmeldeweg selbst: /admin/ schickt ohne Sitzung sofort zu GitHub, GitHub
// kennt den angemeldeten Benutzer und hat die App längst autorisiert, also kommt die Antwort
// ohne Rückfrage zurück. Wer sich abmeldet, ist damit in derselben Sekunde wieder angemeldet —
// der Knopf sah aus, als täte er nichts.
//
// Die Sitzung wird weiterhin gelöscht; nur der letzte Schritt führt jetzt auf eine Seite, die
// von sich aus nichts tut. Der Weg zurück ist ein Klick.

import { clearSessionCookie } from "../../../_admin-auth.js";

const seite = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Abgemeldet</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    font: 1rem/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: Canvas; color: CanvasText;
  }
  main { text-align: center; padding: 2rem; max-width: 26rem; }
  h1 { font-size: 1.35rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { margin: 0 0 1.5rem; opacity: 0.75; }
  a {
    display: inline-block; padding: 0.6rem 1.1rem; border: 1px solid currentColor;
    border-radius: 0.4rem; text-decoration: none; color: inherit;
  }
  a:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1>Abgemeldet</h1>
  <p>Die Sitzung wurde beendet. Dieses Gerät hat keinen Zugriff mehr auf den Admin.</p>
  <a href="/admin/">Wieder anmelden</a>
</main>
</body>
</html>
`;

export function onRequest() {
  return new Response(seite, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Nie zwischenspeichern: Die Seite ist die Bestätigung eines Zustandswechsels, und eine
      // zwischengespeicherte Fassung behauptete ihn auch dann noch, wenn er längst vorbei ist.
      "Cache-Control": "no-store",
      "Set-Cookie": clearSessionCookie()
    }
  });
}
