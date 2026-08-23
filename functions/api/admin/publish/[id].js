// Der Zustand einer laufenden Veröffentlichung.
//
// Der Admin fragte dafür bisher die Actions-API ab und suchte einen Lauf mit passendem Titel.
// Hier antwortet die Instanz selbst — sie weiss, in welchem Schritt sie steht, und braucht
// dafür weder Titelabgleich noch Rateschleife.

import { jsonResponse, readSession } from "../../../_admin-auth.js";

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

  return jsonResponse({
    id: String(id),
    status: zustand.status,
    output: zustand.output ?? null,
    error: zustand.error ?? null
  });
}
