const assert = require("node:assert/strict");
const test = require("node:test");

const { create } = require("../blog/admin/markdown-media.js");

const media = create({
  stripMarkdownUrl: (value) => String(value).trim().split(/\s+/)[0].replace(/^<|>$/g, ""),
  extension: (value) => String(value).split(".").pop().toLowerCase()
});

test("markdown media parser handles escaped alt text and nested URLs", () => {
  const images = media.findMarkdownImages("Before ![A \\] label](https://example.com/a_(1).webp \"Title\") after");
  assert.equal(images.length, 1);
  assert.equal(images[0].alt, "A \\] label");
  assert.equal(images[0].src, "https://example.com/a_(1).webp");
  assert.equal(media.markdownAltHasText(images[0].alt), true);
  assert.equal(media.escapeMarkdownAlt("Line one\nline ] two"), "Line one line \\] two");
  assert.equal(media.imageMimeType("photo.avif"), "image/avif");
});

test("visible Markdown excludes code and comments but preserves indented video HTML", () => {
  const source = [
    "!video(/assets/videos/real.mp4)",
    "`!video(/assets/videos/inline.mp4)`",
    "<!-- !video(/assets/videos/comment.mp4) -->",
    "```md",
    "!video(/assets/videos/fenced.mp4)",
    "```",
    "<video controls>",
    "    <source src=\"/assets/videos/html.mp4\">",
    "</video>"
  ].join("\n");
  const visible = media.visibleMarkdownSource(source);

  assert.match(visible, /!video\(\/assets\/videos\/real\.mp4\)/);
  assert.match(visible, /<source src="\/assets\/videos\/html\.mp4">/);
  assert.doesNotMatch(visible, /inline|comment|fenced/);
  assert.equal(visible.length, source.length);
});

test("visible Markdown closes fenced code with CRLF line endings", () => {
  const source = [
    "```md",
    "!video(/assets/videos/code.mp4)",
    "```",
    "!video(/assets/videos/real.mp4)"
  ].join("\r\n");
  const visible = media.visibleMarkdownSource(source);

  assert.doesNotMatch(visible, /code\.mp4/);
  assert.match(visible, /!video\(\/assets\/videos\/real\.mp4\)/);
  assert.equal(visible.length, source.length);
});

test("visible Markdown masks an unclosed HTML comment through end of input", () => {
  const source = [
    "Visible text",
    "<!-- unfinished comment",
    "!video(/assets/videos/hidden.mp4)"
  ].join("\n");
  const visible = media.visibleMarkdownSource(source);

  assert.match(visible, /^Visible text/);
  assert.doesNotMatch(visible, /unfinished|hidden\.mp4/);
  assert.equal(visible.length, source.length);
});

test("HTML comment examples in code do not hide following media", () => {
  const sources = [
    [
      "```html",
      "<!-- unfinished example",
      "```",
      "!video(/assets/videos/real.mp4)"
    ].join("\n"),
    [
      "`<!--`",
      "!video(/assets/videos/real.mp4)"
    ].join("\n")
  ];

  for (const source of sources) {
    const visible = media.visibleMarkdownSource(source);
    assert.doesNotMatch(visible, /unfinished|<!--/);
    assert.match(visible, /!video\(\/assets\/videos\/real\.mp4\)/);
  }
});

test("media shortcuts follow the renderer's full-line parsing contract", () => {
  const source = [
    "Example: !video(/assets/videos/inline.mp4)",
    "!video(/assets/videos/a_(1).mp4)",
    "!gpx[Wandern](/assets/files/gpx/tour_(1).gpx)"
  ].join("\n");

  assert.deepEqual(media.findMediaShortcuts(source), [
    { type: "video", label: "", source: "/assets/videos/a_(1).mp4", from: 43 },
    { type: "gpx", label: "Wandern", source: "/assets/files/gpx/tour_(1).gpx", from: 76 }
  ]);
});

test("media parsing normalizes angle shortcuts and complete HTML attributes", () => {
  assert.deepEqual(media.findMediaShortcuts("!video(</assets/videos/angle.mp4>)"), [
    { type: "video", label: "", source: "/assets/videos/angle.mp4", from: 0 }
  ]);
  assert.deepEqual(media.findHtmlMedia('<video><source src="/assets/videos/a_(1).mp4"></video>'), [
    { type: "source", src: "/assets/videos/a_(1).mp4", alt: "", from: 7 }
  ]);
});

test("reads the alt attribute of HTML images and leaves videos without one", () => {
  const found = media.findHtmlMedia([
    '<img src="/assets/images/a.webp" alt="Nebel &amp; Licht">',
    "<img src='/assets/images/b.webp'>",
    '<video src="/assets/videos/c.mp4" alt="ignoriert"><source src="/assets/videos/d.mp4"></video>'
  ].join("\n"));

  assert.deepEqual(found.map((item) => [item.type, item.src, item.alt]), [
    ["img", "/assets/images/a.webp", "Nebel & Licht"],
    ["img", "/assets/images/b.webp", ""],
    ["video", "/assets/videos/c.mp4", "ignoriert"],
    ["source", "/assets/videos/d.mp4", ""]
  ]);
});
