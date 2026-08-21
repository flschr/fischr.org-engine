const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { findDetachedFootnoteReferences } = require("../lib/content-footnotes");
const packageScripts = require("../package.json").scripts;

test("every local and production site build runs the content preflight", () => {
  for (const script of ["start", "serve:prod", "build:site", "build:dev"]) {
    assert.match(packageScripts[script], /npm run check:content/, script);
  }
});

test("footnote references are attached to the preceding text", () => {
  const postsDirectory = path.join(__dirname, "..", "blog", "posts");
  assert.deepEqual(findDetachedFootnoteReferences(postsDirectory), []);
});

test("footnote spacing check catches detached references regardless of attribute order", (t) => {
  const postsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fischr-footnotes-"));
  t.after(() => fs.rmSync(postsDirectory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(postsDirectory, "valid.md"), 'Text<sup class="footnote-ref" id="fnref-1">1</sup>');
  fs.mkdirSync(path.join(postsDirectory, "nested"));
  fs.writeFileSync(path.join(postsDirectory, "nested", "invalid.md"), 'Erste Zeile\nText <sup id="fnref-1" class="extra footnote-ref">1</sup>');

  assert.deepEqual(findDetachedFootnoteReferences(postsDirectory), [{ file: path.join("nested", "invalid.md"), line: 2, column: 6 }]);
});
