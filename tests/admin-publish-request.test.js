const test = require("node:test");
const assert = require("node:assert/strict");
const adminSource = require("./helpers/admin-source");
const publishPlanModule = require("../blog/admin/publish-plan.js");

// Der Modus stand als `publishPlan.mode` in der Anfrage, ohne dass syncOutbox einen Plan
// gekannt hätte: Die einzige Deklaration ist eine lokale Variable in renderQueue(). Im Browser
// fiel das nie auf, weil `<p id="publishPlan">` denselben Namen als globale Eigenschaft am
// window belegt — der Zugriff traf das Absatzelement, `.mode` war `undefined`, und die Anfrage
// trug still keinen Modus. Hier gibt es kein Dokument, das den Namen belegt, also scheitert
// dieselbe Zeile hart. Beides deckt derselbe Test ab.
function extractFunction(sourceText, anchor) {
  const start = sourceText.indexOf(anchor);
  assert.notEqual(start, -1, `Missing function: ${anchor}`);
  const blockStart = sourceText.indexOf("{", start);
  let depth = 0;
  for (let index = blockStart; index < sourceText.length; index += 1) {
    if (sourceText[index] === "{") depth += 1;
    if (sourceText[index] === "}") depth -= 1;
    if (depth === 0) return sourceText.slice(start, index + 1);
  }
  throw new Error(`Unclosed function: ${anchor}`);
}

function runSyncOutbox(changes) {
  const source = extractFunction(adminSource(), "async function syncOutbox()");
  const state = {
    publishInFlight: false,
    mediaProcessing: false,
    tree: {},
    treeHeadSha: "draft-sha",
    mainTree: {},
    mainTreeHeadSha: "main-sha",
    publishPollToken: 0,
    changes: new Map()
  };
  const dispatches = [];
  const statuses = [];
  const persisted = [];
  const polled = [];
  const syncOutbox = new Function(
    "state", "showStatus", "setBusy", "waitForMediaCommits", "getAllChanges",
    "guardMediaReadyForPublish", "recoverPendingMediaOperations", "renderQueue", "hasGithubAccess",
    "requireGithubAccess", "openQueue", "focusGithubConnection", "ensureDraftsBranch", "github",
    "repo", "window", "changeSignature", "persistPublishRequest", "renderSyncState",
    "pollPublishCompletion", "starteVeroeffentlichung",
    `return (${source});`
  )(
    state,
    (message, tone) => statuses.push({ message, tone }),
    () => {},
    async () => {},
    async () => changes,
    async () => true,
    async () => {},
    () => {},
    () => true,
    () => {},
    async () => {},
    () => {},
    async () => {},
    async (endpoint, options) => { dispatches.push({ endpoint, options }); return {}; },
    { branch: "drafts", publishBranch: "main" },
    { RWPublishStatus: { createRequestId: () => "request-1" }, RWPublishPlan: publishPlanModule },
    (change) => `${change.kind}:${change.path}`,
    (request) => persisted.push(request),
    () => {},
    (token, request) => polled.push({ token, request }),
    // Seit der Umstellung startet der Admin nicht mehr selbst per Dispatch, sondern über den
    // eigenen Endpunkt. Was hier gezählt wird, ist damit der Start, nicht mehr der Dispatch.
    async (anfrage) => { dispatches.push({ endpoint: "/api/admin/publish", options: { body: anfrage } }); return { id: "wf-1" }; }
  );
  return syncOutbox().then(() => ({ dispatches, statuses, persisted, polled, state }));
}

test("the publish request records the same validation mode the queue announced", async () => {
  const content = await runSyncOutbox([
    { kind: "upsert", path: "blog/posts/2026-08-23-artikel.md", sha: "a" },
    { kind: "upsert", path: "automation/media-manifest.json", sha: "b" }
  ]);
  assert.deepEqual(content.statuses.filter((entry) => entry.tone === "error"), []);
  assert.equal(content.dispatches.length, 1);
  assert.equal(content.persisted.length, 1);
  assert.equal(content.persisted[0].validationMode, "content");
  assert.equal(content.polled[0].request.validationMode, "content");

  const full = await runSyncOutbox([
    { kind: "upsert", path: "blog/posts/2026-08-23-artikel.md", sha: "a" },
    { kind: "upsert", path: "blog/pages/impressum.njk", sha: "c" }
  ]);
  assert.equal(full.persisted[0].validationMode, "deploy");
});

// Die Fortschrittskarte und die Warnung nach 90 Sekunden sind die beiden Leser des Modus. Ohne
// sie wäre das Feld in der Anfrage nur Buchhaltung, und ein leerer Modus würde nichts kosten.
test("the stored mode is what the progress card and the slow-content warning read", () => {
  const source = adminSource();
  assert.match(source, /state\.publishRequest\?\.validationMode/);
  const status = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "blog/admin/publish-status.js"), "utf8"
  );
  assert.match(status, /request\.validationMode === "content"/);
});
