// Die Hülle, die die Laufzeit braucht.
//
// Der Ablauf steht in publish-run.js, ohne Cloudflare-Import — sonst liesse er sich nur im
// Betrieb prüfen, also genau dort, wo ein Fehler teuer ist.

import { WorkflowEntrypoint } from "cloudflare:workers";

import { fuehrePublishAus } from "./publish-run.js";

export class PublishWorkflow extends WorkflowEntrypoint {
  run(event, step) {
    return fuehrePublishAus(event, step);
  }
}
