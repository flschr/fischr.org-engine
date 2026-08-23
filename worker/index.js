// Einstiegspunkt des ausgelieferten Workers.
//
// Der eigentliche Anfrage-Handler entsteht aus functions/ und wird von
// `wrangler pages functions build` erzeugt. Hier wird er nur durchgereicht — daneben braucht
// die Laufzeit die Workflow-Klasse als eigenen Export, und ein generiertes Bündel kann sie
// nicht mitbringen.

import handler from "../_site/_worker.js/index.js";

export { PublishWorkflow } from "./publish-workflow.js";
export default handler;
