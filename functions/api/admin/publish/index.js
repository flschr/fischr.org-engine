// Startet eine Veröffentlichung als Workflow-Instanz.
//
// Bisher hat der Admin admin-publish.yml selbst angestossen und danach die Actions-API
// abgefragt, bis er einen Lauf mit passendem Titel fand. Beides ist Arbeit, die er nur tut,
// weil es keinen Ort gab, der den Vorgang kennt. Der Workflow ist dieser Ort: Er hält den
// Zustand, überlebt einen Neustart der Ausführung und wiederholt nur, was noch nicht durch ist.
//
// Der Bau bleibt in Actions. Ein Worker hat keinen Checkout, und Eleventy, sharp und ffmpeg
// brauchen einen.

import { jsonResponse, readSession } from "../../../_admin-auth.js";
import { ledgerAus } from "../../../../worker/publish-ledger.js";
import { freigabeGiltNoch } from "../../../../worker/publish-stand.js";

export function onRequestPost(context) {
  return handlePublishStart(context, { readSession, fetch });
}

export function onRequestGet(context) {
  return handleLaufende(context, { readSession });
}

// Welche Veröffentlichung gerade läuft — für die Wiederaufnahme nach einem Neuladen oder auf
// einem zweiten Gerät.
//
// Bisher suchte der Browser das in der Actions-Liste: alle Läufe holen, nach einem Titel filtern,
// der mit "Publish " beginnt, und die Kennung wieder aus diesem Titel herausschneiden. Das Buch
// weiss es direkt — und weiss es auch dann noch, wenn der Lauf noch gar nicht existiert.
export async function handleLaufende(context, { readSession: sitzungLesen }) {
  const session = await sitzungLesen(context.request, context.env);
  if (!session) return jsonResponse({ message: "Not authenticated." }, { status: 401 });

  const buch = ledgerAus(context.env.PUBLISH_LEDGER);
  if (!buch) return jsonResponse({ message: "Publish ledger is not bound." }, { status: 503 });

  const zeile = await buch.laufende();
  if (!zeile) return jsonResponse({ laufend: null });

  return jsonResponse({
    laufend: {
      requestId: zeile.request_id,
      workflowId: zeile.instance_id || "",
      runId: zeile.run_id || null,
      changeCount: zeile.change_count,
      startedAt: new Date(zeile.started_at * 1000).toISOString()
    }
  });
}

