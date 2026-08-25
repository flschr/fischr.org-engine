import { publishRequestKey } from "./00-konstanten.js";
import { state } from "./01c-state.js";

// Split out of 27a-publish-state.js purely to stay under the 200-line file cap
// (see tests/admin-source-structure.test.js) — no behavioral reason.
export function persistPublishRequest(request) {
  state.publishRequest = request;
  window.RWPublishService.persistRequest(localStorage, publishRequestKey, request);
}

// Ein „vorgemerkt" ohne Lauf kann zweierlei heissen: Der Lauf ist noch nicht sichtbar, oder er
// wird nie kommen, weil der Workflow entschieden hat, gar nicht zu bauen. Nur der Workflow kann
// die beiden auseinanderhalten — bis ein Lauf existiert, ist er die einzige Quelle.
export async function workflowGeprueft(status, request) {
  if (status.state !== "queued" || status.runId || !request.workflowId) return status;
  const lauf = await window.RWPublishService.fetchWorkflowState(request.workflowId);
  if (!lauf) return status;

  // Sobald das Buch den Lauf kennt, merkt sich die Anfrage seine Nummer. Ab dann wird er direkt
  // abgefragt, und diese Abzweigung greift nicht mehr.
  if (lauf.lauf?.id && lauf.lauf.id !== request.runId) {
    request.runId = lauf.lauf.id;
    persistPublishRequest(request);
  }

  if (lauf.output?.status === "veraltet") {
    return { state: "failed", messageKey: "queue.staleCheckedState" };
  }
  if (lauf.status === "errored" || lauf.status === "terminated") {
    return { state: "failed", messageKey: "queue.publishAborted", messageVars: { detail: lauf.error?.message || lauf.status } };
  }
  // Ist die Instanz durch, ohne dass je ein Lauf sichtbar wurde, kennt nur sie den Ausgang.
  // Ohne diesen Fall bliebe die Karte auf „vorgemerkt" stehen, bis das Warten abläuft — und
  // meldete dann eine Zeitüberschreitung für etwas längst Abgeschlossenes.
  if (lauf.status === "complete" && lauf.output?.status) {
    return ausgangDerInstanz(lauf.output);
  }
  return status;
}

function ausgangDerInstanz(ausgang) {
  if (ausgang.status === "fertig") return { state: "success", messageKey: "queue.publishedAndDistributed" };
  // ausgang.grund is the reporting instance's own reason string — external
  // content, not one of ours to translate, so it stays a plain message with
  // no key; only the generic fallback below is.
  return {
    state: "failed",
    message: ausgang.grund || undefined,
    messageKey: ausgang.grund ? undefined : "queue.publishNotCompleted",
    url: ausgang.lauf?.url
  };
}
