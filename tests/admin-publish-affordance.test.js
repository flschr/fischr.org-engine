const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const modulePath = path.resolve(__dirname, "../blog/admin/admin-src/20c-publish-affordance.js");
const affordance = async (input) => (await import(`file://${modulePath}`)).publishAffordance(input);

test("an unpublished article always offers the button — it is the only way live", async () => {
  const draft = await affordance({ published: false, draftIntent: true });
  assert.equal(draft.visible, true);
  assert.equal(draft.action, "publish");
  assert.equal(draft.label, "Veröffentlichen");

  // Untouched and unsaved is still worth offering: nothing is live yet, so
  // there is nothing for "no difference" to mean.
  const untouched = await affordance({ published: false, draftIntent: true, hasQueuedChange: false, editorDirty: false });
  assert.equal(untouched.visible, true);
});

test("a published article with nothing waiting offers no button", async () => {
  // The whole point: sending would do nothing, and a button that does nothing
  // invites a click and then has to explain itself.
  const settled = await affordance({ published: true, hasQueuedChange: false, editorDirty: false });
  assert.equal(settled.visible, false);
  assert.equal(settled.action, null);
});

test("a difference brings the button back, from either side", async () => {
  // An edit still in the editor counts, because sending saves first and
  // publishes after — it does not need the save to have happened already.
  const typing = await affordance({ published: true, hasQueuedChange: false, editorDirty: true });
  assert.equal(typing.visible, true);
  assert.equal(typing.action, "sync-publish");
  assert.equal(typing.label, "Änderung veröffentlichen");

  // And an edit already saved into the queue counts too.
  const queued = await affordance({ published: true, hasQueuedChange: true, editorDirty: false });
  assert.equal(queued.visible, true);
  assert.equal(queued.action, "sync-publish");
});

test("a raw template is saved, never sent", async () => {
  const source = await affordance({ published: false, sourceMode: true, editorDirty: true });
  assert.equal(source.visible, false);
  assert.equal(source.action, null);
});

test("pages keep their old behaviour, which has no published state to speak of", async () => {
  const page = await affordance({ collection: "pages", published: false, draftIntent: false });
  assert.equal(page.visible, true);
  assert.equal(page.action, "sync-publish");

  // Crucially not hidden by the published-and-settled rule, which is about
  // posts: a page must stay sendable.
  const settledPage = await affordance({ collection: "pages", published: true, hasQueuedChange: false, editorDirty: false });
  assert.equal(settledPage.visible, true);
});

test("the visible flag and the action can never disagree", async () => {
  // The bar reads both from one call, so a visible button always has something
  // to do and a hidden one never does. Checked across the whole input space
  // rather than trusted.
  const values = [false, true];
  for (const collection of ["posts", "pages"]) {
    for (const published of values) {
      for (const draftIntent of values) {
        for (const hasQueuedChange of values) {
          for (const editorDirty of values) {
            for (const sourceMode of values) {
              const result = await affordance({ collection, published, draftIntent, hasQueuedChange, editorDirty, sourceMode });
              assert.equal(
                result.visible, result.action !== null,
                `visible=${result.visible} but action=${result.action} for ${JSON.stringify({ collection, published, draftIntent, hasQueuedChange, editorDirty, sourceMode })}`
              );
              if (result.visible) assert.ok(result.label, "a visible button always says what it does");
            }
          }
        }
      }
    }
  }
});
