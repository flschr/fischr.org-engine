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

export function onRequestPost(context) {
  return handlePublishStart(context, { readSession, fetch });
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
    changeCount: Number(payload?.changeCount || 0)
  };

  const fehlend = Object.entries(anfrage)
    .filter(([schluessel, wert]) => schluessel !== "changeCount" && !wert)
    .map(([schluessel]) => schluessel);
  if (fehlend.length) {
    return jsonResponse({ message: `Fehlende Angaben: ${fehlend.join(", ")}` }, { status: 400 });
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
        gefunden: kopf.sha
      },
      { status: 409 }
    );
  }

  const instanz = await context.env.PUBLISH.create({
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
  return { veraltet: Boolean(sha) && sha !== erwartet, sha };
}

function adminRepository(env) {
  return env.ADMIN_GITHUB_REPO || "example/example-blog";
}
