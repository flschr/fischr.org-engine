const assert = require("node:assert/strict");
const test = require("node:test");
const adminSource = require("./helpers/admin-source");

test("temporary GitHub credentials are session scoped and OpenAI stays server-side", () => {
  const source = adminSource();
  assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem|removeItem)\(tokenKey\)/);
  assert.match(source, /sessionStorage\.getItem\(tokenKey\)/);
  assert.doesNotMatch(source, /api\.openai\.com|openAiKeyKey|Authorization.*Bearer.*apiKey/);
  assert.match(source, /fetch\("\/api\/admin\/alt-text"/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 30_000\)/);
  assert.match(source, /controller\.signal\.aborted/);
  assert.match(source, /failures\[0\]\.error\?\.message/);
});
