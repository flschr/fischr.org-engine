const assert = require("node:assert/strict");
const test = require("node:test");

let endpoint;
test.before(async () => {
  endpoint = await import("../functions/api/admin/alt-text.js");
});

function request(body, headers = {}) {
  return new Request("https://mysite.example/api/admin/alt-text", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body
  });
}

function context(body, env = {}, headers = {}) {
  return { request: request(body, headers), env };
}

const authenticated = { readSession: async () => ({ login: "rene" }) };

test("alt-text endpoint requires an authenticated admin session", async () => {
  const response = await endpoint.handleAltTextRequest(context("{}"), { readSession: async () => null });
  assert.equal(response.status, 401);
});

test("alt-text endpoint rejects cross-origin requests and missing configuration", async () => {
  const forbidden = await endpoint.handleAltTextRequest(context("{}", { OPENAI_API_KEY: "secret" }, { Origin: "https://evil.example" }), authenticated);
  assert.equal(forbidden.status, 403);
  const unavailable = await endpoint.handleAltTextRequest(context("{}"), authenticated);
  assert.equal(unavailable.status, 503);
});

test("alt-text endpoint bounds streamed bodies without Content-Length", async () => {
  const oversized = JSON.stringify({ image: `data:image/png;base64,${"a".repeat(8 * 1024 * 1024)}` });
  const response = await endpoint.handleAltTextRequest(context(oversized, { OPENAI_API_KEY: "secret" }), authenticated);
  assert.equal(response.status, 413);
});

test("alt-text endpoint validates sources and returns cleaned OpenAI output", async () => {
  const invalid = await endpoint.handleAltTextRequest(
    context(JSON.stringify({ image: "https://evil.example/image.png" }), { OPENAI_API_KEY: "secret" }),
    authenticated
  );
  assert.equal(invalid.status, 400);

  let upstreamRequest;
  const response = await endpoint.handleAltTextRequest(
    context(JSON.stringify({ image: "https://mysite.example/assets/image.webp" }), { OPENAI_API_KEY: "secret" }),
    {
      ...authenticated,
      fetch: async (_url, options) => {
        upstreamRequest = JSON.parse(options.body);
        return new Response(JSON.stringify({ output_text: "  „Ein ruhiger See.“  " }), { status: 200 });
      }
    }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { alt: "Ein ruhiger See." });
  assert.equal(upstreamRequest.model, "gpt-5.5");
  assert.equal(upstreamRequest.input[1].content[0].detail, "low");
});

test("alt-text endpoint aborts an OpenAI request that takes too long", async () => {
  const response = await endpoint.handleAltTextRequest(
    context(JSON.stringify({ image: "https://mysite.example/assets/image.webp" }), { OPENAI_API_KEY: "secret" }),
    {
      ...authenticated,
      upstreamTimeoutMs: 5,
      fetch: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      })
    }
  );
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { message: "Der Alt-Text-Dienst hat nicht rechtzeitig geantwortet." });
});

test("alt-text endpoint accepts the R2 delivery domain and still rejects foreign hosts", () => {
  // Since DB-1129 a committed image is referenced from media.mysite.example; rejecting it made
  // "Alt-Text erzeugen" fail with "Ungültige Bildquelle" for every saved image.
  assert.ok(endpoint.isAllowedImage("https://media.mysite.example/images/uploads/photo.webp"));
  assert.ok(endpoint.isAllowedImage("https://mysite.example/assets/images/photo.webp"));
  assert.ok(endpoint.isAllowedImage("https://raw.githubusercontent.com/owner/repo/main/photo.webp"));
  assert.ok(endpoint.isAllowedImage("data:image/webp;base64,AAAA"));

  assert.equal(endpoint.isAllowedImage("http://media.mysite.example/images/photo.webp"), false);
  assert.equal(endpoint.isAllowedImage("https://media.mysite.example.evil.example/photo.webp"), false);
  assert.equal(endpoint.isAllowedImage("https://evil.example/photo.webp"), false);
  assert.equal(endpoint.isAllowedImage("nonsense"), false);
});
