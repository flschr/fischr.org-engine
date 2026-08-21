const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const headers = fs.readFileSync(path.join(__dirname, "../blog/_headers"), "utf8");
const archivePolicy = headers.slice(headers.indexOf("/archive/*"), headers.indexOf("/pagefind/*"));
const adminPolicy = headers.slice(headers.indexOf("/admin/*"));
const publicPolicy = headers.slice(0, headers.indexOf("/archive/*"));
const workerPolicy = headers.slice(headers.indexOf("/pagefind/*"), headers.indexOf("/admin/*"));

test("font assets remain cached across normal page refreshes", () => {
  assert.match(headers, /\/assets\/fonts\/\*\n  ! Cache-Control\n  Cache-Control: public, max-age=2592000, immutable/);
});

test("only Pagefind documents and workers permit WebAssembly without general eval", () => {
  assert.doesNotMatch(publicPolicy, /script-src[^;]*'wasm-unsafe-eval'/);
  assert.match(archivePolicy, /! Content-Security-Policy/);
  assert.match(archivePolicy, /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';/);
  assert.doesNotMatch(archivePolicy, /script-src[^;]*'unsafe-eval'/);
  assert.match(workerPolicy, /! Content-Security-Policy/);
  assert.match(workerPolicy, /script-src 'self' 'wasm-unsafe-eval';/);
  assert.doesNotMatch(workerPolicy, /script-src[^;]*'unsafe-eval'/);
});

test("admin uses a strict path-specific script policy", () => {
  assert.match(adminPolicy, /script-src 'self';/);
  assert.doesNotMatch(adminPolicy, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(adminPolicy, /connect-src[^;]* https:(?:\s|;)/);
  assert.doesNotMatch(adminPolicy, /api\.openai\.com/);
});
