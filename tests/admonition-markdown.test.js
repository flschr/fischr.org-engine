const assert = require("node:assert/strict");
const test = require("node:test");
const markdownIt = require("markdown-it");
const { buildAdmonitionMarkdown, findType, labelFor, types } = require("../blog/admin/admonitions");
const { markdownItAdmonitions } = require("../blog/admin/markdown-conventions");

test("owns the shared admonition type metadata", () => {
  assert.deepEqual(types.map(({ marker, className, cmsLabel, labels }) => ({ marker, className, cmsLabel, labels })), [
    { marker: "NOTE", className: "info", cmsLabel: "Hinweis", labels: { de: "Hinweis", en: "Note" } },
    { marker: "WARNING", className: "warning", cmsLabel: "Warnung", labels: { de: "Warnung", en: "Warning" } },
    { marker: "CAUTION", className: "caution", cmsLabel: "Vorsicht", labels: { de: "Vorsicht", en: "Caution" } }
  ]);
  assert.equal(findType("caution"), types[2]);
  assert.equal(labelFor(types[2], "en-US"), "Caution");
  assert.equal(labelFor(types[2], "fr"), "Vorsicht");
});

test("builds an admonition around multiline selected text", () => {
  assert.equal(
    buildAdmonitionMarkdown({ type: "warning", title: "Heads up", body: "One\n\nTwo" }),
    "> [!WARNING]\n> **Heads up**\n>\n> One\n> \n> Two"
  );
});

test("escapes Markdown delimiters in admonition titles", () => {
  assert.equal(
    buildAdmonitionMarkdown({ type: "NOTE", title: "A *literal* \\ title" }),
    "> [!NOTE]\n> **A \\*literal\\* \\\\ title**\n>\n> Text"
  );
});

test("treats CMS titles as plain text, including Markdown and HTML", () => {
  const title = "[Docs](/docs) <strong>now</strong> & `code`";
  const markdown = buildAdmonitionMarkdown({ title });
  const html = markdownIt({ html: true }).use(markdownItAdmonitions).render(markdown, { lang: "en" });
  assert.match(html, /<p class="admonition-title"><svg[^>]*>[\s\S]*<\/svg>\[Docs\]\(\/docs\) &lt;strong&gt;now&lt;\/strong&gt; &amp; `code`<\/p>/);
  assert.doesNotMatch(html, /<a |<strong>now<\/strong>|<code>code<\/code>/);
});

test("rejects missing titles and unsupported types", () => {
  assert.throws(() => buildAdmonitionMarkdown({ title: "" }), /title is required/i);
  assert.throws(() => buildAdmonitionMarkdown({ type: "TIP", title: "Title" }), /unsupported/i);
});