// Die Abhängigkeiten kommen herein, damit ein Test die Anmeldung ersetzen kann, ohne ein
// signiertes Cookie bauen zu müssen — dasselbe Muster wie in functions/api/admin/snapshot.js.
// `fetch` kommt aus demselben Grund herein wie die Anmeldung: Sonst spräche jeder Test dieser
// Datei über die Standprüfung mit der echten GitHub-API. Das wäre nicht nur langsam — die
// Prüfung antwortet auf einen unlesbaren Stand bewusst mit „nicht veraltet", ein Test wäre also
// auch ohne Netz grün und würde nichts belegen.
export async function handlePublishStart(context, { readSession: sitzungLesen, fetch: holen = fetch }) {
  const session = await sitzungLesen(context.request, context.env);
  if (!session) return jsonResponse({ message: "Not authenticated." }, { status: 401 });
  if (!context.env.PUBLISH) return jsonResponse({ message: "Publish workflow is not bound." }, { status: 503 });

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ message: "Expected a JSON body." }, { status: 400 });
  }

  const anfrage = {
    requestId: String(payload?.requestId || ""),
    mainSha: String(payload?.mainSha || ""),
    draftSha: String(payload?.draftSha || ""),
    changeCount: Number(payload?.changeCount || 0),
    // Was die Warteschlange ausgewählt hat. Fehlt sie, geht alles mit.
    paths: Array.isArray(payload?.paths) ? payload.paths.map((pfad) => String(pfad)) : null
  };

  const fehlend = Object.entries(anfrage)
    .filter(([schluessel, wert]) => !["changeCount", "paths"].includes(schluessel) && !wert)
    .map(([schluessel]) => schluessel);
  if (fehlend.length) {
    return jsonResponse({ message: `Fehlende Angaben: ${fehlend.join(", ")}` }, { status: 400 });
  }

  // Eine leere Auswahl ist etwas anderes als keine Auswahl.
  //
  // „Keine" heisst alles — so verhält sich eine Veröffentlichung ohne Abwahl wie vor der
  // Auswahl. Eine leere Liste hiesse „nichts", und weiter unten in der Kette wird daraus
  // wieder „alles": Der Workflow schickt eine leere Liste als leere Eingabe weiter, und der
  // Bau liest eine leere Eingabe als „alles". Genau derselbe Wert, zwei gegenteilige
  // Bedeutungen — das wird hier abgefangen, wo es noch eine Antwort geben kann.
  if (Array.isArray(anfrage.paths) && !anfrage.paths.length) {
    return jsonResponse(
      { message: "Die Auswahl ist leer — es gäbe nichts zu veröffentlichen.", code: "AUSWAHL_LEER" },
      { status: 400 }
    );
  }

  // Die Standprüfung gehört hierher und nicht erst in den Workflow: Hier kann sie sofort
  // antworten. Im Workflow wäre "veraltet" ein Ergebnis, auf das der Admin erst warten müsste —
  // und bis dahin sähe eine nicht angestossene Veröffentlichung aus wie eine hängende.
  //
  // Der Workflow prüft trotzdem noch einmal. Zwischen dieser Antwort und seinem ersten Schritt
  // liegen Sekunden, in denen main weiterwandern kann.
  const kopf = await aktuellerKopf(context, session.token, anfrage.mainSha, holen);
  if (kopf.veraltet) {
    return jsonResponse(
      {
        message: "Der geprüfte Stand ist nicht mehr aktuell. Bitte neu laden und die Änderungen prüfen.",
        code: "STAND_VERALTET",
        erwartet: anfrage.mainSha,
        gefunden: kopf.sha,
        grund: kopf.grund
      },
      { status: 409 }
    );
  }

  // Das Schloss wird genommen, bevor eine Instanz entsteht — nicht danach. Andersherum gäbe es
  // einen Moment, in dem eine Veröffentlichung läuft, für die niemand das Schloss hält, und eine
  // zweite käme durch.
  //
  // Genommen wird es durch Schreiben, nicht durch Nachsehen: Ein partieller Unique-Index in
  // lib/publish/schema.sql lässt genau eine laufende Zeile zu. Ein Vorher-Nachsehen hätte ein
  // Fenster zwischen Prüfung und Schreiben; die Datenbank hat keins.
  const buch = ledgerAus(context.env.PUBLISH_LEDGER);
  if (!buch) return jsonResponse({ message: "Publish ledger is not bound." }, { status: 503 });

  const jetzt = Math.floor(Date.now() / 1000);
  const platz = await buch.reserviere({ ...anfrage, jetzt });

  // Dieselbe Anfrage noch einmal — zweiter Klick, wiederholtes Senden nach einem Netzaussetzer.
  // Sie hat schon eine Instanz; die wird zurückgegeben, statt eine zweite anzulegen. Ein Fehler
  // wäre hier falsch: Aus Sicht des Absenders ist genau das passiert, was er wollte.
  if (!platz.ok && platz.grund === "laeuft-schon") {
    return jsonResponse({ id: platz.zeile.instance_id || "", status: "gestartet" }, { status: 202 });
  }

  if (!platz.ok && platz.grund === "abgeschlossen") {
    return jsonResponse(
      {
        message: "Diese Veröffentlichung ist bereits durchgelaufen. Bitte neu laden.",
        code: "ANFRAGE_ABGESCHLOSSEN",
        ausgang: platz.zeile?.status || null
      },
      { status: 409 }
    );
  }

  if (!platz.ok) {
    return jsonResponse(
      {
        message: "Es läuft bereits eine Veröffentlichung. Bitte warten, bis sie durch ist.",
        code: "VEROEFFENTLICHUNG_LAEUFT",
        laufendeAnfrage: platz.laufend?.request_id || null,
        seit: platz.laufend?.started_at || null
      },
      { status: 409 }
    );
  }

  let instanz;
  try {
    instanz = await context.env.PUBLISH.create({
      params: {
        ...anfrage,
        repository: adminRepository(context.env),
        // Der Workflow läuft losgelöst von der Anfrage und hat keine Sitzung. Er bekommt deshalb
        // dasselbe Token mit, das der Admin auch für seine eigenen Aufrufe benutzt — kein
        // zusätzlicher Zugang, der eingerichtet und gedreht werden müsste. Die Instanz lebt nur
        // für die Dauer einer Veröffentlichung.
        token: session.token
      }
    });
  } catch (fehler) {
    // Ohne Instanz gibt es niemanden, der die Zeile je abschliessen würde. Das Schloss sofort
    // zurückgeben — sonst wäre die nächste Veröffentlichung bis zum Verfall blockiert.
    await buch.schliesseAb(anfrage.requestId, "gescheitert", `Die Veröffentlichung konnte nicht beginnen: ${fehler?.message || fehler}`, jetzt);
    throw fehler;
  }

  await buch.verknuepfeInstanz(anfrage.requestId, instanz.id);
  return jsonResponse({ id: instanz.id, status: "gestartet" }, { status: 202 });
}

async function aktuellerKopf(context, token, erwartet, holen) {
  const antwort = await holen(
    `https://api.github.com/repos/${adminRepository(context.env)}/git/ref/heads/main`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "mysite.example admin",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }
  );

  // Lässt sich der Stand nicht lesen, wird nicht geraten: Die Veröffentlichung beginnt, und der
  // Workflow prüft gleich noch einmal. Hier zu scheitern hiesse, an einer Vorsichtsmassnahme zu
  // scheitern statt an der Sache.
  if (!antwort.ok) return { veraltet: false, sha: null };

  const kopf = await antwort.json();
  const sha = kopf?.object?.sha || null;
  if (!sha || sha === erwartet) return { veraltet: false, sha };

  // Eine andere SHA heisst nicht, dass sich Geprüftes bewegt hat: Nach fast jeder
  // Veröffentlichung landet der R2-Manifest-Fold auf main. scripts/admin-publish.js
  // veröffentlicht darüber hinweg — diese Prüfung darf nicht strenger sein als der Schritt,
  // den sie vorwegnimmt, sonst lehnt sie ab, was durchgelaufen wäre.
  try {
    const urteil = await freigabeGiltNoch({
      repository: adminRepository(context.env),
      erwartet,
      aktuell: sha,
      github: (pfad) => githubJson(pfad, token, holen)
    });
    return { veraltet: !urteil.gilt, sha, grund: urteil.grund };
  } catch {
    // Lässt sich der Vergleich nicht führen, wird nicht geraten. Der Workflow prüft gleich
    // noch einmal — und dort kostet ein Irrtum nur eine Runde, hier eine Veröffentlichung.
    return { veraltet: false, sha, grund: "Vergleich nicht möglich" };
  }
}

async function githubJson(pfad, token, holen) {
  const antwort = await holen(`https://api.github.com/${pfad}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "mysite.example admin",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!antwort.ok) throw new Error(`GitHub ${antwort.status} für ${pfad}`);
  return antwort.json();
}

function adminRepository(env) {
  return env.ADMIN_GITHUB_REPO || "example/example-blog";
}
