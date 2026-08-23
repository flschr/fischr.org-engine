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
  return handlePublishStart(context, { readSession });
}

// Die Abhängigkeiten kommen herein, damit ein Test die Anmeldung ersetzen kann, ohne ein
// signiertes Cookie bauen zu müssen — dasselbe Muster wie in functions/api/admin/snapshot.js.
export async function handlePublishStart(context, { readSession: sitzungLesen }) {
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

function adminRepository(env) {
  return env.ADMIN_GITHUB_REPO || "example/example-blog";
}
