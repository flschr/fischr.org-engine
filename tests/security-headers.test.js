const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const headers = fs.readFileSync(path.join(__dirname, "../blog/_headers"), "utf8");
const archivePolicy = headers.slice(headers.indexOf("/archive/*"), headers.indexOf("/pagefind/*"));
const adminPolicy = headers.slice(headers.indexOf("/admin/*"));
const publicPolicy = headers.slice(0, headers.indexOf("/archive/*"));
const workerPolicy = headers.slice(headers.indexOf("/pagefind/*"), headers.indexOf("/admin/*"));

// Built from a plain "media.mysite.example" literal on purpose: scripts/export-public-engine.js
// rewrites that string in the exported snapshot, so these expectations travel with the files
// they check. A regex literal that escapes the dots survives the rewrite untouched and then
// fails only in the export, never here.
const deliveryHost = "media.mysite.example".replace(/\./g, "\\.");

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
  // The R2 delivery domain must be loadable for previews of already-committed media, but only
  // as a media/image source — never as a script, connect or frame target.
  assert.match(adminPolicy, new RegExp(`img-src[^;]* https://${deliveryHost}`));
  assert.match(adminPolicy, new RegExp(`media-src[^;]* https://${deliveryHost}`));
  assert.doesNotMatch(adminPolicy, new RegExp(`(?:script|connect|frame)-src[^;]*${deliveryHost}`));
});

// Videos moved to the delivery domain with everything else, but media-src did not follow — so
// every <video> on the site was blocked by the site's own CSP while the images beside them
// loaded fine (img-src allows https: wholesale). Pinned here in both policies that serve
// article content.
test("self-hosted video is allowed to load from the delivery domain", () => {
  assert.match(publicPolicy, new RegExp(`media-src[^;]* https://${deliveryHost}`));
  assert.match(archivePolicy, new RegExp(`media-src[^;]* https://${deliveryHost}`));
  assert.doesNotMatch(publicPolicy, new RegExp(`(?:script|connect|frame)-src[^;]*${deliveryHost}`));
});
