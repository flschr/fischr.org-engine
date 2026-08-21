const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const readAdminSource = require("./helpers/admin-source");

function adminSource() {
  return readAdminSource();
}

test("saving social settings adopts the canonical rendered configuration as its clean baseline", () => {
  const source = adminSource();
  const saveStart = source.indexOf("async function saveSocialConfig()");
  const saveEnd = source.indexOf("\n  async function ", saveStart + 1);
  const saveSource = source.slice(saveStart, saveEnd);

  assert.ok(saveStart >= 0, "saveSocialConfig should exist");
  assert.match(
    saveSource,
    /renderSocialConfig\(\);[\s\S]*state\.socialConfigLoaded = JSON\.stringify\(collectSocialConfigDraft\(\)\);/
  );
  assert.doesNotMatch(saveSource, /state\.socialConfigLoaded = JSON\.stringify\(state\.socialConfigDraft\)/);
});
