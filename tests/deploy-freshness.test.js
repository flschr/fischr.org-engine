const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyDeploy, describeDeploy } = require("../scripts/lib/deploy-freshness");

const root = path.join(__dirname, "..");
const guardScript = fs.readFileSync(path.join(root, "scripts/check-deploy-freshness.js"), "utf8");

// How the two production workflows wire this guard up is asserted in
// tests/workflow-validation.test.js: those files live under .github/ and stay in the private
// source, so the assertions about them have to stay there too.

test("a build whose commit is still main's tip deploys", () => {
  const result = classifyDeploy({ builtSha: "aaa111", remoteSha: "aaa111" });
  assert.equal(result.fresh, true);
  assert.equal(result.reason, "tip");
});

test("the job's own automation commits do not block its deploy", () => {
  // Every production build commits automation/media-manifest.json seconds before deploying,
  // and a concurrent publish adds automation/atproto-documents.json. Neither renders.
  const result = classifyDeploy({
    builtSha: "aaa111",
    remoteSha: "bbb222",
    changedPaths: ["automation/media-manifest.json", "automation/atproto-documents.json"]
  });
  assert.equal(result.fresh, true);
  assert.equal(result.reason, "automation-only");
});

test("content that landed on main while the job was building blocks the deploy", () => {
  // The 2026-08-23 case: a 4:41 build for the previous commit reached its deploy step 30 s
  // after an admin publish had shipped an edited post, and overwrote it.
  const result = classifyDeploy({
    builtSha: "9615132",
    remoteSha: "9720bdd",
    changedPaths: [
      "blog/posts/2026-08-23-poker-face-staffel-2-4-5.md",
      "automation/media-manifest.json"
    ]
  });
  assert.equal(result.fresh, false);
  assert.equal(result.reason, "overtaken");
  assert.deepEqual(result.contentPaths, ["blog/posts/2026-08-23-poker-face-staffel-2-4-5.md"]);
});

test("templates, styles and functions count as content, not automation", () => {
  for (const changed of ["blog/_includes/layout.njk", "blog/assets/css/site.css", "functions/feed.xml.js"]) {
    const result = classifyDeploy({ builtSha: "aaa111", remoteSha: "bbb222", changedPaths: [changed] });
    assert.equal(result.fresh, false, `${changed} should block the deploy`);
  }
});

test("output built on history main no longer contains is never deployed", () => {
  const result = classifyDeploy({
    builtSha: "aaa111",
    remoteSha: "bbb222",
    changedPaths: ["automation/media-manifest.json"],
    builtIsAncestor: false
  });
  assert.equal(result.fresh, false);
  assert.equal(result.reason, "diverged");
});

test("the decision refuses to guess when it is called without both commits", () => {
  assert.throws(() => classifyDeploy({ builtSha: "aaa111" }), /both the built commit and main's current tip/);
});

test("a blocked deploy explains which content it would have reverted", () => {
  const result = classifyDeploy({
    builtSha: "9615132",
    remoteSha: "9720bdd",
    changedPaths: ["blog/posts/2026-08-23-poker-face-staffel-2-4-5.md"]
  });
  const message = describeDeploy(result, { builtSha: "9615132abc", remoteSha: "9720bddabc" });
  assert.match(message, /9615132/);
  assert.match(message, /9720bdd/);
  assert.match(message, /poker-face-staffel-2/);
});

test("an unreadable comparison deploys as before instead of blocking the site", () => {
  // A guard that cannot read git must not become the reason nothing ships.
  assert.match(guardScript, /Could not fetch origin\/\$\{branch\}|Could not fetch origin/);
  assert.match(guardScript, /emit\(true, `::warning::Could not fetch/);
  assert.match(guardScript, /emit\(true, `::warning::Built commit/);
});
