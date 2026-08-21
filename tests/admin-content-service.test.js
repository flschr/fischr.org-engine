const assert = require("node:assert/strict");
const test = require("node:test");

const { create } = require("../blog/admin/content-service.js");

const content = create({
  editableFrontmatterKeys: new Set([
    "title", "slug", "date", "lang", "draft", "permalink", "social_image",
    "social_text", "social_images", "social_template", "category", "syndicate",
    "schema"
  ]),
  localIsoWithOffset: () => "2026-07-19T12:00:00+02:00",
  slugify: (value) => String(value).toLowerCase().replace(/\s+/g, "-")
});

test("content service parses and rebuilds editable frontmatter", () => {
  const source = `---\ntitle: "Hello: world"\ndraft: true\nlang: en\ntags:\n  - Test\n---\n\nBody\n`;
  const document = content.splitDocument(source);
  const fields = document.fields;

  assert.equal(fields.title, "Hello: world");
  assert.equal(fields.draft, true);
  assert.match(content.buildDocument(fields, document.preserved, document.body, "posts"), /title: 'Hello: world'/);
});
