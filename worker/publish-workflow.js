// Die Hülle, die die Laufzeit braucht.
//
// Der Ablauf steht in publish-run.js, ohne Cloudflare-Import — sonst liesse er sich nur im
// Betrieb prüfen, also genau dort, wo ein Fehler teuer ist.

import { WorkflowEntrypoint } from "cloudflare:workers";

import { ledgerAus } from "./publish-ledger.js";
import { fuehrePublishAus } from "./publish-run.js";

export class PublishWorkflow extends WorkflowEntrypoint {
  run(event, step) {
    // Das Buch kommt von hier, nicht aus dem Ablauf: Dieselbe Trennung wie bei fetch — was an
    // die Laufzeit gebunden ist, bleibt in der Hülle, damit der Ablauf ohne sie prüfbar ist.
    return fuehrePublishAus(event, step, { buch: ledgerAus(this.env?.PUBLISH_LEDGER) });
  }
}
