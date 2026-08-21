const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { fetchWithTimeout, HttpResponseError, isPermanentClientError } = require("../scripts/lib/http-utils");
const { positiveInteger, readJson, writeJson } = require("../scripts/lib/publish-utils");

test("JSON state fails closed when an existing file is malformed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "automation-json-"));
  const file = path.join(directory, "state.json");
  fs.writeFileSync(file, "{broken");

  assert.throws(() => readJson(file, {}), /Could not parse JSON file/);
  assert.deepEqual(readJson(path.join(directory, "missing.json"), { fallback: true }), { fallback: true });
});

test("JSON state is written atomically without leaving temporary files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "automation-json-"));
  const file = path.join(directory, "state.json");

  writeJson(file, { saved: true });

  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { saved: true });
  assert.deepEqual(fs.readdirSync(directory), ["state.json"]);
});

test("automation limits require positive integers", () => {
  assert.equal(positiveInteger("5", 1, "limit"), 5);
  assert.equal(positiveInteger(undefined, 3, "limit"), 3);
  assert.throws(() => positiveInteger("many", 3, "limit"), /positive integer/);
  assert.throws(() => positiveInteger(0, 3, "limit"), /positive integer/);
});

test("HTTP classification retries only temporary client and server errors", () => {
  assert.equal(isPermanentClientError(new HttpResponseError(400, "bad request")), true);
  assert.equal(isPermanentClientError(new HttpResponseError(404, "not found")), true);
  assert.equal(isPermanentClientError(new HttpResponseError(408, "timeout")), false);
  assert.equal(isPermanentClientError(new HttpResponseError(425, "too early")), false);
  assert.equal(isPermanentClientError(new HttpResponseError(429, "rate limited")), false);
  assert.equal(isPermanentClientError(new HttpResponseError(503, "unavailable")), false);
  assert.equal(isPermanentClientError(new Error("network failure")), false);
});

test("external HTTP requests are aborted after their configured timeout", async () => {
  const stalledFetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason));
  });

  await assert.rejects(fetchWithTimeout(stalledFetch, "https://example.com", { timeoutMs: 5 }), /abort|timeout/i);
  await assert.rejects(
    fetchWithTimeout(stalledFetch, "https://example.com", { timeoutMs: "invalid" }),
    /positive integer/
  );
  await assert.rejects(fetchWithTimeout(stalledFetch, "https://example.com", { timeoutMs: 0 }), /positive integer/);
});
