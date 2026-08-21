const assert = require("node:assert/strict");
const test = require("node:test");

const { create } = require("../blog/admin/editor-recovery.js");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  };
}

test("editor recovery persists, reads and clears crash-safe drafts", () => {
  const storage = memoryStorage();
  const recovery = create({ storage, key: "draft", now: () => "2026-07-19T12:00:00Z" });

  recovery.write({ content: "Body", snapshot: "one" });
  assert.deepEqual(recovery.read(), { content: "Body", snapshot: "one", savedAt: "2026-07-19T12:00:00Z" });
  assert.equal(recovery.docKey({ collection: "posts", path: "" }), "posts:__new__");
  recovery.clear();
  assert.equal(recovery.read(), null);
});
