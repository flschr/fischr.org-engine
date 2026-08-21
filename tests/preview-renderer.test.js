const assert = require("node:assert/strict");
const test = require("node:test");
const preview = require("../blog/admin/preview-renderer.js");
const conventions = require("../blog/admin/markdown-conventions.js");

test("preview and production share custom Markdown shortcut parsing", () => {
  assert.deepEqual(conventions.parseMediaShortcut("!gpx[Wandern](/tour.gpx)"), {
    type: "gpx",
    label: "Wandern",
    source: "/tour.gpx"
  });
  assert.match(preview.render("!gpx[Wandern](/tour.gpx)"), /GPX-Tour · Wandern/);
});

test("preview renders admonitions like the public site", () => {
  const html = preview.render("> [!CAUTION]\n> **Back up first**\n>\n> Keep the old CSS.\n");
  assert.match(html, /<aside class="admonition admonition-caution" role="note" aria-label="Vorsicht">/);
  assert.match(html, /<p class="admonition-title"><svg class="admonition-icon"[^>]*>.*<\/svg>Back up first<\/p>/);
  assert.match(html, /<p>Keep the old CSS\.<\/p>/);
});

test("preview localizes the admonition type independently of inline HTML", () => {
  const html = preview.render("> [!CAUTION]\n> **<img src=\"/x\" alt=\"Backup\">**\n", { lang: "en" });
  assert.match(html, /aria-label="Caution"/);
  assert.doesNotMatch(html, /aria-label="[^"]*Backup/);
});

test("preview renders safe Markdown and footnotes", () => {
  const markdown = [
    "Text **strong** <sup class=\"footnote-ref\" id=\"fnref-1\"><a href=\"#fn-1\">1</a></sup>",
    "",
    "<section class=\"footnotes\"><ol><li id=\"fn-1\"><p>Safe note<a class=\"footnote\" href=\"#fnref-1\">↗︎</a></p></li></ol></section>"
  ].join("\n");
  const html = preview.render(markdown);
  assert.match(html, /<strong>strong<\/strong>/);
  assert.match(html, /<section class="footnotes">/);
  assert.match(html, /Safe note/);
});

test("preview decodes HTML entities in footnote text exactly once", () => {
  const markdown = [
    'Text<sup class="footnote-ref" id="fnref-1"><a href="#fn-1">1</a></sup>',
    "",
    '<section class="footnotes"><ol><li id="fn-1"><p>&quot;Lage der Nation&quot; &amp; mehr<a class="footnote" href="#fnref-1">↗︎</a></p></li></ol></section>'
  ].join("\n");
  const html = preview.render(markdown);
  assert.match(html, /<sup class="footnote-ref"[^>]*><a href="#fn-1">1<\/a><\/sup>/);
  assert.match(html, />&quot;Lage der Nation&quot; &amp; mehr</);
  assert.doesNotMatch(html, /&amp;quot;/);
});

test("preview supports the complete editor footnote inline format contract", () => {
  const markdown = [
    'Text<sup class="footnote-ref" id="fnref-1"><a href="#fn-1">1</a></sup>',
    "",
    '<section class="footnotes"><ol><li id="fn-1"><p><strong>bold</strong> <em>italic</em> <code>code</code> <del>strike</del> <mark>mark</mark> <a href="https://example.com/?a=1&amp;b=2">link</a><br>next<a class="footnote" href="#fnref-1">↗︎</a></p></li></ol></section>'
  ].join("\n");
  const html = preview.render(markdown);
  for (const fragment of [
    "<strong>bold</strong>",
    "<em>italic</em>",
    "<code>code</code>",
    "<del>strike</del>",
    "<mark>mark</mark>",
    '<a href="https://example.com/?a=1&amp;b=2"',
    "<br>next"
  ]) assert.match(html, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("preview neutralizes active HTML and dangerous URLs", () => {
  const attacks = [
    "<section class=\"footnotes\"><ol><li id=\"fn-1\"><p><img src=x onerror=alert(1)>note<script>alert(2)</script><a class=\"footnote\" href=\"#fnref-1\">↗︎</a></p></li></ol></section>",
    "[bad](javascript:alert(3))",
    "![](data:text/html,<svg onload=alert(4)>)"
  ].join("\n\n");
  const html = preview.render(attacks);
  assert.doesNotMatch(html, /<script|<[^>]+\son(?:error|load)=|href="javascript:|src="data:text\/html/i);
  assert.match(html, /notealert\(2\)/);
});

test("preview preserves harmless security terms in authored code", () => {
  const html = preview.render("`onload` and `javascript:`");
  assert.match(html, /<code>onload<\/code>/);
  assert.match(html, /<code>javascript:<\/code>/);
});

test("preview recognizes every production media shortcut", () => {
  for (const shortcut of [
    "!video(/assets/videos/test.mp4)",
    "!gpx[Wandern](/assets/files/gpx/test.gpx)",
    "!youtube[Video](https://youtu.be/abcdefg)",
    "!map[Karte](https://www.google.com/maps/embed?pb=test)",
    "!embed[ARTE](https://www.arte.tv/embeds/de/test)"
  ]) {
    assert.doesNotMatch(preview.render(shortcut), /!\w+/);
  }
});

test("preview advances past GPX embeds", () => {
  const html = preview.render("!gpx[Hiking](/assets/files/gpx/tour.gpx)\n\nAfter");
  assert.match(html, /preview-gpx/);
  assert.match(html, /<p>After<\/p>/);
});

test("preview only emits supported URL protocols", () => {
  assert.equal(preview.safeUrl("javascript:alert(1)"), "");
  assert.equal(preview.safeUrl("data:text/html,bad"), "");
  assert.equal(preview.safeUrl("/assets/image.webp"), "/assets/image.webp");
  assert.equal(preview.safeUrl("https://example.com/a"), "https://example.com/a");
});
