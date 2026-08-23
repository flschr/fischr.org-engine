const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const modulePath = path.resolve(__dirname, "../blog/admin/admin-src/27e-publish-overlay-view.js");

const view = async (input) => (await import(`file://${modulePath}`)).publishOverlayView(input);

test("a running publish reports the step it is on", async () => {
  const running = await view({
    publishInFlight: true,
    status: { state: "running", message: "Website bauen und prüfen", phaseIndex: 6, phaseCount: 17 },
    view: "editor"
  });

  assert.equal(running.visible, true);
  assert.equal(running.tone, "running");
  assert.equal(running.ringLabel, "35%");
  assert.equal(running.indeterminate, false);
  assert.equal(running.phase, "Website bauen und prüfen");
});

test("a publish GitHub has not accepted yet spins instead of resting at zero", async () => {
  // describeRun(null) has always returned this shape: a state, a message, no
  // phases. A ring sitting at 0% reads as stuck rather than as starting.
  const queued = await view({
    publishInFlight: true,
    status: { state: "queued", message: "Veröffentlichung bei GitHub vorgemerkt" },
    view: "editor"
  });

  assert.equal(queued.tone, "running");
  assert.equal(queued.progress, null);
  assert.equal(queued.indeterminate, true);
  assert.equal(queued.ringLabel, "");
});

test("a publish that failed without ever producing a run is over, not pending", async () => {
  // Since the endpoint-started publish there is a *terminal* state with no
  // phases at all: the workflow declined to build a stale head, or the run was
  // cancelled, so no Actions run exists to read steps from. Reading progress
  // off that must not produce NaN, must not keep spinning, and must not offer
  // a link to a run page that does not exist.
  const failed = await view({
    publishInFlight: false,
    status: { state: "failed", message: "Der freigegebene Stand ist nicht mehr aktuell" },
    view: "editor"
  });

  assert.equal(failed.visible, true);
  assert.equal(failed.tone, "failed");
  assert.equal(failed.progress, null);
  assert.equal(failed.indeterminate, false, "a finished publish never spins");
  assert.equal(failed.ringLabel, "!");
  assert.equal(failed.url, "", "no run, no link");
  assert.match(failed.phase, /Der freigegebene Stand ist nicht mehr aktuell/);
  assert.match(failed.phase, /bleiben in der Warteschlange/);
});

test("a failed publish that does have a run links to it", async () => {
  const failed = await view({
    publishInFlight: false,
    status: { state: "failed", message: "Veröffentlichung fehlgeschlagen bei „Validate production site“", url: "https://github.com/example/example-blog/actions/runs/1" },
    view: "editor"
  });

  assert.equal(failed.url, "https://github.com/example/example-blog/actions/runs/1");
});

test("a finished publish shows a full ring", async () => {
  const done = await view({ publishInFlight: false, status: { state: "success", message: "Veröffentlicht und verteilt" }, view: "editor" });

  assert.equal(done.tone, "success");
  assert.equal(done.progress, 1);
  assert.equal(done.ringLabel, "100%");
  assert.equal(done.indeterminate, false);
});

test("the overlay stays out of the queue view, which already shows all of it", async () => {
  const inQueue = await view({
    publishInFlight: true,
    status: { state: "running", message: "Website bauen und prüfen", phaseIndex: 6, phaseCount: 17 },
    view: "queue"
  });

  assert.equal(inQueue.visible, false);
});

test("nothing to report means nothing on screen", async () => {
  assert.equal((await view({ publishInFlight: false, status: null, view: "editor" })).visible, false);
  assert.equal((await view({})).visible, false);
});

test("a finished publish is announced once, not again on the next save", async () => {
  // Nothing ever resets state.publishStatus back to null, and renderSyncState()
  // runs on every save (04a-draft-writes.js). Without this guard the card would
  // reappear saying "Veröffentlicht" hours later, for a publish long done.
  const status = { state: "success", message: "Veröffentlicht und verteilt" };

  const first = await view({ publishInFlight: false, status, view: "editor" });
  assert.equal(first.visible, true);

  const again = await view({ publishInFlight: false, status, view: "editor", dismissed: status });
  assert.equal(again.visible, false);

  // A later publish is a different status object and gets its own announcement,
  // even though it says exactly the same thing.
  const next = { state: "success", message: "Veröffentlicht und verteilt" };
  const later = await view({ publishInFlight: false, status: next, view: "editor", dismissed: status });
  assert.equal(later.visible, true);
});

test("dismissing a success never silences a failure or a running publish", async () => {
  const status = { state: "success", message: "Veröffentlicht und verteilt" };

  // The guard is deliberately narrow: only a success can be dismissed. A stale
  // `dismissed` must not be able to hide a publish that is still going, or one
  // that failed and still needs dealing with.
  const running = await view({ publishInFlight: true, status: { state: "running", message: "x", phaseIndex: 3, phaseCount: 17 }, view: "editor", dismissed: status });
  assert.equal(running.visible, true);

  const failed = await view({ publishInFlight: false, status: { state: "failed", message: "kaputt" }, view: "editor", dismissed: status });
  assert.equal(failed.visible, true);
});
