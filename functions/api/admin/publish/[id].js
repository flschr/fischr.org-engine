// Der Zustand einer laufenden Veröffentlichung.
//
// Der Admin fragte dafür bisher die Actions-API ab und suchte einen Lauf mit passendem Titel.
// Hier antwortet die Instanz selbst — sie weiss, in welchem Schritt sie steht, und braucht
// dafür weder Titelabgleich noch Rateschleife.

import { jsonResponse, readSession } from "../../../_admin-auth.js";
import { ledgerAus } from "../../../../worker/publish-ledger.js";

export function onRequestGet(context) {
  return handlePublishStatus(context, { readSession });
}

export async function handlePublishStatus(context, { readSession: sitzungLesen }) {
  const session = await sitzungLesen(context.request, context.env);
  if (!session) return jsonResponse({ message: "Not authenticated." }, { status: 401 });
  if (!context.env.PUBLISH) return jsonResponse({ message: "Publish workflow is not bound." }, { status: 503 });

  const id = context.params?.id;
  if (!id) return jsonResponse({ message: "Missing instance id." }, { status: 400 });

  let zustand;
  try {
    zustand = await (await context.env.PUBLISH.get(String(id))).status();
  } catch (error) {
    // Eine unbekannte Kennung ist keine Störung, sondern eine Frage nach etwas, das es nicht
    // gibt — und sie darf nicht wie ein Ausfall aussehen.
    if (/not found/i.test(String(error?.message || error))) {
      return jsonResponse({ message: "Unbekannte Veröffentlichung." }, { status: 404 });
    }
    throw error;
  }

  // Der Lauf kommt aus dem Buch, sobald der Workflow ihn gefunden hat. Damit fragt der Admin ihn
  // direkt ab, statt die letzten dreissig Läufe zu listen und deren Titel mit einer selbst
  // gebauten Zeichenkette zu vergleichen — eine Kopplung an die run-name-Zeile in
  // admin-publish.yml, die der Browser gar nicht sehen kann.
  //
  // Fehlt der Eintrag, ist das kein Fehler: Zwischen dem Start und dem Fund liegen Sekunden, in
  // denen es schlicht noch keinen Lauf gibt.
  const zeile = await ledgerAus(context.env.PUBLISH_LEDGER)?.nachInstanz(String(id));

  return jsonResponse({
    id: String(id),
    status: zustand.status,
    output: zustand.output ?? null,
    error: zustand.error ?? null,
    lauf: zeile?.run_id ? { id: zeile.run_id, url: zeile.run_url || null } : null,
    buch: zeile ? { requestId: zeile.request_id, status: zeile.status, grund: zeile.grund, seit: zeile.started_at } : null
  });
}
