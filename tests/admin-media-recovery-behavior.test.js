const test = require("node:test");
const assert = require("node:assert/strict");
const adminSource = require("./helpers/admin-source");

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

test("parallel recovery calls share one operation and release their processing state", async () => {
  const recoverySource = extractFunction(adminSource(), "function recoverPendingMediaOperations()");
  const state = {
    changes: new Map([["video", { path: "video.mov", mediaKind: "video", kind: "upsert" }]]),
    treeHeadSha: "draft-sha",
    mediaRecoveryPromise: null,
    mediaRecoveryJobs: 0,
    view: "media"
  };
  let releaseScan;
  const scan = new Promise((resolve) => { releaseScan = resolve; });
  let scanCount = 0;
  let renderCount = 0;
  const statuses = [];
  const recover = new Function(
    "state", "updateMediaProcessingState", "renderSyncState", "needsGithubImageNormalization",
    "videoNeedsPreparation", "showStatus", "normalizeUploadedImage", "prepareUploadedVideo",
    "refreshCurrentSilent", "renderMedia", "refreshMedia", "els",
    `return (${recoverySource});`
  )(
    state, () => {}, () => {}, () => false,
    async () => { scanCount += 1; await scan; return false; },
    (message) => statuses.push(message), async () => {}, async () => {}, async () => {},
    () => { renderCount += 1; }, async () => { throw new Error("offline"); },
    { statusBar: { textContent: "" } }
  );

  const first = recover();
  const second = recover();
  assert.strictEqual(second, first);
  assert.equal(state.mediaRecoveryJobs, 1);
  releaseScan();
  await Promise.all([first, second]);
  assert.equal(scanCount, 1);
  assert.equal(state.mediaRecoveryJobs, 0);
  assert.equal(state.mediaRecoveryPromise, null);
  assert.equal(renderCount, 1);
  assert.match(statuses.at(-1), /Mediathek konnte.*nicht aktualisiert.*offline/);
});
